/**
 * Resolution Sniper Strategy
 *
 * Detects markets near resolution (final scores, high-confidence oracles, extreme
 * prices) and pushes prices to 0 or 100 to capture the remaining spread.
 *
 * Pairs with ResolutionFairValue provider which returns:
 * - { yesCents: 99, confidence: 1.0 } for resolved YES
 * - { yesCents: 1, confidence: 1.0 } for resolved NO
 * - { yesCents: 50, confidence: 0.0 } for unresolved (skipped)
 *
 * SDK improvement surfaced: The runtime doesn't distinguish "active but about to
 * resolve" from "active and ongoing." A market lifecycle hook (onMarketNearResolution)
 * would let strategies react to state transitions without polling.
 */

import type { FairValueProvider } from "../fair-value.js";
import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
} from "../strategy.js";

// ─── Types ───

export interface ResolutionSniperOptions {
  /** Markets to scan — typically all active. */
  markets: MarketSelector;
  /** Fair value provider (ResolutionFairValue). Optional if FairValueService is configured at runtime. */
  fairValueProvider?: FairValueProvider;
  /** Max order size per sweep. Default: 500. */
  maxOrderSize?: number;
  /** Min price gap in cents to trade. Default: 5. */
  minPriceGapCents?: number;
}

// ─── Strategy ───

export class ResolutionSniperStrategy implements Strategy {
  readonly name = "Resolution Sniper";

  private readonly selector: MarketSelector;
  private readonly provider?: FairValueProvider;
  private readonly maxOrderSize: number;
  private readonly minPriceGapCents: number;

  constructor(options: ResolutionSniperOptions) {
    this.selector = options.markets;
    this.provider = options.fairValueProvider;
    this.maxOrderSize = options.maxOrderSize ?? 500;
    this.minPriceGapCents = options.minPriceGapCents ?? 5;
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
    const title = (market.title || (market as any).question || "Unknown").slice(0, 50);
    const id = market.id.slice(0, 10);

    // Get resolution signal: service > provider > skip
    const fv = snapshot.fairValue
      ?? (this.provider ? await this.provider.estimate(snapshot) : null);

    if (!fv) {
      return [{ type: "no_action", reason: "No FV source configured" }];
    }

    // Skip unresolved markets (confidence gate)
    if (fv.confidence < 0.5) {
      return [{ type: "no_action", reason: `Not resolved: ${title}` }];
    }

    const resolvedYes = fv.yesCents >= 90;
    const resolvedNo = fv.yesCents <= 10;

    if (!resolvedYes && !resolvedNo) {
      return [{ type: "no_action", reason: `Ambiguous resolution: FV=${fv.yesCents}¢` }];
    }

    // Check if market already converged — nothing to capture
    const bestBid = orderbook.bids[0]?.price ?? 0;
    const bestAsk = orderbook.asks[0]?.price ?? 100;
    const mid = orderbook.bids[0] && orderbook.asks[0]
      ? Math.round((bestBid + bestAsk) / 2)
      : bestBid || bestAsk;

    if (resolvedYes && mid >= 98) {
      return [{ type: "no_action", reason: `Already converged YES: mid=${mid}¢` }];
    }
    if (resolvedNo && mid <= 2) {
      return [{ type: "no_action", reason: `Already converged NO: mid=${mid}¢` }];
    }

    const actions: Action[] = [];

    // Cancel stale orders for this market
    const staleOrders = state.openOrders.filter((o) => o.marketId === marketId);
    for (const order of staleOrders) {
      actions.push({ type: "cancel_order", nonce: order.nonce });
    }

    if (resolvedYes) {
      // Resolved YES → BUY YES aggressively (sweep asks below 95¢)
      const sweepPrice = Math.min(95, bestAsk + this.minPriceGapCents);
      if (bestAsk < 95) {
        const netPos = this.getNetPosition(state, marketId);
        const capacity = this.maxOrderSize - Math.max(0, netPos);

        if (capacity > 0) {
          actions.push({
            type: "place_order",
            marketId,
            outcome: "yes",
            side: "buy",
            priceCents: sweepPrice,
            size: capacity,
          });

          console.log(
            `[sniper] ${title}... (${id}): RESOLVED YES → BUY ${capacity} YES @ ${sweepPrice}¢ (ask=${bestAsk}¢)`,
          );
        }
      } else {
        console.log(
          `[sniper] ${title}... (${id}): RESOLVED YES but ask=${bestAsk}¢ ≥ 95¢, no edge`,
        );
      }
    } else {
      // Resolved NO → SELL YES aggressively (sweep bids above 5¢)
      const sweepPrice = Math.max(5, bestBid - this.minPriceGapCents);
      if (bestBid > 5) {
        const netPos = this.getNetPosition(state, marketId);
        const capacity = this.maxOrderSize + Math.min(0, netPos);

        if (capacity > 0) {
          actions.push({
            type: "place_order",
            marketId,
            outcome: "yes",
            side: "sell",
            priceCents: sweepPrice,
            size: capacity,
          });

          console.log(
            `[sniper] ${title}... (${id}): RESOLVED NO → SELL ${capacity} YES @ ${sweepPrice}¢ (bid=${bestBid}¢)`,
          );
        }
      } else {
        console.log(
          `[sniper] ${title}... (${id}): RESOLVED NO but bid=${bestBid}¢ ≤ 5¢, no edge`,
        );
      }
    }

    if (actions.filter((a) => a.type === "place_order").length === 0) {
      return [{ type: "no_action", reason: `Resolved but no spread to capture` }];
    }

    return actions;
  }

  // ─── Helpers ───

  private getNetPosition(state: AgentState, marketId: string): number {
    const positions = state.portfolio?.positions;
    if (!positions || !Array.isArray(positions)) return 0;

    let net = 0;
    for (const pos of positions) {
      if (pos.marketId === marketId) {
        if (pos.outcome === "yes") net += pos.size;
        else if (pos.outcome === "no") net -= pos.size;
      }
    }
    return net;
  }
}
