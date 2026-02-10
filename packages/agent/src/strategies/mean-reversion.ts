/**
 * Mean Reversion Strategy
 *
 * Tracks price history per market and trades mean reversion:
 * - Buys when price drops significantly below recent average
 * - Sells when price spikes above recent average
 * - Takes profit when price reverts toward mean
 * - Cuts losses if price moves further against position
 *
 * No FairValueProvider needed — computes its own signals from orderbook data.
 *
 * SDK improvements surfaced:
 * - No price history in runtime — strategies must maintain their own.
 *   A PriceHistoryService maintained by the runtime would be useful.
 * - No portfolio P&L tracking — mean reversion needs entry prices and
 *   unrealized P&L. AgentState could include unrealizedPnl per position.
 */

import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
} from "../strategy.js";

// ─── Types ───

export interface MeanReversionOptions {
  /** Markets to watch. */
  markets: MarketSelector;
  /** Rolling window size in cycles. Default: 20 (~10 min at 30s). */
  windowSize?: number;
  /** Entry threshold in standard deviations. Default: 1.5. */
  entryThreshold?: number;
  /** Exit threshold in standard deviations (close to mean). Default: 0.3. */
  exitThreshold?: number;
  /** Stop-loss threshold in standard deviations. Default: 3.0. */
  stopLossThreshold?: number;
  /** Order size in contracts per trade. Default: 20. */
  orderSize?: number;
  /** Max net position per market. Default: 100. */
  maxPositionPerMarket?: number;
}

interface PriceHistory {
  prices: number[];
  mean: number;
  stdDev: number;
  entryPrice?: number;
  positionSide?: "long" | "short";
}

// ─── Strategy ───

export class MeanReversionStrategy implements Strategy {
  readonly name = "Mean Reversion";

  private readonly selector: MarketSelector;
  private readonly windowSize: number;
  private readonly entryThreshold: number;
  private readonly exitThreshold: number;
  private readonly stopLossThreshold: number;
  private readonly orderSize: number;
  private readonly maxPositionPerMarket: number;

  /** In-memory price history per market. */
  private history = new Map<string, PriceHistory>();

