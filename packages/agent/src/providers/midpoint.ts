import type { MarketSnapshot } from "../strategy.js";
import type { FairValueEstimate, FairValueProvider } from "../fair-value.js";

export class MidpointFairValue implements FairValueProvider {
  readonly name = "Midpoint Fair Value";

  private readonly fallbackCents: number;

  constructor(fallbackCents = 50) {
    this.fallbackCents = Math.max(1, Math.min(99, Math.round(fallbackCents)));
  }

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    const { orderbook } = snapshot;
    const bestBid = orderbook.bids[0];
    const bestAsk = orderbook.asks[0];

    if (!bestBid && !bestAsk) {
      return { yesCents: this.fallbackCents, confidence: 0.3 };
    }

    const bidCents = bestBid ? bestBid.price * 100 : 0;
    const askCents = bestAsk ? bestAsk.price * 100 : 100;
    const mid = Math.round((bidCents + askCents) / 2);
    const yesCents = Math.max(1, Math.min(99, mid));

    // Wider spread = lower confidence
    const spreadCents = askCents - bidCents;
    const confidence = spreadCents <= 0 ? 1 : Math.max(0.1, 1 - spreadCents / 100);

    return { yesCents, confidence };
  }
}
