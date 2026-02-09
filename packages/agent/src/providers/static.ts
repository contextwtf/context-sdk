import type { MarketSnapshot } from "../strategy.js";
import type { FairValueEstimate, FairValueProvider } from "../fair-value.js";

export class StaticFairValue implements FairValueProvider {
  readonly name = "Static Fair Value";

  private readonly yesCents: number;
  private readonly confidence: number;

  constructor(yesCents: number, confidence = 1) {
    this.yesCents = Math.max(1, Math.min(99, Math.round(yesCents)));
    this.confidence = Math.max(0, Math.min(1, confidence));
  }

  async estimate(_snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    return { yesCents: this.yesCents, confidence: this.confidence };
  }
}