  constructor(options: MeanReversionOptions) {
    this.selector = options.markets;
    this.windowSize = options.windowSize ?? 20;
    this.entryThreshold = options.entryThreshold ?? 1.5;
    this.exitThreshold = options.exitThreshold ?? 0.3;
    this.stopLossThreshold = options.stopLossThreshold ?? 3.0;
    this.orderSize = options.orderSize ?? 20;
    this.maxPositionPerMarket = options.maxPositionPerMarket ?? 100;
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

  async onShutdown(): Promise<void> {
    this.history.clear();
  }

  // ─── Per-Market Evaluation ───

  private evaluateMarket(snapshot: MarketSnapshot, state: AgentState): Action[] {
    const { market, orderbook } = snapshot;
    const marketId = market.id;
    const title = (market.title || (market as any).question || "Unknown").slice(0, 50);
    const id = market.id.slice(0, 10);

    // Calculate midpoint
    const bestBid = orderbook.bids[0]?.price;
    const bestAsk = orderbook.asks[0]?.price;

    if (bestBid === undefined || bestAsk === undefined) {
      return [{ type: "no_action", reason: `No orderbook for ${id}` }];
    }

    const mid = (bestBid + bestAsk) / 2;

    // Update price history
    const hist = this.getOrCreateHistory(marketId);
    hist.prices.push(mid);

    // Trim to window size
    if (hist.prices.length > this.windowSize) {
      hist.prices = hist.prices.slice(-this.windowSize);
    }

    // Need minimum history before trading
    if (hist.prices.length < Math.min(10, this.windowSize)) {
      console.log(
        `[mean-rev] ${title}... (${id}): Building history ${hist.prices.length}/${this.windowSize}, mid=${mid.toFixed(1)}¢`,
      );
      return [{ type: "no_action", reason: `Building history: ${hist.prices.length}/${this.windowSize}` }];
    }

    // Compute stats
    hist.mean = this.computeMean(hist.prices);
    hist.stdDev = this.computeStdDev(hist.prices, hist.mean);

    // Avoid division by zero — if prices haven't moved, nothing to trade
    if (hist.stdDev < 0.5) {
      return [{ type: "no_action", reason: `Low volatility: stdDev=${hist.stdDev.toFixed(2)}¢` }];
    }

    const zScore = (mid - hist.mean) / hist.stdDev;
    const netPos = this.getNetPosition(state, marketId);
    const actions: Action[] = [];

    // Cancel stale orders
    const staleOrders = state.openOrders.filter((o) => o.marketId === marketId);
    for (const order of staleOrders) {
      actions.push({ type: "cancel_order", nonce: order.nonce });
    }

    // ─── Position Management (exit/stop-loss) ───

    if (hist.positionSide === "long" && netPos > 0) {
      if (zScore >= -this.exitThreshold) {
        // Price reverted to mean — take profit
        console.log(
          `[mean-rev] ${title}... (${id}): TAKE PROFIT LONG — z=${zScore.toFixed(2)}, mean=${hist.mean.toFixed(1)}¢, mid=${mid.toFixed(1)}¢`,
        );
        actions.push({
          type: "place_order",
          marketId,
          outcome: "yes",
          side: "sell",
          priceCents: Math.max(1, Math.round(mid - 1)),
          size: Math.min(netPos, this.orderSize),
        });
        hist.positionSide = undefined;
        hist.entryPrice = undefined;
        return actions;
      }

      if (zScore <= -this.stopLossThreshold) {
        // Price moved further against us — stop loss
        console.log(
          `[mean-rev] ${title}... (${id}): STOP LOSS LONG — z=${zScore.toFixed(2)}, entry=${hist.entryPrice?.toFixed(1)}¢, mid=${mid.toFixed(1)}¢`,
        );
        actions.push({
          type: "place_order",
          marketId,
          outcome: "yes",
          side: "sell",
          priceCents: Math.max(1, Math.round(mid - 1)),
          size: Math.min(netPos, this.orderSize),
        });
        hist.positionSide = undefined;
        hist.entryPrice = undefined;
        return actions;
      }
    }

    if (hist.positionSide === "short" && netPos < 0) {
      if (zScore <= this.exitThreshold) {
        // Price reverted to mean — take profit
        console.log(
          `[mean-rev] ${title}... (${id}): TAKE PROFIT SHORT — z=${zScore.toFixed(2)}, mean=${hist.mean.toFixed(1)}¢, mid=${mid.toFixed(1)}¢`,
        );
        actions.push({
          type: "place_order",
          marketId,
          outcome: "yes",
          side: "buy",
          priceCents: Math.min(99, Math.round(mid + 1)),
          size: Math.min(Math.abs(netPos), this.orderSize),
        });
        hist.positionSide = undefined;
        hist.entryPrice = undefined;
        return actions;
      }

      if (zScore >= this.stopLossThreshold) {
        // Stop loss
        console.log(
          `[mean-rev] ${title}... (${id}): STOP LOSS SHORT — z=${zScore.toFixed(2)}, entry=${hist.entryPrice?.toFixed(1)}¢, mid=${mid.toFixed(1)}¢`,
        );
        actions.push({
          type: "place_order",
          marketId,
          outcome: "yes",
          side: "buy",
          priceCents: Math.min(99, Math.round(mid + 1)),
          size: Math.min(Math.abs(netPos), this.orderSize),
        });
        hist.positionSide = undefined;
        hist.entryPrice = undefined;
        return actions;
      }
    }

    // ─── New Entry Signals ───

    if (zScore <= -this.entryThreshold) {
      // Price below mean — BUY YES (expect reversion up)
      const buyCapacity = this.maxPositionPerMarket - netPos;
      if (buyCapacity > 0) {
        const size = Math.min(this.orderSize, buyCapacity);
        console.log(
          `[mean-rev] ${title}... (${id}): ENTRY LONG — z=${zScore.toFixed(2)}, mean=${hist.mean.toFixed(1)}¢, mid=${mid.toFixed(1)}¢, σ=${hist.stdDev.toFixed(2)}`,
        );
        actions.push({
          type: "place_order",
          marketId,
          outcome: "yes",
          side: "buy",
          priceCents: Math.min(99, Math.round(mid + 1)),
          size,
        });
        hist.positionSide = "long";
        hist.entryPrice = mid;
        return actions;
      }
    }

    if (zScore >= this.entryThreshold) {
      // Price above mean — SELL YES (expect reversion down)
      const sellCapacity = this.maxPositionPerMarket + netPos;
      if (sellCapacity > 0) {
        const size = Math.min(this.orderSize, sellCapacity);
        console.log(
          `[mean-rev] ${title}... (${id}): ENTRY SHORT — z=${zScore.toFixed(2)}, mean=${hist.mean.toFixed(1)}¢, mid=${mid.toFixed(1)}¢, σ=${hist.stdDev.toFixed(2)}`,
        );
        actions.push({
          type: "place_order",
          marketId,
          outcome: "yes",
          side: "sell",
          priceCents: Math.max(1, Math.round(mid - 1)),
          size,
        });
        hist.positionSide = "short";
        hist.entryPrice = mid;
        return actions;
      }
    }

    // No signal
    console.log(
      `[mean-rev] ${title}... (${id}): z=${zScore.toFixed(2)}, mean=${hist.mean.toFixed(1)}¢, mid=${mid.toFixed(1)}¢, σ=${hist.stdDev.toFixed(2)} → no signal`,
    );
    return [{ type: "no_action", reason: `z=${zScore.toFixed(2)} within thresholds` }];
  }

  // ─── Helpers ───

  private getOrCreateHistory(marketId: string): PriceHistory {
    let hist = this.history.get(marketId);
    if (!hist) {
      hist = { prices: [], mean: 0, stdDev: 0 };
      this.history.set(marketId, hist);
    }
    return hist;
  }

  private computeMean(prices: number[]): number {
    return prices.reduce((sum, p) => sum + p, 0) / prices.length;
  }

  private computeStdDev(prices: number[], mean: number): number {
    const variance =
      prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
    return Math.sqrt(variance);
  }

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
