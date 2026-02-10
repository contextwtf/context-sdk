/**
 * Edge Trading Strategy — Price Corrector
 *
 * Directional trading strategy that compares LLM fair value to market price
 * and aggressively corrects mispricings.
 *
 * Key behaviors:
 * - Places single large orders at FV ± minEdge to sweep all mispriced liquidity
 * - Unfilled portion rests as standing order, catching new MM quotes between cycles
 * - SELL YES when market overpriced, BUY YES when underpriced
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
  /** Fair value provider (e.g., LlmFairValue). Optional if FairValueService is configured at runtime. */
  fairValueProvider?: FairValueProvider;
  /** Minimum edge in cents to trigger a trade. Default: 5. */
  minEdgeCents?: number;
  /** Minimum confidence from FV provider to trade. Default: 0.6. */
  minConfidence?: number;
  /** Maximum net position per market (contracts, each direction). Default: 30. */
  maxPositionPerMarket?: number;
}

// ─── Strategy ───

export class EdgeTradingStrategy implements Strategy {
  readonly name = "Edge Trader";

  private readonly selector: MarketSelector;
  private readonly provider?: FairValueProvider;
  private readonly minEdgeCents: number;
  private readonly minConfidence: number;
  private readonly maxPositionPerMarket: number;

  constructor(options: EdgeTradingOptions) {
    this.selector = options.markets;
    this.provider = options.fairValueProvider;
    this.minEdgeCents = options.minEdgeCents ?? 5;

    this.minConfidence = options.minConfidence ?? 0.6;
    this.maxPositionPerMarket = options.maxPositionPerMarket ?? 500;
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
    this.provider?.onFill?.(fill);
  }

  // ─── Per-Market Evaluation ───

  private async evaluateMarket(
    snapshot: MarketSnapshot,
    state: AgentState,
  ): Promise<Action[]> {
    const { market, orderbook } = snapshot;
    const marketId = market.id;

    // Get fair value estimate: service > provider > skip
    const fv = snapshot.fairValue
      ?? (this.provider ? await this.provider.estimate(snapshot) : null);

    if (!fv) {
      return [{ type: "no_action", reason: "No FV source configured" }];
    }

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
    // cycles and may be at outdated FV. Fresh orders will be placed below.
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

    // ── SELL YES: market overpriced ──
    // Place one large sell order at FV + minEdge. The matching engine will
    // fill against all bids above this price. Unfilled portion rests as an
    // ask, catching any new bids that come in between cycles.
    const minSellPrice = fv.yesCents + this.minEdgeCents;
    const sellCapacity = this.maxPositionPerMarket + netPosition;
    const bestBid = orderbook.bids[0]?.price ?? 0;

    if (sellCapacity > 0 && bestBid >= minSellPrice) {
      actions.push({
        type: "place_order",
        marketId,
        outcome: "yes",
        side: "sell",
        priceCents: Math.max(1, fv.yesCents + this.minEdgeCents),
        size: sellCapacity,
      });

      console.log(
        `[edge-trader] ${title}... (${id}): FV=${fv.yesCents}¢ (${conf}),`,
        `Market mid=${mid}¢ → SELL YES ${sellCapacity} @ ${fv.yesCents + this.minEdgeCents}¢`,
      );
    }

    // ── BUY YES: market underpriced ──
    // Place one large buy order at FV - minEdge. The matching engine will
    // fill against all asks below this price. Unfilled portion rests as a
    // bid, catching any new asks that come in between cycles.
    const maxBuyPrice = fv.yesCents - this.minEdgeCents;
    const buyCapacity = this.maxPositionPerMarket - netPosition;
    const bestAsk = orderbook.asks[0]?.price ?? 100;

    if (buyCapacity > 0 && bestAsk <= maxBuyPrice) {
      actions.push({
        type: "place_order",
        marketId,
        outcome: "yes",
        side: "buy",
        priceCents: Math.min(99, fv.yesCents - this.minEdgeCents),
        size: buyCapacity,
      });

      console.log(
        `[edge-trader] ${title}... (${id}): FV=${fv.yesCents}¢ (${conf}),`,
        `Market mid=${mid}¢ → BUY YES ${buyCapacity} @ ${fv.yesCents - this.minEdgeCents}¢`,
      );
    }

    if (actions.filter(a => a.type === "place_order").length === 0) {
      // Log why we're not trading — helps debug stuck markets
      const reasons: string[] = [];
      if (sellCapacity <= 0) reasons.push(`sell capped (pos=${netPosition})`);
      else if (bestBid < minSellPrice) reasons.push(`no sell edge (bid=${bestBid}¢ < ${minSellPrice}¢)`);
      if (buyCapacity <= 0) reasons.push(`buy capped (pos=${netPosition})`);
      else if (bestAsk > maxBuyPrice) reasons.push(`no buy edge (ask=${bestAsk}¢ > ${maxBuyPrice}¢)`);

      console.log(
        `[edge-trader] ${title}... (${id}): FV=${fv.yesCents}¢ (${conf}), mid=${mid}¢ → NO TRADE: ${reasons.join(", ")}`,
      );

      return [{
        type: "no_action",
        reason: `No trade: ${reasons.join(", ")}`,
      }];
    }

    return actions;
  }

  // ─── Helpers ───

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
