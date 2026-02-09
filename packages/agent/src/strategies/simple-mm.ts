import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
} from "../strategy.js";

export interface SimpleMmOptions {
  /** Markets to make markets on. */
  markets: MarketSelector;
  /** Half-spread in cents (bid and ask offset from mid). Default: 3. */
  halfSpreadCents?: number;
  /** Size of each quote in contracts. Default: 10. */
  quoteSize?: number;
  /** Min mid-price move in cents to re-quote. Default: 2. */
  requoteDeltaCents?: number;
}

/**
 * Simple Market Maker Strategy
 *
 * Quotes bid and ask around the midpoint with a configurable spread.
 * Re-quotes when the midpoint moves beyond a threshold.
 *
 * Logic:
 * 1. Calculate midpoint from best bid/ask
 * 2. Place bid at mid - halfSpread, ask at mid + halfSpread
 * 3. If existing orders are outside requoteDelta of new prices, cancel+replace
 */
export class SimpleMmStrategy implements Strategy {
  readonly name = "Simple MM";

  private readonly selector: MarketSelector;
  private readonly halfSpreadCents: number;
  private readonly quoteSize: number;
  private readonly requoteDeltaCents: number;

  // Track our last quoted prices per market
  private lastQuotes = new Map<
    string,
    { bidCents: number; askCents: number; bidNonce: string; askNonce: string }
  >();

  constructor(options: SimpleMmOptions) {
    this.selector = options.markets;
    this.halfSpreadCents = options.halfSpreadCents ?? 3;
    this.quoteSize = options.quoteSize ?? 10;
    this.requoteDeltaCents = options.requoteDeltaCents ?? 2;
  }

  async selectMarkets(): Promise<MarketSelector> {
    return this.selector;
  }

  async evaluate(
    markets: MarketSnapshot[],
    state: AgentState,
  ): Promise<Action[]> {
    const actions: Action[] = [];

    for (const snapshot of markets) {
      const marketActions = this.evaluateMarket(snapshot, state);
      actions.push(...marketActions);
    }

    return actions;
  }

  private evaluateMarket(
    snapshot: MarketSnapshot,
    state: AgentState,
  ): Action[] {
    const { market, orderbook } = snapshot;
    const actions: Action[] = [];

    // Calculate midpoint
    const bestBid = orderbook.bids[0];
    const bestAsk = orderbook.asks[0];

    if (!bestBid && !bestAsk) {
      return [{ type: "no_action", reason: `No orderbook for ${market.id}` }];
    }

    const bidPrice = bestBid ? bestBid.price * 100 : 0;
    const askPrice = bestAsk ? bestAsk.price * 100 : 100;
    const mid = (bidPrice + askPrice) / 2;

    // Target prices
    const targetBid = Math.max(1, Math.round(mid - this.halfSpreadCents));
    const targetAsk = Math.min(99, Math.round(mid + this.halfSpreadCents));

    // Check if we already have quotes in this market
    const existing = this.lastQuotes.get(market.id);

    if (existing) {
      const bidDelta = Math.abs(existing.bidCents - targetBid);
      const askDelta = Math.abs(existing.askCents - targetAsk);

      if (bidDelta < this.requoteDeltaCents && askDelta < this.requoteDeltaCents) {
        return [{ type: "no_action", reason: `Quotes still fresh (delta: bid ${bidDelta}¢, ask ${askDelta}¢)` }];
      }

      // Cancel and replace bid
      if (bidDelta >= this.requoteDeltaCents) {
        actions.push({
          type: "cancel_replace",
          cancelNonce: existing.bidNonce,
          marketId: market.id,
          outcome: "yes",
          side: "buy",
          priceCents: targetBid,
          size: this.quoteSize,
        });
      }

      // Cancel and replace ask
      if (askDelta >= this.requoteDeltaCents) {
        actions.push({
          type: "cancel_replace",
          cancelNonce: existing.askNonce,
          marketId: market.id,
          outcome: "yes",
          side: "sell",
          priceCents: targetAsk,
          size: this.quoteSize,
        });
      }
    } else {
      // Place fresh bid and ask
      actions.push(
        {
          type: "place_order",
          marketId: market.id,
          outcome: "yes",
          side: "buy",
          priceCents: targetBid,
          size: this.quoteSize,
        },
        {
          type: "place_order",
          marketId: market.id,
          outcome: "yes",
          side: "sell",
          priceCents: targetAsk,
          size: this.quoteSize,
        },
      );
    }

    return actions;
  }

  onFill(order: { nonce: string; marketId?: string }): void {
    // If one of our quotes was filled, remove tracking so we re-quote
    if (order.marketId) {
      this.lastQuotes.delete(order.marketId);
    }
  }

  async onShutdown(): Promise<void> {
    this.lastQuotes.clear();
  }
}
