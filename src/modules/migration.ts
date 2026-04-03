import type { Account, Address, WalletClient } from "viem";
import { ENDPOINTS } from "../endpoints.js";
import { ContextConfigError } from "../errors.js";
import type { HttpClient } from "../http.js";
import { decodePriceCents, decodeSize } from "../order-builder/helpers.js";
import type { OrderBuilder } from "../order-builder/builder.js";
import {
  signBatchWithdraw,
  signSetOperatorApproval,
} from "../signing/eip712.js";
import type {
  MigrationAddressRequest,
  DismissMigrationOrdersRequest,
  DismissMigrationOrdersResult,
  MigrationAuthorizationAction,
  MigrationStatus,
  PendingMigrationRestoration,
  PublicAddressAuthorization,
  RestoreMigrationOrdersRequest,
  RestoreMigrationOrdersResult,
  SignedMigrationAction,
  SignMigrationAddressAuthorizationRequest,
  SponsoredMigrateFundsRequest,
  SponsoredMigrateFundsResult,
  StartMigrationRequest,
  StartMigrationResult,
} from "../types.js";
import type { ChainConfig } from "../config.js";

const DEFAULT_SIGNATURE_TTL_SECONDS = 3600n;

const generateRandomUint128 = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
};

const sortLegacyOrderIds = (legacyOrderIds?: number[]) =>
  legacyOrderIds ? [...legacyOrderIds].sort((left, right) => left - right) : [];

const buildPublicMigrationAuthorizationMessage = ({
  action,
  walletAddress,
  deadline,
  legacyOrderIds,
}: {
  action: MigrationAuthorizationAction;
  walletAddress: Address;
  deadline: bigint;
  legacyOrderIds?: number[];
}) => {
  const sortedLegacyOrderIds = sortLegacyOrderIds(legacyOrderIds);

  return [
    "Context public API migration authorization",
    `Action: ${action}`,
    `Wallet: ${walletAddress.toLowerCase()}`,
    `Legacy order ids: ${
      sortedLegacyOrderIds.length > 0 ? sortedLegacyOrderIds.join(",") : "all"
    }`,
    `Deadline: ${deadline.toString()}`,
  ].join("\n");
};

export class MigrationModule {
  constructor(
    private readonly http: HttpClient,
    private readonly builder: OrderBuilder | null,
    private readonly walletClient: WalletClient | null,
    private readonly account: Account | null,
    private readonly address: Address | null,
    private readonly chainConfig: ChainConfig,
  ) {}

  private withAddress<T extends MigrationAddressRequest>(request?: T): T | undefined {
    if (request?.address || !this.address) {
      return request;
    }

    return {
      ...request,
      address: this.address,
    } as T;
  }

  private requireSigner() {
    if (!this.builder || !this.walletClient || !this.account || !this.address) {
      throw new ContextConfigError(
        "A signer is required for migration signing helpers.",
      );
    }

    return {
      builder: this.builder,
      walletClient: this.walletClient,
      account: this.account,
      address: this.address,
    };
  }

  async getStatus(
    request?: MigrationAddressRequest,
  ): Promise<MigrationStatus> {
    const resolved = this.withAddress(request);
    return this.http.get<MigrationStatus>(
      ENDPOINTS.account.migration,
      resolved?.address ? { address: resolved.address } : undefined,
    );
  }

  async start(
    request: StartMigrationRequest = {},
  ): Promise<StartMigrationResult> {
    const resolved = this.withAddress(request);
    if (resolved?.authorization && !resolved.address) {
      throw new ContextConfigError(
        "Migration address authorization requires an explicit address override.",
      );
    }

    return this.http.post<StartMigrationResult>(
      ENDPOINTS.account.migrationStart,
      resolved?.address ? resolved : {},
    );
  }

  async dismissOrders(
    request: DismissMigrationOrdersRequest = {},
  ): Promise<DismissMigrationOrdersResult> {
    const resolved = this.withAddress(request);
    if (resolved?.authorization && !resolved.address) {
      throw new ContextConfigError(
        "Migration address authorization requires an explicit address override.",
      );
    }

    return this.http.post<DismissMigrationOrdersResult>(
      ENDPOINTS.account.migrationDismissOrders,
      resolved?.address
        ? resolved
        : request.legacyOrderIds
          ? { legacyOrderIds: request.legacyOrderIds }
          : {},
    );
  }

  async migrateFunds(
    request: SponsoredMigrateFundsRequest,
  ): Promise<SponsoredMigrateFundsResult> {
    return this.http.post<SponsoredMigrateFundsResult>(
      ENDPOINTS.account.migrationMigrateFunds,
      this.withAddress(request) ?? request,
    );
  }

  async restoreOrders(
    request: RestoreMigrationOrdersRequest,
  ): Promise<RestoreMigrationOrdersResult> {
    return this.http.post<RestoreMigrationOrdersResult>(
      ENDPOINTS.account.migrationRestoreOrders,
      this.withAddress(request) ?? request,
    );
  }

