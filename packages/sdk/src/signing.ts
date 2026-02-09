import {
  type Account,
  type Address,
  type Hex,
  type WalletClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  privateKeyToAccount,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  EIP712_DOMAIN,
  ORDER_TYPES,
  CANCEL_TYPES,
} from "./constants.js";
import { ContextSigningError } from "./errors.js";
import type { SignerInput } from "./types.js";

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

/**
 * Resolve a SignerInput into a viem Account and WalletClient.
 */
export function resolveSigner(input: SignerInput): {
  account: Account;
  walletClient: WalletClient;
} {
  if ("privateKey" in input) {
    const account = privateKeyToAccount(input.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });
    return { account, walletClient };
  }

  if ("account" in input) {
    const walletClient = createWalletClient({
      account: input.account,
      chain: baseSepolia,
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

/**
 * Generate a random nonce for orders.
 */
export function randomNonce(): Hex {
  return keccak256(toBytes(`${Date.now()}_${Math.random()}`));
}

/**
 * Sign an order using EIP-712.
 */
export async function signOrder(
  walletClient: WalletClient,
  account: Account,
  order: OrderMessage,
): Promise<Hex> {
  try {
    return await walletClient.signTypedData({
      account,
      domain: EIP712_DOMAIN,
      types: ORDER_TYPES,
      primaryType: "Order",
      message: order,
    });
  } catch (err) {
    throw new ContextSigningError("Failed to sign order", err);
  }
}

/**
 * Sign a cancel using EIP-712.
 */
export async function signCancel(
  walletClient: WalletClient,
  account: Account,
  trader: Address,
  nonce: Hex,
): Promise<Hex> {
  try {
    return await walletClient.signTypedData({
      account,
      domain: EIP712_DOMAIN,
      types: CANCEL_TYPES,
      primaryType: "CancelNonce",
      message: { trader, nonce },
    });
  } catch (err) {
    throw new ContextSigningError("Failed to sign cancel", err);
  }
}
