/**
 * pricer-fn.ts — Pure math for computing MM quotes.
 *
 * No LLM, no side effects. Takes fair value + confidence + position → returns quotes.
 * Extracted from the AdaptiveMM prompt logic in examples/team/agents/pricer.ts.
 */

import type { Quote, RiskLimits } from "./types-v2.js";

// ─── Config ───

export interface PricerParams {
  fairValue: number;           // cents (1-99)
  confidence: number;          // 0-1 — higher = tighter spreads, larger size
  minSpread: number;           // cents
  maxSpread: number;           // cents
  position: { yes: number; no: number };
  maxSize: number;             // max contracts per side
  minSize: number;             // minimum contracts per side
  skewFactor: number;          // how much inventory shifts quotes (default: 0.5)
}

// ─── Helpers ───

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Core ───

/**
 * Compute bid and ask quotes for a market.
 *
 * Spread: lerp(maxSpread, minSpread, confidence) — tighter when confident.
 * Inventory skew: net position * skewFactor shifts bid/ask to reduce exposure.
 * Size: lerp(minSize, maxSize, confidence) — larger when confident.
 * Prices clamped to 1-99.
 */
export function computeQuotes(params: PricerParams): Quote[] {
  const {
    fairValue,
    confidence,
    minSpread,
    maxSpread,
    position,
    maxSize,
    minSize,
    skewFactor,
  } = params;

  // Spread: wider when uncertain, tighter when confident
  const spreadCents = lerp(maxSpread, minSpread, confidence);
  const halfSpread = spreadCents / 2;

  // Inventory skew: if long YES (net > 0), lower bid / raise ask to shed inventory
  const netPosition = position.yes - position.no;
  const skew = Math.round(netPosition * skewFactor);

  const bidPrice = clamp(Math.round(fairValue - halfSpread - skew), 1, 99);
  const askPrice = clamp(Math.round(fairValue + halfSpread - skew), 1, 99);

  // Ensure bid < ask (crossed would be caught by risk middleware, but prevent here too)
  if (bidPrice >= askPrice) {
    const mid = Math.round(fairValue);
    return [
      { side: "buy", outcome: "yes", priceCents: clamp(mid - 1, 1, 98), size: minSize },
      { side: "sell", outcome: "yes", priceCents: clamp(mid + 1, 2, 99), size: minSize },
    ];
  }

  // Size: larger when confident
  const size = Math.max(minSize, Math.round(lerp(minSize, maxSize, confidence)));

  return [
    { side: "buy", outcome: "yes", priceCents: bidPrice, size },
    { side: "sell", outcome: "yes", priceCents: askPrice, size },
  ];
}

/**
 * Build PricerParams from defaults + risk limits.
 */
export function buildPricerParams(
  fairValue: number,
  confidence: number,
  position: { yes: number; no: number },
  limits: RiskLimits,
  overrides?: { maxSize?: number; skewFactor?: number },
): PricerParams {
  return {
    fairValue,
    confidence,
    minSpread: limits.minSpread,
    maxSpread: limits.maxSpread,
    position,
    maxSize: overrides?.maxSize ?? 100,
    minSize: limits.minSize,
    skewFactor: overrides?.skewFactor ?? 0.5,
  };
}
