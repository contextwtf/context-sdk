/**
 * Sports Market Maker Strategy
 *
 * Provides liquidity across sports markets using data-driven fair values from
 * Vegas odds + ESPN stats. No LLM — purely algorithmic.
 *
 * Adjusts spread profile based on game state:
 * - Pre-game: Tight spreads, concentrated liquidity (stable FV)
 * - In-game early (Q1-Q2): Medium spreads, standard ladder
 * - In-game late, blowout: Tight spreads (near-certain outcome)
 * - In-game late, close: WIDE spreads, deep ladder (max volatility)
 * - Final: Pull all quotes (let resolution sniper handle it)
 *
 * SDK improvements surfaced:
 * - AdaptiveMM can't change spread dynamically — baseSpreadCents is set once.
 *   We work around this by building ladders directly.
 * - FairValueEstimate needs metadata — VegasFairValue wants to return game state.
 *   We work around with extended interface (VegasFairValueResult).
 * - No getNetPosition() utility — duplicated across strategies.
 * - Signal caching is per-provider — shared cache would reduce API calls.
 */

import type { Fill } from "@context-markets/sdk";
import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
} from "../strategy.js";
import {
  VegasFairValue,
  type VegasFairValueResult,
  type GameState,
} from "../providers/vegas-fv.js";
import { extractLeagueFromQuestion } from "../signals/espn.js";

// ─── Types ───

interface SpreadProfile {
  spreadCents: number;
  levels: number;
  levelSize: number;
  levelSpacingCents: number;
  skewPerContract: number;
}

export interface SportsMmOptions {
  /** Markets to provide liquidity for. */
  markets: MarketSelector;
  /** League(s) to filter for. Default: auto-detect from title. */
  league?: string | string[];
  /** Override default spread profiles per game state. */
  profiles?: Partial<Record<GameState, SpreadProfile>>;
  /** Close game threshold in points. Default: 8. */
  closeGameMarginPts?: number;
  /** Blowout threshold in points. Default: 15. */
  blowoutMarginPts?: number;
  /** Max skew in cents. Default: 8. */
  maxSkewCents?: number;
  /** Min mid-move before re-quoting. Default: 1. */
  requoteDeltaCents?: number;
  /** The Odds API key. Falls back to ODDS_API_KEY env var. */
  oddsApiKey?: string;
  /** External fair value provider. If omitted, creates VegasFairValue internally. */
  fairValueProvider?: VegasFairValue;
}

interface QuoteState {
  fairValue: number;
  skew: number;
  gameState: GameState;
}

// ─── Default Spread Profiles ───

const DEFAULT_PROFILES: Record<GameState, SpreadProfile> = {
  pre_game: {
    spreadCents: 2,
    levels: 3,
    levelSize: 25,
    levelSpacingCents: 2,
    skewPerContract: 0.05,
  },
  early_game: {
    spreadCents: 4,
    levels: 5,
    levelSize: 15,
    levelSpacingCents: 2,
    skewPerContract: 0.1,
  },
  late_blowout: {
    spreadCents: 2,
    levels: 3,
    levelSize: 25,
    levelSpacingCents: 2,
    skewPerContract: 0.05,
  },
  late_close: {
    spreadCents: 6,
    levels: 8,
    levelSize: 10,
    levelSpacingCents: 2,
    skewPerContract: 0.2,
  },
  final: {
    spreadCents: 0,
    levels: 0,
    levelSize: 0,
    levelSpacingCents: 0,
    skewPerContract: 0,
  },
  unknown: {
    spreadCents: 4,
    levels: 4,
    levelSize: 15,
    levelSpacingCents: 2,
    skewPerContract: 0.1,
  },
};

// ─── Strategy ───

export class SportsMmStrategy implements Strategy {
  readonly name = "Sports MM";

  private readonly selector: MarketSelector;
  private readonly provider: VegasFairValue;
  private readonly profiles: Record<GameState, SpreadProfile>;
  private readonly maxSkewCents: number;
  private readonly requoteDeltaCents: number;
  private readonly allowedLeagues?: Set<string>;

  private lastQuotes = new Map<string, QuoteState>();

