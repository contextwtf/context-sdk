import type { Hex } from "viem";
import { ContextConfigError } from "./errors.js";

const MARKET_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function validateMarketId(marketId: string): Hex {
  if (!MARKET_ID_PATTERN.test(marketId)) {
    throw new ContextConfigError(
      `Invalid marketId: expected 0x-prefixed 32-byte hex string, got "${marketId}"`,
    );
  }

  return marketId as Hex;
}
