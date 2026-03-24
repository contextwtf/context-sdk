import {
  type Account,
  type Address,
  type Hex,
  type WalletClient,
  createWalletClient,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  settlementDomain,
  ORDER_TYPES,
  MARKET_ORDER_INTENT_TYPES,
  CANCEL_TYPES,
  type ChainConfig,
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

export async function signOrder(
  walletClient: WalletClient,
  account: Account,
  order: OrderMessage,
  chainConfig: ChainConfig,
): Promise<Hex> {
  try {
    return await walletClient.signTypedData({
      account,
      domain: settlementDomain(chainConfig),
      types: ORDER_TYPES,
      primaryType: "Order",
      message: order,
    });
  } catch (err) {
    throw new ContextSigningError("Failed to sign order", err);
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

export async function signMarketOrderIntent(
  walletClient: WalletClient,
  account: Account,
  intent: MarketOrderIntentMessage,
  chainConfig: ChainConfig,
): Promise<Hex> {
  try {
    return await walletClient.signTypedData({
      account,
      domain: settlementDomain(chainConfig),
      types: MARKET_ORDER_INTENT_TYPES,
      primaryType: "MarketOrderIntent",
      message: intent,
    });
  } catch (err) {
    throw new ContextSigningError("Failed to sign market order intent", err);
  }
}

export async function signCancel(
  walletClient: WalletClient,
  account: Account,
  trader: Address,
  nonce: Hex,
  chainConfig: ChainConfig,
): Promise<Hex> {
  try {
    return await walletClient.signTypedData({
      account,
      domain: settlementDomain(chainConfig),
      types: CANCEL_TYPES,
      primaryType: "CancelNonce",
      message: { trader, nonce },
    });
  } catch (err) {
    throw new ContextSigningError("Failed to sign cancel", err);
  }
}
