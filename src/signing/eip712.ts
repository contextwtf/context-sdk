import {
  type Account,
  type Address,
  type Hex,
  type WalletClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  BATCH_WITHDRAW_TYPES,
  CANCEL_TYPES,
  ORDER_KIND_BUY,
  ORDER_KIND_SELL_INVENTORY,
  ORDER_KIND_SELL_NO_INVENTORY,
  SETTLEMENT_V2_ORDER_TYPES,
  TIME_IN_FORCE_GTC,
  type ChainConfig,
  type SettlementVersion,
  type TimeInForce,
  getHoldingsAddress,
  getSettlementAddress,
  holdingsDomain,
  settlementDomain,
} from "../config.js";
import { ContextSigningError } from "../errors.js";
import type { SignerInput } from "../types.js";

export interface OrderMessage {
  marketId: Hex;
  trader: Address;
  price: bigint;
  size: bigint;
  outcomeIndex: number;
  side: number;
  nonce: Hex;
  expiry: bigint;
  maxFee: bigint;
  makerRoleConstraint: number;
  inventoryModeConstraint: number;
}

export interface SettlementV2OrderMessage {
  marketId: Hex;
  trader: Address;
  maxShares: bigint;
  minSharesOut: bigint;
  maxCollateralIn: bigint;
  minCollateralOut: bigint;
  outcomeIndex: number;
  orderKind: number;
  nonce: Hex;
  expiry: bigint;
  maxFee: bigint;
  timeInForce: TimeInForce;
  makerRoleConstraint: number;
}

export interface BatchWithdrawMessage {
  from: Address;
  to: Address;
  withdrawsHash: Hex;
  nonce: bigint;
  deadline: bigint;
}

export function resolveSigner(
  input: SignerInput,
  chainConfig: ChainConfig,
): {
  account: Account;
  walletClient: WalletClient;
} {
  if ("privateKey" in input) {
    const account = privateKeyToAccount(input.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: chainConfig.viemChain,
      transport: http(),
    });
    return { account, walletClient };
  }

  if ("account" in input) {
    const walletClient = createWalletClient({
      account: input.account,
      chain: chainConfig.viemChain,
      transport: http(),
    });
    return { account: input.account, walletClient };
  }

  if ("walletClient" in input) {
    const account = input.walletClient.account;
    if (!account) {
      throw new ContextSigningError(
        "WalletClient must have an account configured",
      );
    }
    return { account, walletClient: input.walletClient };
  }

  throw new ContextSigningError("Invalid signer input");
}

export function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return keccak256(bytes);
}

export async function signSettlementV2Order(
  walletClient: WalletClient,
  account: Account,
  order: SettlementV2OrderMessage,
  chainConfig: ChainConfig,
): Promise<Hex> {
  try {
    return await walletClient.signTypedData({
      account,
      domain: settlementDomain(chainConfig, 2),
      types: SETTLEMENT_V2_ORDER_TYPES,
      primaryType: "Order",
      message: order,
    });
  } catch (err) {
    throw new ContextSigningError("Failed to sign SettlementV2 order", err);
  }
}

export interface MarketOrderIntentMessage {
  marketId: Hex;
  trader: Address;
  maxPrice: bigint;
  maxSize: bigint;
  outcomeIndex: number;
  side: number;
  nonce: Hex;
  expiry: bigint;
  maxFee: bigint;
}

export async function signCancel(
  walletClient: WalletClient,
  account: Account,
  trader: Address,
  nonce: Hex,
  chainConfig: ChainConfig,
  settlementVersion: SettlementVersion = chainConfig.defaultSettlementVersion,
): Promise<Hex> {
  if (settlementVersion !== 2) {
    throw new ContextSigningError(
      "Legacy cancel signing is no longer supported. Use SettlementV2 order flow.",
    );
  }

  try {
    return await walletClient.signTypedData({
      account,
      domain: settlementDomain(chainConfig, settlementVersion),
      types: CANCEL_TYPES,
      primaryType: "CancelNonce",
      message: { trader, nonce },
    });
  } catch (err) {
    throw new ContextSigningError("Failed to sign cancel", err);
  }
}

const ceilDiv = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator - 1n) / denominator;

const LEGACY_LIMIT_PRICE_SCALE = 1_000_000n;

