import { describe, expect, it, vi } from "vitest";
import type { Account, Address, Hex } from "viem";
import { MigrationModule } from "../../src/modules/migration.js";
import type { HttpClient } from "../../src/http.js";
import type { OrderBuilder } from "../../src/order-builder/builder.js";
import { TESTNET_CONFIG } from "../../src/config.js";

const ADDRESS =
  "0x1234567890abcdef1234567890abcdef12345678" as Address;

const ACCOUNT = {
  address: ADDRESS,
} as Account;

const createMockHttp = (): HttpClient => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
});

const createMockBuilder = () =>
  ({
    address: ADDRESS,
    buildAndSign: vi.fn().mockResolvedValue({
      type: "limit",
      marketId:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      trader: ADDRESS,
      price: "420000",
      size: "5000000",
      outcomeIndex: 1,
      side: 0,
      nonce:
        "0x2222222222222222222222222222222222222222222222222222222222222222",
      expiry: "9999999999",
      maxFee: "21000",
      timeInForce: 0,
      clientOrderType: "limit",
      makerRoleConstraint: 0,
      inventoryModeConstraint: 0,
      signature: "0xsigned",
    }),
  }) as unknown as OrderBuilder;

const createMockWalletClient = () =>
  ({
    signTypedData: vi.fn().mockResolvedValue("0xsigned-typed-data"),
  }) as any;

const migrationStatus = {
  migrationActive: true,
  walletAddress: ADDRESS,
  holdings: {
    legacy: "0x0a6D61723E8AE8e34734A84075a1b58aB3eEca6a",
    new: "0xBed9a1A6CB168D60aD2C7770Be6B62bD9244D6d3",
  },
  settlementV2Address: TESTNET_CONFIG.settlementV2,
  legacyBalances: [],
  newBalances: [],
  v2OperatorApproved: false,
  newHoldingsOperatorNonce: "7",
  fundsMigrationPlan: {
    phase: "withdraw_legacy_and_approve_v2",
    callCount: 2,
    chunkCount: 2,
    calls: [],
    tokens: [],
    chunks: [
      {
        callCount: 1,
        calls: [],
        tokens: [
          {
            token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address,
            amount: "1000000",
          },
        ],
      },
      {
        callCount: 1,
        calls: [],
        tokens: [
          {
            token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address,
            amount: "2000000",
          },
        ],
      },
    ],
  },
  pendingRestorations: [
    {
      id: 1,
      legacyOrderId: 99,
      legacyOrderHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex,
      legacyMarketId:
        "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      status: "pending",
      draft: {
        type: "limit" as const,
        marketId:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        trader: ADDRESS,
        side: 0 as const,
        price: "420000",
        remainingSize: "5000000",
        outcomeIndex: 1,
        nonce:
          "0x4444444444444444444444444444444444444444444444444444444444444444" as Hex,
        expiry: "9999999999",
        maxFee: "21000",
        timeInForce: 0 as const,
        clientOrderType: "limit" as const,
        makerRoleConstraint: 0 as const,
        inventoryModeConstraint: 0 as const,
        reason: "ready_for_resign",
      },
      error: null,
      market: null,
    },
  ],
  voidedLegacyOrderCount: 0,
  legacyOpenOrderCount: 0,
  sponsoredFundsMigrationAvailable: true,
  sponsoredRelayerAddress:
    "0x9999999999999999999999999999999999999999" as Address,
  sponsoredFundsMigrationStatus: null,
  canStart: false,
  canMigrateFunds: true,
  canRestoreOrders: true,
  canDismissOrders: true,
  migrationComplete: false,
};

describe("MigrationModule", () => {
  it("wraps the public migration routes", async () => {
    const http = createMockHttp();
    const module = new MigrationModule(
      http,
      null,
      null,
      null,
      null,
      TESTNET_CONFIG,
    );

    (http.get as any).mockResolvedValue(migrationStatus);
    (http.post as any).mockResolvedValue({ success: true });

    await module.getStatus();
    await module.start();
    await module.dismissOrders({ legacyOrderIds: [1, 2] });

    expect(http.get).toHaveBeenCalledWith("/account/migration");
    expect(http.post).toHaveBeenCalledWith("/account/migration/start", {});
    expect(http.post).toHaveBeenCalledWith(
      "/account/migration/dismiss-orders",
      { legacyOrderIds: [1, 2] },
    );
  });

  it("signs a chunked sponsored migrate-funds body", async () => {
    const http = createMockHttp();
    const builder = createMockBuilder();
    const walletClient = createMockWalletClient();
    const module = new MigrationModule(
      http,
      builder,
      walletClient,
      ACCOUNT,
      ADDRESS,
      TESTNET_CONFIG,
    );

    const body = await module.signSponsoredMigrateFunds(
      migrationStatus as any,
    );

    expect(body).toEqual(
      expect.objectContaining({
        chunks: expect.arrayContaining([
          expect.objectContaining({
            batchWithdraw: expect.objectContaining({
              nonce: expect.any(String),
              deadline: expect.any(String),
              signature: "0xsigned-typed-data",
            }),
          }),
        ]),
        setOperator: expect.objectContaining({
          nonce: "7",
          deadline: expect.any(String),
          signature: "0xsigned-typed-data",
        }),
      }),
    );
    expect(walletClient.signTypedData).toHaveBeenCalledTimes(3);
  });

  it("builds a restore-orders body from pending drafts", async () => {
    const http = createMockHttp();
    const builder = createMockBuilder();
    const walletClient = createMockWalletClient();
    const module = new MigrationModule(
      http,
      builder,
      walletClient,
      ACCOUNT,
      ADDRESS,
      TESTNET_CONFIG,
    );

    const body = await module.buildRestoreOrdersBody(
      migrationStatus.pendingRestorations as any,
    );

    expect(builder.buildAndSign).toHaveBeenCalledWith(
      expect.objectContaining({
        marketId:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        settlementVersion: 2,
        size: 5,
        nonce:
          "0x4444444444444444444444444444444444444444444444444444444444444444",
        expiry: "9999999999",
        maxFee: "21000",
      }),
    );
    expect(body).toEqual({
      restorations: [
        {
          legacyOrderId: 99,
          order: expect.objectContaining({
            type: "limit",
            signature: "0xsigned",
          }),
        },
      ],
    });
  });
});
