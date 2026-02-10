import type { Fill } from "@context-markets/sdk";
import type { MarketSnapshot } from "./strategy.js";

export interface FairValueEstimate {
  /** YES fair value in cents (1-99). */
  yesCents: number;
  /** Confidence in the estimate (0-1). Low confidence = widen spread. */
  confidence: number;
  /** LLM reasoning or evidence summary. */
  reasoning?: string;
  /** Provider-specific data (game state, source, etc). */
  metadata?: Record<string, unknown>;
  /** How long to cache this estimate (ms). Provider hint for the FairValueService. */
  cacheTtlMs?: number;
}

export interface FairValueProvider {
  /** Human-readable name for logging. */
  readonly name: string;
  /** Estimate fair value from a market snapshot. */
  estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate>;
  /** Called when an order fill is detected. Optional — allows providers to react to flow. */
  onFill?(fill: Fill): void;
}
