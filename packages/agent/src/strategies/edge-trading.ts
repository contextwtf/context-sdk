/**
 * Edge Trading Strategy — Price Corrector
 *
 * Directional trading strategy that compares LLM fair value to market price
 * and aggressively corrects mispricings by sweeping the book.
 *
 * Key behaviors:
 * - SELL YES into overpriced bids (not BUY NO — which doesn't cross)
 * - BUY YES at underpriced asks
 * - Sweeps all mispriced levels, not just top-of-book
 * - No cooldowns — corrects every cycle to keep prices in line
 * - Requires minted inventory (complete sets) to sell both sides
 */

import type { FairValueProvider, FairValueEstimate } from "../fair-value.js";
import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
} from "../strategy.js";

// ─── Types ───

export interface EdgeTradingOptions {
  /** Markets to trade. */
  markets: MarketSelector;
  /** Fair value provider (e.g., LlmFairValue). */
  fairValueProvider: FairValueProvider;
  /** Minimum edge in cents to trigger a trade. Default: 5. */
  minEdgeCents?: number;
  /** Minimum confidence from FV provider to trade. Default: 0.6. */
  minConfidence?: number;
  /** Base order size in contracts. Default: 3. */
  baseSize?: number;
  /** Maximum order size per level. Default: 10. */
  maxOrderSize?: number;
  /** Maximum net position per market (contracts, each direction). Default: 30. */
  maxPositionPerMarket?: number;
}

// ─── Strategy ───

export class EdgeTradingStrategy implements Strategy {
  readonly name = "Edge Trader";

  private readonly selector: MarketSelector;
  private readonly provider: FairValueProvider;
  private readonly minEdgeCents: number;
  private readonly minConfidence: number;
  private readonly baseSize: number;
  private readonly maxOrderSize: number;
  private readonly maxPositionPerMarket: number;

  constructor(options: EdgeTradingOptions) {
    this.selector = options.markets;
    this.provider = options.fairValueProvider;
    this.minEdgeCents = options.minEdgeCents ?? 5;
    this.minConfidence = options.minConfidence ?? 0.6;
    this.baseSize = options.baseSize ?? 3;
    this.maxOrderSize = options.maxOrderSize ?? 10;
    this.maxPositionPerMarket = options.maxPositionPerMarket ?? 30;
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
      const marketActions = await this.evaluateMarket(snapshot, state);
      actions.push(...marketActions);
    }