  constructor(options: SportsMmOptions) {
    this.selector = options.markets;
    this.maxSkewCents = options.maxSkewCents ?? 8;
    this.requoteDeltaCents = options.requoteDeltaCents ?? 1;

    // Normalize league(s)
    if (options.league) {
      const leagues = Array.isArray(options.league) ? options.league : [options.league];
      this.allowedLeagues = new Set(leagues.map((l) => l.toLowerCase()));
    }

    this.provider = options.fairValueProvider ?? new VegasFairValue({
      oddsApiKey: options.oddsApiKey,
      closeGameMarginPts: options.closeGameMarginPts,
      blowoutMarginPts: options.blowoutMarginPts,
    });

    // Merge user overrides with defaults
    this.profiles = { ...DEFAULT_PROFILES };
    if (options.profiles) {
      for (const [state, profile] of Object.entries(options.profiles)) {
        this.profiles[state as GameState] = {
          ...DEFAULT_PROFILES[state as GameState],
          ...profile,
        };
      }
    }
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
    if (fill.order.marketId) {
      this.lastQuotes.delete(fill.order.marketId);
    }
  }

  async onShutdown(): Promise<void> {
    this.lastQuotes.clear();
  }

  // ─── Per-Market Evaluation ───

  private async evaluateMarket(
    snapshot: MarketSnapshot,
    state: AgentState,
  ): Promise<Action[]> {
    const { market } = snapshot;
    const title = market.title || (market as any).question || "";

    // Skip non-sports markets or leagues we don't handle
    const league = extractLeagueFromQuestion(title);
    if (!league) {
      return [{ type: "no_action", reason: `Not a sports market: ${title.slice(0, 40)}` }];
    }
    if (this.allowedLeagues && !this.allowedLeagues.has(league.toLowerCase())) {
      return [{ type: "no_action", reason: `League ${league} not in allowed list` }];
    }

    // Get FV with game state metadata.
    // Priority: snapshot.fairValue (from service) > provider
    // Always need gameState from provider (or metadata) for spread profile selection.
    const fvResult = await this.provider.estimateWithState(snapshot);
    const gameState: GameState =
      (snapshot.fairValue?.metadata?.gameState as GameState) ?? fvResult.gameState;

    // Final game — buy dollars for 99 cents until market resolves
    if (gameState === "final") {
      const yesFV = Math.round(snapshot.fairValue?.yesCents ?? fvResult.yesCents);
      return this.finalGameQuotes(market.id, yesFV, fvResult.confidence ?? 1, state);
    }

    // Prefer service-computed FV if available, fall back to provider
    const yesFV = clamp(
      Math.round(snapshot.fairValue?.yesCents ?? fvResult.yesCents),
      1,
      99,
    );

    // Calculate inventory skew
    const netYes = this.getNetPosition(state, market.id);
    const profile = this.profiles[gameState];
    const skew = clamp(
      netYes * profile.skewPerContract,
      -this.maxSkewCents,
      this.maxSkewCents,
    );

    // Check if we need to requote
    const existing = this.lastQuotes.get(market.id);
    if (existing) {
      const fvDelta = Math.abs(existing.fairValue - yesFV);
      const skewDelta = Math.abs(existing.skew - skew);
      const stateChanged = existing.gameState !== gameState;

      const myOrders = state.openOrders.filter((o) => o.marketId === market.id);
      const expectedOrders = profile.levels * 4; // levels * (bid+ask) * (YES+NO)
      const bookThin = myOrders.length < expectedOrders * 0.5;

      if (
        fvDelta < this.requoteDeltaCents &&
        skewDelta < this.requoteDeltaCents &&
        !stateChanged &&
        !bookThin
      ) {
        return [{ type: "no_action", reason: `Quotes fresh for ${market.id.slice(0, 8)}` }];
      }
    }

    // Build ladders
    const yesLadder = this.generateLadder(yesFV, skew, profile);
    const noFV = 100 - yesFV;
    const noLadder = this.generateLadder(noFV, -skew, profile);

    console.log(
      `[sports-mm] ${market.id.slice(0, 8)}... [${gameState}] yesFV=${yesFV}¢ net=${netYes} skew=${skew.toFixed(1)}¢ ` +
      `spread=${profile.spreadCents}¢ levels=${profile.levels}`,
    );

    // Cancel existing orders
    const actions: Action[] = [];
    const marketOrders = state.openOrders.filter((o) => o.marketId === market.id);
    for (const order of marketOrders) {
      actions.push({ type: "cancel_order", nonce: order.nonce });
    }

    // Place YES ladder
    actions.push(...this.buildLadder(market.id, "yes", yesLadder, profile.levelSize));
    // Place NO ladder
    actions.push(...this.buildLadder(market.id, "no", noLadder, profile.levelSize));

    // Track state
    this.lastQuotes.set(market.id, { fairValue: yesFV, skew, gameState });

    return actions;
  }

