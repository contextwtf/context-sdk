import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
} from "../strategy.js";

export interface OracleTrackerOptions {
  /** Markets to track: explicit IDs or search query. */
  markets: MarketSelector;
  /** Minimum oracle confidence to act on (0-1). Default: 0.75. */
  minConfidence?: number;
  /** Size of each order in contracts. Default: 10. */
  orderSize?: number;
  /** Min edge: only buy if price is this many cents below oracle signal. Default: 5. */
  minEdgeCents?: number;
}

/**
 * Oracle Tracker Strategy
 *
 * Buys YES when oracle confidence exceeds threshold and the
 * market price is below the oracle's implied probability.
 *
 * Logic:
 * 1. For each market, find the highest-confidence oracle signal
 * 2. If confidence >= threshold, compare oracle probability to best ask
 * 3. If ask price is at least minEdgeCents below oracle probability, buy
 */
export class OracleTrackerStrategy implements Strategy {
  readonly name = "Oracle Tracker";

  private readonly selector: MarketSelector;
  private readonly minConfidence: number;
  private readonly orderSize: number;
  private readonly minEdgeCents: number;

  constructor(options: OracleTrackerOptions) {
    this.selector = options.markets;
    this.minConfidence = options.minConfidence ?? 0.75;
    this.orderSize = options.orderSize ?? 10;
    this.minEdgeCents = options.minEdgeCents ?? 5;
  }

  async selectMarkets(): Promise<MarketSelector> {
    return this.selector;
  }

  async evaluate(
    markets: MarketSnapshot[],
    _state: AgentState,
  ): Promise<Action[]> {
    const actions: Action[] = [];

    for (const snapshot of markets) {
      const action = this.evaluateMarket(snapshot);
      actions.push(action);
    }

    return actions;
  }

  private evaluateMarket(snapshot: MarketSnapshot): Action {
    const { market, oracleSignals, orderbook } = snapshot;

    // Find highest-confidence oracle signal
    if (oracleSignals.length === 0) {
      return { type: "no_action", reason: `No oracle signals for ${market.id}` };
    }

    const bestSignal = oracleSignals.reduce((best, s) =>
      s.confidence > best.confidence ? s : best,
    );

    if (bestSignal.confidence < this.minConfidence) {
      return {
        type: "no_action",
        reason: `Oracle confidence ${(bestSignal.confidence * 100).toFixed(0)}% < ${(this.minConfidence * 100).toFixed(0)}% threshold`,
      };
    }

    // Oracle probability as cents (0-100)
    const oracleCents = Math.round(bestSignal.confidence * 100);

    // Find best ask (cheapest YES available)
    const bestAsk = orderbook.asks[0];
    if (!bestAsk) {
      return { type: "no_action", reason: "No asks in orderbook" };
    }

    const askCents = Math.round(bestAsk.price * 100);
    const edge = oracleCents - askCents;

    if (edge < this.minEdgeCents) {
      return {
        type: "no_action",
        reason: `Edge ${edge}¢ < min ${this.minEdgeCents}¢ (oracle: ${oracleCents}¢, ask: ${askCents}¢)`,
      };
    }

    // Buy YES at the ask price
    return {
      type: "place_order",
      marketId: market.id,
      outcome: "yes",
      side: "buy",
      priceCents: askCents,
      size: this.orderSize,
    };
  }
}