    return actions;
  }

  onFill(fill: any) {
    this.provider.onFill?.(fill);
  }

  // ─── Per-Market Evaluation ───

  private async evaluateMarket(
    snapshot: MarketSnapshot,
    state: AgentState,
  ): Promise<Action[]> {
    const { market, orderbook } = snapshot;
    const marketId = market.id;

    // Get fair value estimate
    const fv = await this.provider.estimate(snapshot);

    // Check confidence
    if (fv.confidence < this.minConfidence) {
      return [{
        type: "no_action",
        reason: `Low confidence: ${(fv.confidence * 100).toFixed(0)}% < ${(this.minConfidence * 100).toFixed(0)}% threshold`,
      }];
    }

    const netPosition = this.getNetPosition(state, marketId);
    const actions: Action[] = [];

    // Cancel our stale open orders for this market — they're from previous
    // cycles and may be at outdated prices. Fresh orders will be placed below.
    const staleOrders = state.openOrders.filter(o => o.marketId === marketId);
    for (const order of staleOrders) {
      actions.push({ type: "cancel_order", nonce: order.nonce });
    }

    // Log FV for every market (even if no edge)
    const title = (market.title || (market as any).question || "Unknown").slice(0, 50);
    const id = market.id.slice(0, 10);
    const conf = fv.confidence >= 0.8 ? "high" : fv.confidence >= 0.6 ? "med" : "low";
    const mid = orderbook.bids[0] && orderbook.asks[0]
      ? Math.round((orderbook.bids[0].price + orderbook.asks[0].price) / 2)
      : orderbook.bids[0] ? Math.round(orderbook.bids[0].price)
      : orderbook.asks[0] ? Math.round(orderbook.asks[0].price) : 0;

    // ── Sweep overpriced bids: SELL YES ──
    // Bids are sorted descending (highest first). Sell into any bid where
    // bidPrice - FV >= minEdge. This directly crosses with YES bids.
    let sellCapacity = this.maxPositionPerMarket + netPosition; // how much more YES we can sell
    for (const level of orderbook.bids) {
      if (sellCapacity <= 0) break;
      const bidCents = Math.round(level.price);
      const edge = bidCents - fv.yesCents;
      if (edge < this.minEdgeCents) break; // bids sorted desc, no more edge below

      const size = Math.min(
        this.sizeForEdge(edge),
        Math.floor(level.size),
        sellCapacity,
      );
      if (size <= 0) continue;

      sellCapacity -= size;
      actions.push({
        type: "place_order",
        marketId,
        outcome: "yes",
        side: "sell",
        priceCents: bidCents,
        size,
      });
    }

    // ── Sweep underpriced asks: BUY YES ──
    // Asks are sorted ascending (lowest first). Buy any ask where
    // FV - askPrice >= minEdge.
    let buyCapacity = this.maxPositionPerMarket - netPosition; // how much more YES we can buy
    for (const level of orderbook.asks) {
      if (buyCapacity <= 0) break;
      const askCents = Math.round(level.price);
      const edge = fv.yesCents - askCents;
      if (edge < this.minEdgeCents) break; // asks sorted asc, no more edge above

      const size = Math.min(
        this.sizeForEdge(edge),
        Math.floor(level.size),
        buyCapacity,
      );
      if (size <= 0) continue;

      buyCapacity -= size;
      actions.push({
        type: "place_order",
        marketId,
        outcome: "yes",
        side: "buy",
        priceCents: askCents,
        size,
      });
    }

    // Log summary
    if (actions.length > 0) {
      const sellActions = actions.filter(a => a.type === "place_order" && (a as any).side === "sell");
      const buyActions = actions.filter(a => a.type === "place_order" && (a as any).side === "buy");
      const parts: string[] = [];
      if (sellActions.length > 0) {
        const totalSell = sellActions.reduce((s, a) => s + ((a as any).size ?? 0), 0);
        const topPrice = (sellActions[0] as any).priceCents;
        parts.push(`SELL YES ${totalSell} (top @ ${topPrice}¢)`);
      }
      if (buyActions.length > 0) {
        const totalBuy = buyActions.reduce((s, a) => s + ((a as any).size ?? 0), 0);
        const topPrice = (buyActions[0] as any).priceCents;
        parts.push(`BUY YES ${totalBuy} (top @ ${topPrice}¢)`);
      }
      console.log(
        `[edge-trader] ${title}... (${id}): FV=${fv.yesCents}¢ (${conf}),`,
        `Market mid=${mid}¢ →`,
        parts.join(" + "),
      );
    }

    if (actions.length === 0) {
      return [{
        type: "no_action",
        reason: `No edge: FV=${fv.yesCents}¢, mid=${mid}¢ (need ${this.minEdgeCents}¢)`,
      }];
    }

    return actions;
  }

  // ─── Helpers ───

  /** Compute order size scaled by edge magnitude, capped at maxOrderSize. */
  private sizeForEdge(edgeCents: number): number {
    const edgeMultiple = Math.floor(edgeCents / this.minEdgeCents);
    return Math.min(edgeMultiple * this.baseSize, this.maxOrderSize);
  }

  /**
   * Get net YES position for a market from agent state.
   * Positive = long YES, Negative = short YES (long NO).
   */
  private getNetPosition(state: AgentState, marketId: string): number {
    const positions = state.portfolio?.positions;
    if (!positions || !Array.isArray(positions)) return 0;

    let net = 0;
    for (const pos of positions) {
      if (pos.marketId === marketId) {
        if (pos.outcome === "yes") {
          net += pos.size;
        } else if (pos.outcome === "no") {
          net -= pos.size;
        }
      }
    }
    return net;
  }
}
