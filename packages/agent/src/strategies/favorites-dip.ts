/**
 * Favorites Dip Strategy
 *
 * Directional strategy that buys favorites and home teams who fall behind
 * early in games. The thesis: markets overreact to early deficits — favorites
 * tend to come back, creating a mean-reversion opportunity.
 *
 * Entry: Buy the dip between market price and closing odds during the first
 * half when the favorite (or home underdog) falls behind.
 *
 * Exit: Asymmetric risk management — tight stop loss to cut losers fast,
 * wide trailing stop to let winners run.
 *
 * Requires VegasFairValue provider for game state, closing odds, and point diff.
 */

import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
} from "../strategy.js";
import type { Fill } from "@context-markets/sdk";
import {
  VegasFairValue,
  type VegasFairValueResult,
} from "../providers/vegas-fv.js";
import {
  extractLeagueFromQuestion,
  extractSpreadFromTitle,
  extractTotalsFromTitle,
} from "../signals/espn.js";

// ─── Types ───

export interface FavoritesDipOptions {
  /** Markets to trade. */
  markets: MarketSelector;
  /** Only trade these leagues (e.g., "nba", "ncaab"). Omit for all. */
  league?: string | string[];

  // ─── Entry ───

  /** Min drop from closing odds (cents) to qualify as a dip. Default: 8. */
  dipThresholdCents?: number;
  /** Min closing implied prob to qualify as favorite. Default: 0.50. */
  minFavoriteImplied?: number;
  /** Also buy home underdogs on dips. Default: false. */
  includeHomeUnderdogs?: boolean;
  /**
   * Margin thresholds are sport-aware by default:
   *   NBA/NCAAB: 1-15 pts | NHL: 1-4 goals | Soccer: 1-2 goals
   *   NFL: 1-21 pts | MLB: 1-6 runs
   */
  /** Contracts per entry. Default: 25. */
  entrySize?: number;
  /** Max contracts per market. Default: 50. */
  maxPositionPerMarket?: number;
  /** Max total concurrent positions across all markets. Default: 5. */
  maxConcurrentPositions?: number;
  /** Bid below current FV by this much (cents). Default: 1. */
  entryOffsetCents?: number;

  // ─── Exit (asymmetric: tight SL, wide trail) ───

  /** Hard stop loss below entry price (cents). Default: 6. */
  stopLossCents?: number;
  /** Trailing stop below high-water mark (cents). Default: 4. */
  trailingStopCents?: number;
  /** Tighten trailing stop by 1¢ when profit exceeds this (cents). Default: 12. */
  profitTightenThreshold?: number;

  /** VegasFairValue provider instance. */
  fairValueProvider?: VegasFairValue;
}

interface TrackedPosition {
  marketId: string;
  entryPrice: number;
  closingOdds: number;
  highWaterMark: number;
  size: number;
  isFavorite: boolean;
  isHome: boolean;
}

interface MarketEntryState {
  attempted: boolean;
  closingVegasImplied?: number;
}

// ─── Sport-Aware Margin Thresholds ───

interface SportMarginConfig {
  minBehind: number;
  maxBehind: number;
}

const SOCCER_LEAGUE_SET = new Set([
  "epl", "laliga", "bundesliga", "seriea", "ligue1", "ucl", "uel", "mls", "championship",
]);

const SPORT_MARGINS: Record<string, SportMarginConfig> = {
  // Basketball: 1-15 pts
  nba:    { minBehind: 1, maxBehind: 15 },
  ncaab:  { minBehind: 1, maxBehind: 15 },
  // Hockey: 1-4 goals
  nhl:    { minBehind: 1, maxBehind: 4 },
  // Soccer: 1-2 goals (3+ is a blowout)
  soccer: { minBehind: 1, maxBehind: 2 },
  // Football: 1-21 pts (3+ TDs is a blowout)
  nfl:    { minBehind: 1, maxBehind: 21 },
  // Baseball: 1-6 runs
  mlb:    { minBehind: 1, maxBehind: 6 },
};

function getSportMargins(league: string | null): SportMarginConfig {
  if (!league) return SPORT_MARGINS.nba;
  const key = SOCCER_LEAGUE_SET.has(league.toLowerCase()) ? "soccer" : league.toLowerCase();
  return SPORT_MARGINS[key] ?? SPORT_MARGINS.nba;
}

// ─── Strategy ───

export class FavoritesDipStrategy implements Strategy {
  readonly name = "Favorites Dip";

  private readonly selector: MarketSelector;
  private readonly leagues: Set<string> | null;
  private readonly provider?: VegasFairValue;