export function legacyLimitOrderToSettlementV2Order(
  order: OrderMessage & {
    buyValue?: bigint;
    timeInForce?: TimeInForce;
  },
): SettlementV2OrderMessage {
  const isBuy = order.side === 0;
  const isNoInventorySell =
    order.side === 1 && order.inventoryModeConstraint === 2;

  const buyerCollateralAtLimitPrice = isBuy
    ? ceilDiv(order.price * order.size, LEGACY_LIMIT_PRICE_SCALE)
    : (order.price * order.size) / LEGACY_LIMIT_PRICE_SCALE;
  const sellerCollateralContributionAtLimitPrice =
    order.size - buyerCollateralAtLimitPrice;

  const orderKind = isBuy
    ? ORDER_KIND_BUY
    : isNoInventorySell
      ? ORDER_KIND_SELL_NO_INVENTORY
      : ORDER_KIND_SELL_INVENTORY;

  const maxShares = isBuy ? 0n : order.size;
  const minSharesOut = isBuy ? order.size : 0n;
  const maxCollateralIn = isBuy
    ? (order.buyValue ?? buyerCollateralAtLimitPrice) + order.maxFee
    : isNoInventorySell
      ? sellerCollateralContributionAtLimitPrice + order.maxFee
      : 0n;
  const minCollateralOut =
    !isBuy && !isNoInventorySell
      ? buyerCollateralAtLimitPrice > order.maxFee
        ? buyerCollateralAtLimitPrice - order.maxFee
        : 0n
      : 0n;

  return {
    marketId: order.marketId,
    trader: order.trader,
    maxShares,
    minSharesOut,
    maxCollateralIn,
    minCollateralOut,
    outcomeIndex: order.outcomeIndex,
    orderKind,
    nonce: order.nonce,
    expiry: order.expiry,
    maxFee: order.maxFee,
    timeInForce: order.timeInForce ?? TIME_IN_FORCE_GTC,
    makerRoleConstraint: order.makerRoleConstraint,
  };
}

export async function signBatchWithdraw(
  walletClient: WalletClient,
  account: Account,
  params: {
    from: Address;
    to: Address;
    tokens: readonly Address[];
    amounts: readonly bigint[];
    nonce: bigint;
    deadline: bigint;
  },
  chainConfig: ChainConfig,
): Promise<Hex> {
  try {
    const withdrawsHash = keccak256(
      encodeAbiParameters(
        [
          { type: "address[]", name: "tokens" },
          { type: "uint256[]", name: "amounts" },
        ],
        [[...params.tokens], [...params.amounts]],
      ),
    );

    const message: BatchWithdrawMessage = {
      from: params.from,
      to: params.to,
      withdrawsHash,
      nonce: params.nonce,
      deadline: params.deadline,
    };

    return await walletClient.signTypedData({
      account,
      domain: holdingsDomain(chainConfig, 1),
      types: BATCH_WITHDRAW_TYPES,
      primaryType: "BatchWithdraw",
      message,
    });
  } catch (err) {
    throw new ContextSigningError("Failed to sign batch withdraw", err);
  }
}

export async function signSetOperatorApproval(
  walletClient: WalletClient,
  account: Account,
  params: {
    user: Address;
    operator: Address;
    approved: boolean;
    nonce: bigint;
    deadline: bigint;
    settlementVersion?: SettlementVersion;
  },
  chainConfig: ChainConfig,
): Promise<Hex> {
  try {
    const settlementVersion =
      params.settlementVersion ?? chainConfig.defaultSettlementVersion;
    return await walletClient.signTypedData({
      account,
      domain: holdingsDomain(chainConfig, settlementVersion),
      types: {
        OperatorApproval: [
          { name: "user", type: "address" },
          { name: "operator", type: "address" },
          { name: "approved", type: "bool" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "OperatorApproval",
      message: {
        user: params.user,
        operator: params.operator,
        approved: params.approved,
        nonce: params.nonce,
        deadline: params.deadline,
      },
    });
  } catch (err) {
    throw new ContextSigningError("Failed to sign operator approval", err);
  }
}

export function getDefaultSettlementAddressForSigning(
  chainConfig: ChainConfig,
  settlementVersion: SettlementVersion = chainConfig.defaultSettlementVersion,
) {
  return getSettlementAddress(chainConfig, settlementVersion);
}

export function getDefaultHoldingsAddressForSigning(
  chainConfig: ChainConfig,
  settlementVersion: SettlementVersion = chainConfig.defaultSettlementVersion,
) {
  return getHoldingsAddress(chainConfig, settlementVersion);
}