  async signSponsoredMigrateFunds(
    status?: MigrationStatus,
  ): Promise<SponsoredMigrateFundsRequest> {
    const signer = this.requireSigner();
    const migration =
      status ?? (await this.getStatus({ address: signer.address }));

    if (!migration.sponsoredFundsMigrationAvailable) {
      throw new ContextConfigError(
        "Sponsored migrate-funds is not available for this account.",
      );
    }

    if (!migration.sponsoredRelayerAddress) {
      throw new ContextConfigError(
        "Migration status did not include a sponsored relayer address.",
      );
    }

    if (migration.fundsMigrationPlan.chunks.length === 0) {
      throw new ContextConfigError(
        "No funds migration chunks are available to sign.",
      );
    }

    if (migration.newHoldingsOperatorNonce == null) {
      throw new ContextConfigError(
        "Migration status did not include the new holdings operator nonce.",
      );
    }

    const deadline =
      BigInt(Math.floor(Date.now() / 1000)) + DEFAULT_SIGNATURE_TTL_SECONDS;

    const chunks = await Promise.all(
      migration.fundsMigrationPlan.chunks.map(async (chunk) => {
        const tokens = chunk.tokens.map((token) => token.token);
        const amounts = chunk.tokens.map((token) => BigInt(token.amount));
        const nonce = generateRandomUint128();
        const signature = await signBatchWithdraw(
          signer.walletClient,
          signer.account,
          {
            from: signer.address,
            to: migration.sponsoredRelayerAddress!,
            tokens,
            amounts,
            nonce,
            deadline,
          },
          this.chainConfig,
        );

        return {
          batchWithdraw: {
            nonce: nonce.toString(),
            deadline: deadline.toString(),
            signature,
          },
        };
      }),
    );

    const operatorSigned = await signSetOperatorApproval(
      signer.walletClient,
      signer.account,
      {
        user: signer.address,
        operator: this.chainConfig.settlementV2,
        approved: true,
        nonce: BigInt(migration.newHoldingsOperatorNonce),
        deadline,
        settlementVersion: 2,
      },
      this.chainConfig,
    );

    const setOperator: SignedMigrationAction = {
      nonce: migration.newHoldingsOperatorNonce,
      deadline: deadline.toString(),
      signature: operatorSigned,
    };

    if (chunks.length === 1) {
      const [chunk] = chunks;
      if (!chunk) {
        throw new ContextConfigError("Missing migration chunk to sign.");
      }

      return {
        batchWithdraw: chunk.batchWithdraw,
        setOperator,
      };
    }

    return {
      chunks,
      setOperator,
    };
  }

  async signAddressAuthorization({
    action,
    address,
    legacyOrderIds,
    deadline,
  }: SignMigrationAddressAuthorizationRequest): Promise<PublicAddressAuthorization> {
    const signer = this.requireSigner();
    const walletAddress = address ?? signer.address;
    const resolvedDeadline =
      deadline == null
        ? BigInt(Math.floor(Date.now() / 1000)) + DEFAULT_SIGNATURE_TTL_SECONDS
        : BigInt(deadline);
    const message = buildPublicMigrationAuthorizationMessage({
      action,
      walletAddress,
      deadline: resolvedDeadline,
      legacyOrderIds,
    });
    const signature = await signer.walletClient.signMessage({
      account: signer.account,
      message,
    });

    return {
      deadline: resolvedDeadline.toString(),
      signature,
    };
  }

  private mapDraftToSdkOrder(
    restoration: PendingMigrationRestoration,
  ) {
    const { draft } = restoration;
    if (draft.type !== "limit") {
      throw new ContextConfigError(
        `Legacy order ${restoration.legacyOrderId} is not a restorable limit order.`,
      );
    }

    if (!draft.trader || !draft.remainingSize || !draft.nonce) {
      throw new ContextConfigError(
        `Legacy order ${restoration.legacyOrderId} is missing required draft fields.`,
      );
    }

    return {
      marketId: draft.marketId,
      outcome: draft.outcomeIndex === 1 ? ("yes" as const) : ("no" as const),
      side: draft.side === 0 ? ("buy" as const) : ("sell" as const),
      priceCents: decodePriceCents(BigInt(draft.price)),
      size: decodeSize(BigInt(draft.remainingSize)),
      nonce: draft.nonce,
      expiry: draft.expiry,
      maxFee: draft.maxFee,
      timeInForce: draft.timeInForce,
      clientOrderType: draft.clientOrderType,
      makerRoleConstraint: draft.makerRoleConstraint,
      inventoryModeConstraint: draft.inventoryModeConstraint,
      settlementVersion: 2 as const,
    };
  }

  async signRestoreOrder(restoration: PendingMigrationRestoration) {
    const { builder } = this.requireSigner();
    return {
      legacyOrderId: restoration.legacyOrderId,
      order: (await builder.buildAndSign(
        this.mapDraftToSdkOrder(restoration),
      )) as unknown as Record<string, unknown>,
    };
  }

  async buildRestoreOrdersBody(
    restorations?: PendingMigrationRestoration[],
  ): Promise<RestoreMigrationOrdersRequest> {
    const migration = restorations
      ? null
      : await this.getStatus(this.address ? { address: this.address } : undefined);
    const pending = restorations ?? migration?.pendingRestorations ?? [];

    return {
      ...(this.address ? { address: this.address } : {}),
      restorations: await Promise.all(
        pending.map((restoration) => this.signRestoreOrder(restoration)),
      ),
    };
  }

  async restorePendingOrders(
    restorations?: PendingMigrationRestoration[],
  ): Promise<RestoreMigrationOrdersResult> {
    const body = await this.buildRestoreOrdersBody(restorations);
    return this.restoreOrders(body);
  }
}