  // Entry params
  private readonly dipThresholdCents: number;
  private readonly minFavoriteImplied: number;
  private readonly includeHomeUnderdogs: boolean;
  private readonly entrySize: number;
  private readonly maxPositionPerMarket: number;
  private readonly maxConcurrentPositions: number;
  private readonly entryOffsetCents: number;

  // Exit params
  private readonly stopLossCents: number;
  private readonly trailingStopCents: number;
  private readonly profitTightenThreshold: number;

  // Internal state
  private readonly positions = new Map<string, TrackedPosition>();
  private readonly entryState = new Map<string, MarketEntryState>();

  constructor(options: FavoritesDipOptions) {
    this.selector = options.markets;
    this.provider = options.fairValueProvider;

    // Parse leagues
    if (options.league) {
      const arr = Array.isArray(options.league) ? options.league : [options.league];
      this.leagues = new Set(arr.map((l) => l.toLowerCase()));
    } else {
      this.leagues = null;
    }

    // Entry defaults
    this.dipThresholdCents = options.dipThresholdCents ?? 8;
    this.minFavoriteImplied = options.minFavoriteImplied ?? 0.50;
    this.includeHomeUnderdogs = options.includeHomeUnderdogs ?? false;
    this.entrySize = options.entrySize ?? 25;
    this.maxPositionPerMarket = options.maxPositionPerMarket ?? 50;
    this.maxConcurrentPositions = options.maxConcurrentPositions ?? 5;
    this.entryOffsetCents = options.entryOffsetCents ?? 1;

    // Exit defaults
    this.stopLossCents = options.stopLossCents ?? 6;
    this.trailingStopCents = options.trailingStopCents ?? 4;
    this.profitTightenThreshold = options.profitTightenThreshold ?? 12;
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

  onFill(fill: Fill): void {
    const { order } = fill;
    const marketId = order.marketId;
    const fillSize = fill.fillSize;
    const fillPrice = order.price;

    if (order.side === "buy" && order.outcome === "yes") {
      // Entry fill — create tracked position
      const entry = this.entryState.get(marketId);
      const existing = this.positions.get(marketId);

      if (existing) {
        // Adding to existing position — weighted average entry
        const totalSize = existing.size + fillSize;
        existing.entryPrice = (existing.entryPrice * existing.size + fillPrice * fillSize) / totalSize;
        existing.size = totalSize;
        console.log(
          `[fav-dip] FILL ADD: ${marketId.slice(0, 10)}... +${fillSize} @ ${fillPrice}¢ → avg=${existing.entryPrice.toFixed(1)}¢ total=${existing.size}`,
        );
      } else {
        // New position
        this.positions.set(marketId, {
          marketId,
          entryPrice: fillPrice,
          closingOdds: entry?.closingVegasImplied ?? fillPrice,
          highWaterMark: fillPrice,
          size: fillSize,
          isFavorite: true,
          isHome: true,
        });
        console.log(
          `[fav-dip] FILL ENTRY: ${marketId.slice(0, 10)}... ${fillSize} @ ${fillPrice}¢`,
        );
      }
    }

    if (order.side === "sell" && order.outcome === "yes") {
      // Exit fill — reduce or remove tracked position
      const pos = this.positions.get(marketId);
      if (pos) {
        pos.size -= fillSize;
        const pnl = (fillPrice - pos.entryPrice) * fillSize;
        console.log(
          `[fav-dip] FILL EXIT: ${marketId.slice(0, 10)}... -${fillSize} @ ${fillPrice}¢ P&L=${pnl > 0 ? "+" : ""}${pnl.toFixed(0)}¢`,
        );
        if (pos.size <= 0) {
          this.positions.delete(marketId);
          this.entryState.delete(marketId);
        }
      }
    }
  }

  async onShutdown(): Promise<void> {
    this.positions.clear();
    this.entryState.clear();
  }

  // ─── Per-Market Evaluation ───

  private async evaluateMarket(
    snapshot: MarketSnapshot,
    state: AgentState,
  ): Promise<Action[]> {
    const { market, orderbook } = snapshot;
    const marketId = market.id;
    const title = market.title || (market as any).question || "";
    const shortTitle = title.slice(0, 45);
    const id = marketId.slice(0, 10);

    // ── Filter: skip non-moneyline markets ──
    if (extractSpreadFromTitle(title) !== null) {
      return [{ type: "no_action", reason: "Spread market — skipping" }];
    }
    if (extractTotalsFromTitle(title) !== null) {
      return [{ type: "no_action", reason: "Totals market — skipping" }];
    }

    // ── Filter: league ──
    const league = extractLeagueFromQuestion(title);
    if (this.leagues) {
      if (!league || !this.leagues.has(league.toLowerCase())) {
        return [{ type: "no_action", reason: `League ${league ?? "unknown"} not in filter` }];
      }
    }

    // ── Get game state from VegasFV ──
    if (!this.provider) {
      return [{ type: "no_action", reason: "No VegasFairValue provider" }];
    }

    const fv = await this.provider.estimateWithState(snapshot);

    // ── Existing position → exit logic ──
    const tracked = this.positions.get(marketId);
    if (tracked) {
      return this.evaluateExit(tracked, fv, snapshot, state);
    }

    // ── No position → entry logic ──
    return this.evaluateEntry(fv, snapshot, state, league);
  }

  // ─── Entry Logic ───

  private evaluateEntry(
    fv: VegasFairValueResult,
    snapshot: MarketSnapshot,
    state: AgentState,
    league?: string | null,
  ): Action[] {
    const { market, orderbook } = snapshot;
    const marketId = market.id;
    const title = (market.title || (market as any).question || "").slice(0, 45);
    const id = marketId.slice(0, 10);

    // Gate 1: early game only
    if (fv.gameState !== "early_game") {
      return [{ type: "no_action", reason: `Game state ${fv.gameState} — only enter during early_game` }];
    }

    // Gate 2: team must be favorite OR home underdog (if enabled)
    const vegasImplied = fv.vegasImplied;
    if (vegasImplied === undefined) {
      return [{ type: "no_action", reason: "No Vegas implied prob available" }];
    }

    const isFavorite = vegasImplied >= this.minFavoriteImplied;
    const isHome = fv.subjectIsHome === true;
    const isHomeUnderdog = isHome && !isFavorite;

    if (!isFavorite && !(this.includeHomeUnderdogs && isHomeUnderdog)) {
      return [{
        type: "no_action",
        reason: `Not favorite (${(vegasImplied * 100).toFixed(0)}%) and not home underdog`,
      }];
    }

    // Gate 3: team must be behind
    const pointDiff = fv.pointDiff ?? 0;
    if (pointDiff >= 0) {
      return [{ type: "no_action", reason: `Team not behind (diff=${pointDiff})` }];
    }

    // Gate 4: deficit in range (sport-aware thresholds)
    const deficit = Math.abs(pointDiff);
    const margins = getSportMargins(league ?? null);
    if (deficit < margins.minBehind) {
      return [{ type: "no_action", reason: `Deficit ${deficit} < min ${margins.minBehind} (${league ?? "?"})` }];
    }
    if (deficit > margins.maxBehind) {
      return [{ type: "no_action", reason: `Deficit ${deficit} > max ${margins.maxBehind} (${league ?? "?"} blowout)` }];
    }

    // Gate 5: market price dipped enough from closing odds
    const closingOddsCents = Math.round(vegasImplied * 100);
    const bestBid = orderbook.bids[0]?.price ?? 0;
    const bestAsk = orderbook.asks[0]?.price ?? 100;
    const currentMid = (bestBid + bestAsk) / 2;
    const dipSize = closingOddsCents - currentMid;

    if (dipSize < this.dipThresholdCents) {
      return [{
        type: "no_action",
        reason: `Dip ${dipSize.toFixed(1)}¢ < threshold ${this.dipThresholdCents}¢ (closing=${closingOddsCents}¢ mid=${currentMid.toFixed(1)}¢)`,
      }];
    }

    // Gate 6: position limits
    if (this.positions.size >= this.maxConcurrentPositions) {
      return [{ type: "no_action", reason: `At max concurrent positions (${this.positions.size}/${this.maxConcurrentPositions})` }];
    }

    const netPos = this.getNetPosition(state, marketId);
    const buyCapacity = this.maxPositionPerMarket - netPos;
    if (buyCapacity <= 0) {
      return [{ type: "no_action", reason: `Position capped (net=${netPos}/${this.maxPositionPerMarket})` }];
    }

    // Gate 7: haven't already attempted entry for this market
    const entry = this.entryState.get(marketId);
    if (entry?.attempted) {
      return [{ type: "no_action", reason: "Already attempted entry for this market" }];
    }

    // ── Place BUY YES order ──
    const entryPrice = Math.max(1, Math.min(99, Math.round(fv.yesCents - this.entryOffsetCents)));
    const size = Math.min(this.entrySize, buyCapacity);

    console.log(
      `[fav-dip] ENTRY: ${title}... (${id}) — ` +
      `${isFavorite ? "FAV" : "HOME"} behind ${deficit}pts, ` +
      `closing=${closingOddsCents}¢ mid=${currentMid.toFixed(0)}¢ dip=${dipSize.toFixed(0)}¢ → ` +
      `BUY YES ${size} @ ${entryPrice}¢`,
    );

    // Record entry state
    this.entryState.set(marketId, {
      attempted: true,
      closingVegasImplied: closingOddsCents,
    });

    return [{
      type: "place_order",
      marketId,
      outcome: "yes",
      side: "buy",
      priceCents: entryPrice,
      size,
    }];
  }

  // ─── Exit Logic ───

  private evaluateExit(
    tracked: TrackedPosition,
    fv: VegasFairValueResult,
    snapshot: MarketSnapshot,
    state: AgentState,
  ): Action[] {
    const { market, orderbook } = snapshot;
    const marketId = market.id;
    const title = (market.title || (market as any).question || "").slice(0, 45);
    const id = marketId.slice(0, 10);

    const bestBid = orderbook.bids[0]?.price ?? 0;
    const bestAsk = orderbook.asks[0]?.price ?? 100;
    const currentMid = (bestBid + bestAsk) / 2;

    // Cancel stale orders first
    const actions: Action[] = [];
    const staleOrders = state.openOrders.filter((o) => o.marketId === marketId);
    for (const order of staleOrders) {
      actions.push({ type: "cancel_order", nonce: order.nonce });
    }

    const profit = currentMid - tracked.entryPrice;

    // Priority 1: Game final → sell at best bid
    if (fv.gameState === "final") {
      console.log(
        `[fav-dip] EXIT FINAL: ${title}... (${id}) — P&L=${profit > 0 ? "+" : ""}${profit.toFixed(0)}¢ × ${tracked.size}`,
      );
      actions.push({
        type: "place_order",
        marketId,
        outcome: "yes",
        side: "sell",
        priceCents: Math.max(1, bestBid),
        size: tracked.size,
      });
      return actions;
    }

    // Priority 2: Late game → force exit
    if (fv.gameState === "late_close" || fv.gameState === "late_blowout") {
      console.log(
        `[fav-dip] EXIT LATE (${fv.gameState}): ${title}... (${id}) — P&L=${profit > 0 ? "+" : ""}${profit.toFixed(0)}¢ × ${tracked.size}`,
      );
      actions.push({
        type: "place_order",
        marketId,
        outcome: "yes",
        side: "sell",
        priceCents: Math.max(1, bestBid),
        size: tracked.size,
      });
      return actions;
    }

    // Priority 3: Stop loss
    if (currentMid <= tracked.entryPrice - this.stopLossCents) {
      console.log(
        `[fav-dip] STOP LOSS: ${title}... (${id}) — entry=${tracked.entryPrice.toFixed(0)}¢ mid=${currentMid.toFixed(0)}¢ loss=${profit.toFixed(0)}¢ × ${tracked.size}`,
      );
      actions.push({
        type: "place_order",
        marketId,
        outcome: "yes",
        side: "sell",
        priceCents: Math.max(1, bestBid),
        size: tracked.size,
      });
      return actions;
    }

    // Priority 4: Trailing stop (only for winners above entry)
    if (currentMid > tracked.entryPrice) {
      // Update high-water mark
      if (currentMid > tracked.highWaterMark) {
        tracked.highWaterMark = currentMid;
      }

      // Tighten trail when profit is large
      let trail = this.trailingStopCents;
      if (profit >= this.profitTightenThreshold) {
        trail = Math.max(1, trail - 1);
      }

      const trailStop = tracked.highWaterMark - trail;
      if (currentMid <= trailStop) {
        console.log(
          `[fav-dip] TRAIL STOP: ${title}... (${id}) — entry=${tracked.entryPrice.toFixed(0)}¢ hwm=${tracked.highWaterMark.toFixed(0)}¢ mid=${currentMid.toFixed(0)}¢ P&L=+${profit.toFixed(0)}¢ × ${tracked.size}`,
        );
        actions.push({
          type: "place_order",
          marketId,
          outcome: "yes",
          side: "sell",
          priceCents: Math.max(1, bestBid),
          size: tracked.size,
        });
        return actions;
      }
    }

    // Priority 5: Hold — update HWM
    if (currentMid > tracked.highWaterMark) {
      tracked.highWaterMark = currentMid;
    }

    console.log(
      `[fav-dip] HOLD: ${title}... (${id}) — entry=${tracked.entryPrice.toFixed(0)}¢ mid=${currentMid.toFixed(0)}¢ hwm=${tracked.highWaterMark.toFixed(0)}¢ P&L=${profit > 0 ? "+" : ""}${profit.toFixed(0)}¢`,
    );

    if (actions.length === 0) {
      return [{ type: "no_action", reason: "Holding position" }];
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
