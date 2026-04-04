import {
  PRICE_MULTIPLIER,
  SIZE_MULTIPLIER,
  FEE_DIVISOR,
} from "../constants.js";

/**
 * Convert price in cents (1-99) to on-chain representation.
 * Example: 25 cents -> 250_000n
 */
export function encodePriceCents(priceCents: number): bigint {
  if (!Number.isFinite(priceCents) || priceCents < 1 || priceCents > 99) {
    throw new RangeError(`priceCents must be 1-99, got ${priceCents}`);
  }
  return BigInt(Math.round(priceCents * Number(PRICE_MULTIPLIER)));
}

/**
 * Convert size in shares to on-chain representation.
 * Example: 10 shares -> 10_000_000n
 */
export function encodeSize(size: number): bigint {
  if (!Number.isFinite(size) || size < 0.01) {
    throw new RangeError(`size must be >= 0.01, got ${size}`);
  }
  return BigInt(Math.round(size * Number(SIZE_MULTIPLIER)));
}

/**
 * Calculate max fee: 1% of notional, minimum 1n.
 * notional = price x size (in on-chain units)
 */
export function calculateMaxFee(price: bigint, size: bigint): bigint {
  const fee = (price * size) / FEE_DIVISOR / SIZE_MULTIPLIER;
  return fee < 1n ? 1n : fee;
}

/**
 * Convert a pre-fee collateral budget in USDC units to the minimum share
 * amount implied by a limit price. Used to preserve the high-level
 * market-order API for SettlementV2 buys, where the signing layer adds
 * `maxFee` on top of `buyValue` when producing the final onchain cap.
 */
export function estimateSharesForBuyBudget(
  buyValue: bigint,
  price: bigint,
): bigint {
  return price > 0n ? (buyValue * SIZE_MULTIPLIER) / price : 0n;
}

/** Decode on-chain price back to cents. */
export function decodePriceCents(raw: bigint): number {
  return Number(raw) / Number(PRICE_MULTIPLIER);
}

/** Decode on-chain size back to shares. */
export function decodeSize(raw: bigint): number {
  return Number(raw) / Number(SIZE_MULTIPLIER);
}