  // ─── Final Game — Resolution Bidding ───

  /**
   * Post-game: outcome is known, market hasn't resolved yet.
   * Buy the winning side at 99¢/98¢/97¢ — buying dollars for ~99 cents.
   * Near-zero risk since we know who won.
   */
  private finalGameQuotes(
    marketId: string,
    yesFV: number,
    confidence: number,
    state: AgentState,
  ): Action[] {
    const actions: Action[] = [];

    // Cancel any existing in-game quotes first
    const marketOrders = state.openOrders.filter((o) => o.marketId === marketId);
    for (const order of marketOrders) {
      actions.push({ type: "cancel_order", nonce: order.nonce });
    }

    // If outcome is uncertain (draw going to OT, etc.), just pull quotes
    if (confidence < 0.9 || (yesFV > 5 && yesFV < 95)) {
      if (marketOrders.length > 0) {
        console.log(`[sports-mm] FINAL (uncertain) — pulling quotes for ${marketId.slice(0, 8)}...`);
      }
      return actions.length > 0 ? actions : [{ type: "no_action", reason: "Game final, uncertain outcome" }];
    }

    // Outcome is known — bid aggressively for the winning side
    const winningOutcome: "yes" | "no" = yesFV >= 95 ? "yes" : "no";
    const bidPrices = [99, 98, 97];
    const bidSize = 100; // large size since risk is near-zero

    for (const price of bidPrices) {
      actions.push({
        type: "place_order",
        marketId,
        outcome: winningOutcome,
        side: "buy",
        priceCents: price,
        size: bidSize,
      });
    }

    console.log(
      `[sports-mm] FINAL — buying ${winningOutcome.toUpperCase()} at 97-99¢ for ${marketId.slice(0, 8)}...`,
    );

    this.lastQuotes.set(marketId, { fairValue: yesFV, skew: 0, gameState: "final" });
    return actions;
  }

  // ─── Ladder Generation ───

  private generateLadder(
    fairValue: number,
    skew: number,
    profile: SpreadProfile,
  ): { bidPrices: number[]; askPrices: number[] } {
    const bidPrices: number[] = [];
    const askPrices: number[] = [];

    for (let i = 0; i < profile.levels; i++) {
      const bidPrice = clamp(
        Math.round(
          fairValue - profile.spreadCents - i * profile.levelSpacingCents - skew,
        ),
        1,
        99,
      );
      const askPrice = clamp(
        Math.round(
          fairValue + profile.spreadCents + i * profile.levelSpacingCents - skew,
        ),
        1,
        99,
      );
      bidPrices.push(bidPrice);
      askPrices.push(askPrice);
    }

    return { bidPrices, askPrices };
  }

  private buildLadder(
    marketId: string,
    outcome: "yes" | "no",
    ladder: { bidPrices: number[]; askPrices: number[] },
    levelSize: number,
  ): Action[] {
    const actions: Action[] = [];

    for (const price of ladder.bidPrices) {
      actions.push({
        type: "place_order",
        marketId,
        outcome,
        side: "buy",
        priceCents: price,
        size: levelSize,
      });
    }

    for (const price of ladder.askPrices) {
      actions.push({
        type: "place_order",
        marketId,
        outcome,
        side: "sell",
        priceCents: price,
        size: levelSize,
      });
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
