import type { MarketSnapshot } from "../strategy.js";
import type { FairValueEstimate, FairValueProvider } from "../fair-value.js";

/**
 * Tries providers in order, returns the first estimate with confidence
 * above the threshold. Falls through to the last provider unconditionally.
 */
export class ChainedFairValue implements FairValueProvider {
  readonly name = "Chained Fair Value";

  private readonly providers: FairValueProvider[];
  private readonly minConfidence: number;

  constructor(providers: FairValueProvider[], minConfidence = 0.3) {
    if (providers.length === 0) {
      throw new Error("ChainedFairValue requires at least one provider");
    }
    this.providers = providers;
    this.minConfidence = minConfidence;
  }

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    for (let i = 0; i < this.providers.length; i++) {
      const estimate = await this.providers[i].estimate(snapshot);
      // Last provider is always accepted (fallback)
      if (i === this.providers.length - 1 || estimate.confidence >= this.minConfidence) {
        return estimate;
      }
    }

    // Unreachable — loop always returns on last provider
    return this.providers[this.providers.length - 1].estimate(snapshot);
  }
}
