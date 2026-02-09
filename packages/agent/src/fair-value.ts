import type { MarketSnapshot } from "./strategy.js";

export interface FairValueEstimate {
  /** YES fair value in cents (1-99). */
  yesCents: number;
  /** Confidence in the estimate (0-1). Low confidence = widen spread. */
  confidence: number;
}

export interface FairValueProvider {
  /** Human-readable name for logging. */
  readonly name: string;
  /** Estimate fair value from a market snapshot. */
  estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate>;
}
