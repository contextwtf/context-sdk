import type { MarketSnapshot } from "../strategy.js";
import type { FairValueEstimate, FairValueProvider } from "../fair-value.js";

export class OracleFairValue implements FairValueProvider {
  readonly name = "Oracle Fair Value";

  private readonly fallbackCents: number;

  constructor(fallbackCents = 50) {
    this.fallbackCents = Math.max(1, Math.min(99, Math.round(fallbackCents)));
  }

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    const { oracleSignals } = snapshot;

    const withConfidence = oracleSignals.filter(
      (s) => typeof s.confidence === "number" && !isNaN(s.confidence),
    );

    if (withConfidence.length === 0) {
      return { yesCents: this.fallbackCents, confidence: 0.5 };
    }

    const best = withConfidence.reduce((a, b) =>
      b.confidence > a.confidence ? b : a,
    );

    const yesCents = Math.max(1, Math.min(99, Math.round(best.confidence * 100)));
    return { yesCents, confidence: best.confidence };
  }
}
