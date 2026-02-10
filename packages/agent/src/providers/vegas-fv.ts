/**
 * Vegas Fair Value Provider
 *
 * Data-driven fair value for sports markets using Vegas odds + ESPN live scores.
 * No LLM — purely algorithmic. Adapts FV and confidence based on game state:
 *
 * - Pre-game: Vegas implied probability (high confidence, tight spreads)
 * - In-game early (Q1-Q2): Blend Vegas + score-derived (medium confidence)
 * - In-game late, blowout (Q3+, ≥15pt lead): Score-derived (high confidence)
 * - In-game late, close (Q3+, <8pt lead): Score-derived (LOW confidence → wide spreads)
 * - Final: Deterministic 1/99 (pull quotes, let resolution sniper handle it)
 *
 * Caching:
 * - Vegas odds: Fetched pre-game, frozen at game start (no more API calls during game)
 * - ESPN scores: 5min pre-game, 30s in-game, indefinite for final
 *
 * SDK improvements surfaced:
 * - AdaptiveMM can't change spread dynamically — baseSpreadCents is set once.
 * - FairValueEstimate needs metadata — game state alongside FV.
 * - No getNetPosition() utility — duplicated across strategies.
 * - Signal caching is per-provider — a shared signal cache would reduce API calls.
 */

import type { FairValueProvider, FairValueEstimate } from "../fair-value.js";
import type { MarketSnapshot } from "../strategy.js";
import {
  extractLeagueFromQuestion,
  extractTeamsFromTitle,
  extractSpreadFromTitle,
  extractTotalsFromTitle,
  getUpcomingGames,
  type UpcomingGame,
  type TotalsInfo,
} from "../signals/espn.js";
import { fetchGameOdds, fetchSpreadOdds, fetchTotalsOdds, type GameOdds, type SpreadOdds, type TotalsOdds } from "../signals/vegas.js";

// ─── Types ───

export type GameState = "pre_game" | "early_game" | "late_blowout" | "late_close" | "final" | "unknown";

export interface VegasFairValueResult extends FairValueEstimate {
  gameState: GameState;
  margin?: number;
  period?: number;
  vegasImplied?: number;
  /** Signed point differential from subject team's perspective. Negative = behind. */
  pointDiff?: number;
  /** True if the subject team (first team in title) is the home team. */
  subjectIsHome?: boolean;
  /** Non-null if this is a spread market. */
  spread?: number;
  /** Non-null if this is a totals market. */
  totals?: { line: number; side: "over" | "under" };
}

interface VegasCache {
  odds: GameOdds;
  frozen: boolean;
  timestamp: number;
}

interface ScoreCache {
  game: UpcomingGame;
  timestamp: number;
}

// ─── Sport-Specific Period Config ───

interface SportPeriodConfig {
  totalPeriods: number;
  periodSeconds: number;
  /** Logistic steepness scale factor — lower-scoring sports need higher k. */
  kScale: number;
}

const SPORT_PERIODS: Record<string, SportPeriodConfig> = {
  nba:   { totalPeriods: 4, periodSeconds: 12 * 60, kScale: 0.15 },
  ncaab: { totalPeriods: 2, periodSeconds: 20 * 60, kScale: 0.15 },
  nhl:   { totalPeriods: 3, periodSeconds: 20 * 60, kScale: 0.40 }, // Goals scarcer → leads matter more
  nfl:   { totalPeriods: 4, periodSeconds: 15 * 60, kScale: 0.12 },
  mlb:   { totalPeriods: 9, periodSeconds: 0,       kScale: 0.20 }, // Innings, not clock-based
  // Soccer — 2 halves of 45 min. Goals very scarce → high kScale (1-goal lead is huge)
  soccer: { totalPeriods: 2, periodSeconds: 45 * 60, kScale: 0.60 },
};

// ─── Win Probability Model ───

const SOCCER_LEAGUES = new Set(["epl", "laliga", "bundesliga", "seriea", "ligue1", "ucl", "uel", "mls", "championship"]);

function winProbFromScore(
  pointDiff: number,
  period: number,
  clockSeconds: number,
  league?: string,
): number {
  const leagueKey = (league ?? "nba").toLowerCase();
  const periodKey = SOCCER_LEAGUES.has(leagueKey) ? "soccer" : leagueKey;
  const config = SPORT_PERIODS[periodKey] ?? SPORT_PERIODS.nba;

  const remainingPeriods = Math.max(0, config.totalPeriods - period);
  const totalSecondsLeft = remainingPeriods * config.periodSeconds + clockSeconds;
  const totalGameSeconds = config.totalPeriods * config.periodSeconds;
  const fractionRemaining = totalGameSeconds > 0
    ? totalSecondsLeft / totalGameSeconds
    : Math.max(0, (config.totalPeriods - period) / config.totalPeriods); // Inning-based fallback

  // Logistic model: larger leads matter more as time runs out
  const k = config.kScale / Math.max(0.01, fractionRemaining);
  const rawWinProb = 1 / (1 + Math.exp(-k * pointDiff));

  // Soccer "defeat" markets: draw = NO, so we need P(win), not P(win or draw).
  // When tied (pointDiff=0), rawWinProb = 0.5 but actual P(win) < 0.5 because
  // P(draw) > 0. Estimate draw probability based on time remaining and margin.
  const isSoccer = SOCCER_LEAGUES.has((league ?? "").toLowerCase());
  if (isSoccer) {
    // Draw probability: ~25% at kickoff, increases when tied late, decreases with larger leads
    const baseDrawProb = 0.25;
    const drawProb = Math.abs(pointDiff) >= 2
      ? 0.05 // Very unlikely to end draw with 2+ goal lead
      : baseDrawProb * (1 - fractionRemaining * 0.3); // Increases slightly as time runs out when close
    // Redistribute: P(win) = rawWinProb * (1 - drawProb)
    return rawWinProb * (1 - drawProb);
  }

  return rawWinProb;
}

/**
 * Estimate probability of going over the totals line based on current scoring pace.
 * Projects final total using current pace and applies a logistic model with
 * uncertainty that decreases as the game progresses.
 */
function totalsProbFromScore(
  currentTotal: number,
  line: number,
  period: number,
  clockSeconds: number,
  league?: string,
): number {
  const leagueKey = (league ?? "nba").toLowerCase();
  const periodKey = SOCCER_LEAGUES.has(leagueKey) ? "soccer" : leagueKey;
  const config = SPORT_PERIODS[periodKey] ?? SPORT_PERIODS.nba;

  const remainingPeriods = Math.max(0, config.totalPeriods - period);
  const totalSecondsLeft = remainingPeriods * config.periodSeconds + clockSeconds;
  const totalGameSeconds = config.totalPeriods * config.periodSeconds;
  const fractionElapsed = totalGameSeconds > 0
    ? Math.max(0.05, (totalGameSeconds - totalSecondsLeft) / totalGameSeconds)
    : 0.5;
  const fractionRemaining = 1 - fractionElapsed;

  // Project final total based on current scoring pace
  const projectedTotal = currentTotal / fractionElapsed;
  const delta = projectedTotal - line; // positive = pace above line (favors over)

  // Normalize: sqrt(line) scales naturally across sports
  //   NBA: sqrt(224) ≈ 15 → 15pt delta ≈ 1 unit
  //   Soccer: sqrt(2.5) ≈ 1.6 → 1.6 goal delta ≈ 1 unit
  const scale = Math.max(0.5, Math.sqrt(line));
  const normalizedDelta = delta / scale;

  // Certainty increases as game progresses (pace estimate more reliable)
  const k = 0.6 / Math.max(0.05, fractionRemaining);

  return Math.max(0.01, Math.min(0.99, 1 / (1 + Math.exp(-k * normalizedDelta * 0.3))));
}

function parseClockSeconds(clock: string | undefined): number {
  if (!clock) return 0;
  const parts = clock.split(":");
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  return parseInt(parts[0]) || 0;
}

// ─── Provider ───

export class VegasFairValue implements FairValueProvider {
  readonly name = "Vegas Fair Value";

  private readonly oddsApiKey?: string;
  private readonly defaultLeague?: string;
  private readonly closeGameMarginPts: number;
  private readonly blowoutMarginPts: number;

  // Per-game caches
  private readonly vegasCache = new Map<string, VegasCache>();
  private readonly scoreCache = new Map<string, ScoreCache>();
  private readonly spreadCache = new Map<string, { odds: SpreadOdds; timestamp: number }>();
  private readonly totalsCache = new Map<string, { odds: TotalsOdds; timestamp: number }>();

  constructor(options: {
    oddsApiKey?: string;
    league?: string;
    closeGameMarginPts?: number;
    blowoutMarginPts?: number;
  } = {}) {
    this.oddsApiKey = options.oddsApiKey;
    this.defaultLeague = options.league;
    this.closeGameMarginPts = options.closeGameMarginPts ?? 8;
    this.blowoutMarginPts = options.blowoutMarginPts ?? 15;
  }

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    const result = await this.estimateWithState(snapshot);
    return { yesCents: result.yesCents, confidence: result.confidence };
  }

  /** Extended estimate that includes game state metadata. */
  async estimateWithState(snapshot: MarketSnapshot): Promise<VegasFairValueResult> {
    const { market } = snapshot;
    const title = market.title || (market as any).question || "";

    const league = this.defaultLeague || extractLeagueFromQuestion(title);
    if (!league) {
      return { yesCents: 50, confidence: 0.3, gameState: "unknown" };
    }

    const teamNames = extractTeamsFromTitle(title, league);
    if (teamNames.length === 0) {
      return { yesCents: 50, confidence: 0.3, gameState: "unknown" };
    }

    // Check if this is a totals market (before spread, since "cover" excludes totals anyway)
    const totals = extractTotalsFromTitle(title);

    // Check if this is a spread market
    const spread = extractSpreadFromTitle(title);

    const subjectTeam = teamNames[0].toLowerCase();
    const opponentTeam = teamNames.length >= 2 ? teamNames[1].toLowerCase() : undefined;

    // Fetch live game data (with caching)
    let game = await this.getGameData(league, subjectTeam, teamNames);

    // If matched game is final but opponent doesn't match market title,
    // this is a stale result (e.g. yesterday's game still on scoreboard).
    // Treat as no game found → pre-game fallback.
    if (game && game.status === "final" && opponentTeam) {
      const home = game.homeTeam.toLowerCase();
      const away = game.awayTeam.toLowerCase();
      const opponentInGame = home.includes(opponentTeam) || away.includes(opponentTeam);
      if (!opponentInGame) {
        game = null;
      }
    }

    // Determine subject team's relationship
    const subjectIsHome = game
      ? game.homeTeam.toLowerCase().includes(subjectTeam)
      : true;

    // ─── Totals Market Path ───
    if (totals !== null) {
      return this.estimateTotals(league, teamNames[0], subjectTeam, totals, game, title);
    }

    // ─── Spread Market Path ───
    if (spread !== null) {
      return this.estimateSpread(league, teamNames[0], subjectTeam, subjectIsHome, spread, game, title);
    }

    // ─── Moneyline Market Path ───

    // Fetch Vegas odds (with caching + freeze at game start)
    const vegasOdds = await this.getVegasOdds(league, teamNames[0], subjectTeam, game);

    const vegasImplied = vegasOdds
      ? (subjectIsHome ? vegasOdds.odds.consensus.homeImplied : vegasOdds.odds.consensus.awayImplied)
      : undefined;

    // Route by game state
    if (!game || game.status === "scheduled") {
      return this.preGame(vegasImplied, title, subjectIsHome);
    }

    if (game.status === "final") {
      return this.finalGame(game, subjectIsHome, league);
    }

    if (game.status === "in_progress") {
      return this.inGame(game, subjectIsHome, vegasImplied, title, league);
    }

    return { yesCents: 50, confidence: 0.3, gameState: "unknown" };
  }

  // ─── Game State Handlers ───

  private preGame(vegasImplied: number | undefined, title: string, subjectIsHome?: boolean): VegasFairValueResult {
    if (vegasImplied !== undefined) {
      const yesCents = Math.max(1, Math.min(99, Math.round(vegasImplied * 100)));
      console.log(
        `[vegas-fv] PRE-GAME: ${title.slice(0, 50)}... → Vegas=${(vegasImplied * 100).toFixed(1)}% → FV=${yesCents}¢`,
      );
      return { yesCents, confidence: 0.8, gameState: "pre_game", vegasImplied, pointDiff: 0, subjectIsHome };
    }

    console.log(`[vegas-fv] PRE-GAME (no Vegas): ${title.slice(0, 50)}... → FV=50¢`);
    return { yesCents: 50, confidence: 0.3, gameState: "pre_game", pointDiff: 0, subjectIsHome };
  }

  private finalGame(game: UpcomingGame, subjectIsHome: boolean, league?: string): VegasFairValueResult {
    const homeScore = game.homeScore ?? 0;
    const awayScore = game.awayScore ?? 0;
    const subjectScore = subjectIsHome ? homeScore : awayScore;
    const opponentScore = subjectIsHome ? awayScore : homeScore;
    const pointDiff = subjectScore - opponentScore;

    if (homeScore === awayScore) {
      // In soccer, a draw at full time = "defeat" market resolves NO
      const isSoccer = SOCCER_LEAGUES.has((league ?? "").toLowerCase());
      if (isSoccer) {
        console.log(`[vegas-fv] FINAL DRAW: ${game.homeTeam} ${homeScore}-${awayScore} ${game.awayTeam} → NO (draw)`);
        return { yesCents: 1, confidence: 1.0, gameState: "final", pointDiff, subjectIsHome };
      }
      // Non-soccer ties (rare — usually goes to OT)
      return { yesCents: 50, confidence: 0.5, gameState: "final", pointDiff, subjectIsHome };
    }

    const subjectWon = subjectIsHome
      ? homeScore > awayScore
      : awayScore > homeScore;

    console.log(
      `[vegas-fv] FINAL: ${game.homeTeam} ${homeScore}-${awayScore} ${game.awayTeam} → ${subjectWon ? "YES" : "NO"}`,
    );

    return {
      yesCents: subjectWon ? 99 : 1,
      confidence: 1.0,
      gameState: "final",
      pointDiff,
      subjectIsHome,
    };
  }

  private inGame(
    game: UpcomingGame,
    subjectIsHome: boolean,
    vegasImplied: number | undefined,
    title: string,
    league?: string,
  ): VegasFairValueResult {
    const homeScore = game.homeScore ?? 0;
    const awayScore = game.awayScore ?? 0;
    const period = game.period ?? 1;
    const clockSeconds = parseClockSeconds(game.displayClock);

    const subjectScore = subjectIsHome ? homeScore : awayScore;
    const opponentScore = subjectIsHome ? awayScore : homeScore;
    const pointDiff = subjectScore - opponentScore;
    const margin = Math.abs(pointDiff);

    // Score-derived win probability (sport-aware)
    const scoreFV = winProbFromScore(pointDiff, period, clockSeconds, league);

    // Classify game state (sport-aware period thresholds)
    const leagueKey = (league ?? "nba").toLowerCase();
    const periodKey = SOCCER_LEAGUES.has(leagueKey) ? "soccer" : leagueKey;
    const sportConfig = SPORT_PERIODS[periodKey] ?? SPORT_PERIODS.nba;
    const earlyPeriodThreshold = Math.ceil(sportConfig.totalPeriods / 2); // NBA: <=2, NHL: <=1, Soccer: <=1

    // Sport-aware margin thresholds (soccer goals vs basketball points)
    const isSoccer = SOCCER_LEAGUES.has(leagueKey);
    const closeMargin = isSoccer ? 1 : this.closeGameMarginPts;
    const blowoutMargin = isSoccer ? 3 : this.blowoutMarginPts;

    let gameState: GameState;
    let confidence: number;
    let yesFraction: number;

    if (period <= earlyPeriodThreshold) {
      // Early game — blend Vegas + score
      gameState = "early_game";
      const vegasWeight = 0.6;
      const vegasFV = vegasImplied ?? 0.5;
      yesFraction = vegasWeight * vegasFV + (1 - vegasWeight) * scoreFV;
      confidence = 0.6;
    } else if (margin >= blowoutMargin) {
      // Late game blowout — score dominates
      gameState = "late_blowout";
      const vegasWeight = 0.15;
      const vegasFV = vegasImplied ?? 0.5;
      yesFraction = vegasWeight * vegasFV + (1 - vegasWeight) * scoreFV;
      confidence = 0.9;
    } else if (margin < closeMargin) {
      // Late game close — max volatility
      gameState = "late_close";
      const vegasWeight = 0.15;
      const vegasFV = vegasImplied ?? 0.5;
      yesFraction = vegasWeight * vegasFV + (1 - vegasWeight) * scoreFV;
      confidence = 0.4; // Low confidence → wide spreads
    } else {
      // Late game, medium margin (8-15 pts)
      gameState = period >= 3 ? "late_blowout" : "early_game";
      const vegasWeight = 0.25;
      const vegasFV = vegasImplied ?? 0.5;
      yesFraction = vegasWeight * vegasFV + (1 - vegasWeight) * scoreFV;
      confidence = 0.7;
    }

    const yesCents = Math.max(1, Math.min(99, Math.round(yesFraction * 100)));

    console.log(
      `[vegas-fv] IN-GAME ${gameState}: ${title.slice(0, 40)}... Q${period} ${game.displayClock || ""} ` +
      `${subjectIsHome ? game.homeTeam : game.awayTeam} ${pointDiff > 0 ? "+" : ""}${pointDiff} → ` +
      `scoreFV=${(scoreFV * 100).toFixed(0)}% ${vegasImplied ? `vegas=${(vegasImplied * 100).toFixed(0)}%` : ""} → FV=${yesCents}¢`,
    );

    return {
      yesCents,
      confidence,
      gameState,
      margin,
      period,
      vegasImplied,
      pointDiff,
      subjectIsHome,
    };
  }

  // ─── Spread Market Handler ───

  private async estimateSpread(
    league: string,
    teamName: string,
    subjectTeamLower: string,
    subjectIsHome: boolean,
    spread: number,
    game: UpcomingGame | null,
    title: string,
  ): Promise<VegasFairValueResult> {
    // Final — deterministic: did the team cover?
    if (game?.status === "final") {
      const homeScore = game.homeScore ?? 0;
      const awayScore = game.awayScore ?? 0;
      const subjectScore = subjectIsHome ? homeScore : awayScore;
      const opponentScore = subjectIsHome ? awayScore : homeScore;
      // Cover check: subject's score + spread > opponent's score
      // e.g., Lakers -3.5: if Lakers 110, Spurs 108 → 110 + (-3.5) = 106.5 < 108 → did NOT cover
      const covered = subjectScore + spread > opponentScore;

      console.log(
        `[vegas-fv] FINAL SPREAD: ${game.homeTeam} ${homeScore}-${awayScore} ${game.awayTeam} ` +
        `spread=${spread > 0 ? "+" : ""}${spread} → ${covered ? "COVERED" : "NOT COVERED"}`,
      );

      return {
        yesCents: covered ? 99 : 1,
        confidence: 1.0,
        gameState: "final",
        spread,
      };
    }

    // Pre-game — use spread odds from Vegas
    if (!game || game.status === "scheduled") {
      const spreadOdds = await this.getSpreadOdds(league, teamName, subjectTeamLower);

      if (spreadOdds) {
        // Use the cover implied probability directly
        const yesCents = Math.max(1, Math.min(99, Math.round(spreadOdds.odds.coverImplied * 100)));
        console.log(
          `[vegas-fv] PRE-GAME SPREAD: ${title.slice(0, 45)}... → spread=${spreadOdds.odds.spread > 0 ? "+" : ""}${spreadOdds.odds.spread} ` +
          `cover=${(spreadOdds.odds.coverImplied * 100).toFixed(1)}% → FV=${yesCents}¢`,
        );
        return {
          yesCents,
          confidence: 0.8,
          gameState: "pre_game",
          spread,
          vegasImplied: spreadOdds.odds.coverImplied,
        };
      }

      // No spread odds — fall back to 50¢ (spread markets are ~50/50 by design)
      console.log(`[vegas-fv] PRE-GAME SPREAD (no Vegas): ${title.slice(0, 45)}... → FV=50¢`);
      return { yesCents: 50, confidence: 0.3, gameState: "pre_game", spread };
    }

    // In-game — use spread-adjusted point differential
    if (game.status === "in_progress") {
      const homeScore = game.homeScore ?? 0;
      const awayScore = game.awayScore ?? 0;
      const period = game.period ?? 1;
      const clockSeconds = parseClockSeconds(game.displayClock);

      const subjectScore = subjectIsHome ? homeScore : awayScore;
      const opponentScore = subjectIsHome ? awayScore : homeScore;
      // Adjusted diff: how far is the subject from covering?
      // If spread is -3.5 and subject leads by 5 → adjusted = 5 + (-3.5) = 1.5 (ahead of spread)
      // If spread is -3.5 and subject leads by 2 → adjusted = 2 + (-3.5) = -1.5 (behind spread)
      const adjustedDiff = (subjectScore - opponentScore) + spread;

      const scoreFV = winProbFromScore(adjustedDiff, period, clockSeconds, league);

      // Get cached spread odds for blending
      const spreadOdds = await this.getSpreadOdds(league, teamName, subjectTeamLower);
      const vegasSpreadImplied = spreadOdds?.odds.coverImplied;

      // Classify game state using adjusted margin
      const adjustedMargin = Math.abs(adjustedDiff);
      const leagueKey = league.toLowerCase();
      const periodKey = SOCCER_LEAGUES.has(leagueKey) ? "soccer" : leagueKey;
      const sportConfig = SPORT_PERIODS[periodKey] ?? SPORT_PERIODS.nba;
      const earlyPeriodThreshold = Math.ceil(sportConfig.totalPeriods / 2);

      const isSoccer = SOCCER_LEAGUES.has(leagueKey);
      const closeMargin = isSoccer ? 1 : this.closeGameMarginPts;
      const blowoutMargin = isSoccer ? 3 : this.blowoutMarginPts;

      let gameState: GameState;
      let confidence: number;
      let yesFraction: number;

      if (period <= earlyPeriodThreshold) {
        gameState = "early_game";
        const vegasWeight = 0.5;
        yesFraction = vegasWeight * (vegasSpreadImplied ?? 0.5) + (1 - vegasWeight) * scoreFV;
        confidence = 0.5;
      } else if (adjustedMargin >= blowoutMargin) {
        gameState = "late_blowout";
        yesFraction = scoreFV;
        confidence = 0.85;
      } else if (adjustedMargin < closeMargin) {
        gameState = "late_close";
        yesFraction = scoreFV;
        confidence = 0.35; // Spread covers are volatile late
      } else {
        gameState = "early_game";
        yesFraction = 0.3 * (vegasSpreadImplied ?? 0.5) + 0.7 * scoreFV;
        confidence = 0.6;
      }

      const yesCents = Math.max(1, Math.min(99, Math.round(yesFraction * 100)));

      console.log(
        `[vegas-fv] IN-GAME SPREAD ${gameState}: ${title.slice(0, 35)}... Q${period} ${game.displayClock || ""} ` +
        `adj=${adjustedDiff > 0 ? "+" : ""}${adjustedDiff.toFixed(1)} → FV=${yesCents}¢`,
      );

      return {
        yesCents,
        confidence,
        gameState,
        margin: adjustedMargin,
        period,
        spread,
        vegasImplied: vegasSpreadImplied,
      };
    }

    return { yesCents: 50, confidence: 0.3, gameState: "unknown", spread };
  }

  // ─── Totals Market Handler ───

  private async estimateTotals(
    league: string,
    teamName: string,
    subjectTeamLower: string,
    totals: TotalsInfo,
    game: UpcomingGame | null,
    title: string,
  ): Promise<VegasFairValueResult> {
    const { line, side } = totals;
    const totalsField = { line, side };

    // Final — deterministic: did the total go over or under?
    if (game?.status === "final") {
      const actualTotal = (game.homeScore ?? 0) + (game.awayScore ?? 0);
      const wentOver = actualTotal > line;
      // "over" market: YES if total > line. "under" market: YES if total < line.
      const resolved = side === "over" ? wentOver : !wentOver;
      // Exact tie on the line (push) → treat as NO for both sides (half-point lines avoid this)
      const exactPush = actualTotal === line;

      console.log(
        `[vegas-fv] FINAL TOTALS: ${game.homeTeam} ${game.homeScore}-${game.awayScore} ${game.awayTeam} ` +
        `total=${actualTotal} line=${line} → ${exactPush ? "PUSH" : resolved ? "YES" : "NO"}`,
      );

      return {
        yesCents: exactPush ? 50 : resolved ? 99 : 1,
        confidence: exactPush ? 0.5 : 1.0,
        gameState: "final",
        totals: totalsField,
      };
    }

    // Pre-game — use Vegas totals odds
    if (!game || game.status === "scheduled") {
      const totalsOdds = await this.getTotalsOdds(league, teamName, subjectTeamLower);

      if (totalsOdds) {
        // Use the appropriate side's implied probability
        const implied = side === "over" ? totalsOdds.odds.overImplied : totalsOdds.odds.underImplied;
        const yesCents = Math.max(1, Math.min(99, Math.round(implied * 100)));

        console.log(
          `[vegas-fv] PRE-GAME TOTALS: ${title.slice(0, 45)}... → line=${totalsOdds.odds.line} ` +
          `${side}=${(implied * 100).toFixed(1)}% → FV=${yesCents}¢`,
        );

        return {
          yesCents,
          confidence: 0.8,
          gameState: "pre_game",
          totals: totalsField,
          vegasImplied: implied,
        };
      }

      // No Vegas odds — 50/50 (totals lines are set near the expected total)
      console.log(`[vegas-fv] PRE-GAME TOTALS (no Vegas): ${title.slice(0, 45)}... → FV=50¢`);
      return { yesCents: 50, confidence: 0.3, gameState: "pre_game", totals: totalsField };
    }

    // In-game — pace-based projection
    if (game.status === "in_progress") {
      const currentTotal = (game.homeScore ?? 0) + (game.awayScore ?? 0);
      const period = game.period ?? 1;
      const clockSeconds = parseClockSeconds(game.displayClock);

      // P(over) from pace model
      const overProb = totalsProbFromScore(currentTotal, line, period, clockSeconds, league);
      // For "under" markets, P(yes) = 1 - P(over)
      const yesFraction = side === "over" ? overProb : 1 - overProb;

      // Get cached totals odds for blending in early game
      const totalsOdds = await this.getTotalsOdds(league, teamName, subjectTeamLower);
      const vegasImplied = totalsOdds
        ? (side === "over" ? totalsOdds.odds.overImplied : totalsOdds.odds.underImplied)
        : undefined;

      // Classify game state based on pace deviation from expected
      const leagueKey = league.toLowerCase();
      const periodKey = SOCCER_LEAGUES.has(leagueKey) ? "soccer" : leagueKey;
      const sportConfig = SPORT_PERIODS[periodKey] ?? SPORT_PERIODS.nba;
      const earlyPeriodThreshold = Math.ceil(sportConfig.totalPeriods / 2);

      let gameState: GameState;
      let confidence: number;
      let blendedFraction: number;

      if (period <= earlyPeriodThreshold) {
        // Early game — blend pace with Vegas
        gameState = "early_game";
        const vegasWeight = 0.5;
        blendedFraction = vegasWeight * (vegasImplied ?? 0.5) + (1 - vegasWeight) * yesFraction;
        confidence = 0.5;
      } else {
        // Late game — pace dominates
        // Use confidence based on how decisive the pace projection is
        const paceStrength = Math.abs(yesFraction - 0.5) * 2; // 0→1 based on how extreme
        if (paceStrength > 0.7) {
          gameState = "late_blowout"; // Pace strongly favors one side
          blendedFraction = yesFraction;
          confidence = 0.85;
        } else if (paceStrength < 0.2) {
          gameState = "late_close"; // Pace is ambiguous, near the line
          blendedFraction = 0.15 * (vegasImplied ?? 0.5) + 0.85 * yesFraction;
          confidence = 0.4;
        } else {
          gameState = "early_game"; // Medium certainty
          blendedFraction = 0.2 * (vegasImplied ?? 0.5) + 0.8 * yesFraction;
          confidence = 0.65;
        }
      }

      const yesCents = Math.max(1, Math.min(99, Math.round(blendedFraction * 100)));

      console.log(
        `[vegas-fv] IN-GAME TOTALS ${gameState}: ${title.slice(0, 35)}... Q${period} ${game.displayClock || ""} ` +
        `total=${currentTotal} line=${line} pace→${side === "over" ? (overProb * 100).toFixed(0) : ((1 - overProb) * 100).toFixed(0)}% → FV=${yesCents}¢`,
      );

      return {
        yesCents,
        confidence,
        gameState,
        totals: totalsField,
        vegasImplied,
      };
    }

    return { yesCents: 50, confidence: 0.3, gameState: "unknown", totals: totalsField };
  }

  // ─── Data Fetching with Caching ───

  private async getGameData(league: string, subjectTeamLower: string, allTeams?: string[]): Promise<UpcomingGame | null> {
    const cacheKey = `${league}:${subjectTeamLower}`;
    const cached = this.scoreCache.get(cacheKey);

    if (cached) {
      const ttl = this.getScoreCacheTtl(cached.game);
      if (Date.now() - cached.timestamp < ttl) {
        return cached.game;
      }
    }

    const games = await getUpcomingGames(league).catch(() => null);
    if (!games) return cached?.game ?? null;

    // Find all games matching the subject team
    const matching = games.filter((g) => {
      const home = g.homeTeam.toLowerCase();
      const away = g.awayTeam.toLowerCase();
      return home.includes(subjectTeamLower) || away.includes(subjectTeamLower);
    });

    let game: UpcomingGame | null = null;
    if (matching.length > 1) {
      // Multiple matches (e.g. yesterday's final + today's game) —
      // prefer non-final, or match both teams from the market title
      if (allTeams && allTeams.length >= 2) {
        const opponent = allTeams[1].toLowerCase();
        game = matching.find((g) => {
          const home = g.homeTeam.toLowerCase();
          const away = g.awayTeam.toLowerCase();
          return home.includes(opponent) || away.includes(opponent);
        }) || null;
      }
      // If opponent match didn't work, prefer non-final game
      if (!game) {
        game = matching.find((g) => g.status !== "final") ?? matching[0];
      }
    } else {
      game = matching[0] || null;
    }

    if (game) {
      // Score change invalidation
      if (cached && cached.game.status === "in_progress") {
        if (cached.game.homeScore !== game.homeScore || cached.game.awayScore !== game.awayScore) {
          // Score changed — update immediately
        }
      }
      this.scoreCache.set(cacheKey, { game, timestamp: Date.now() });
    }

    return game;
  }

  private getScoreCacheTtl(game: UpcomingGame): number {
    switch (game.status) {
      case "scheduled": return 5 * 60 * 1000;     // 5 min
      case "in_progress": return 30 * 1000;        // 30s
      case "final": return Number.MAX_SAFE_INTEGER; // forever
      default: return 60 * 1000;
    }
  }

  private async getVegasOdds(
    league: string,
    teamName: string,
    subjectTeamLower: string,
    game: UpcomingGame | null,
  ): Promise<VegasCache | null> {
    const cacheKey = `${league}:${subjectTeamLower}`;
    const cached = this.vegasCache.get(cacheKey);

    // If frozen (game started), use cached odds forever
    if (cached?.frozen) return cached;

    // If game just started, freeze current odds
    if (game?.status === "in_progress" && cached && !cached.frozen) {
      cached.frozen = true;
      console.log(`[vegas-fv] Freezing closing odds for ${teamName}`);
      return cached;
    }

    // Pre-game: fetch with 10 min cache
    if (!game || game.status === "scheduled") {
      if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
        return cached;
      }

      const odds = await fetchGameOdds(league, teamName, this.oddsApiKey).catch(() => null);
      if (odds) {
        const entry: VegasCache = { odds, frozen: false, timestamp: Date.now() };
        this.vegasCache.set(cacheKey, entry);
        return entry;
      }
    }

    // Game in progress but no cached odds — can't fetch live Vegas odds
    if (game?.status === "in_progress" && !cached) {
      const odds = await fetchGameOdds(league, teamName, this.oddsApiKey).catch(() => null);
      if (odds) {
        const entry: VegasCache = { odds, frozen: true, timestamp: Date.now() };
        this.vegasCache.set(cacheKey, entry);
        return entry;
      }
    }

    return cached ?? null;
  }

  private async getSpreadOdds(
    league: string,
    teamName: string,
    subjectTeamLower: string,
  ): Promise<{ odds: SpreadOdds; timestamp: number } | null> {
    const cacheKey = `spread:${league}:${subjectTeamLower}`;
    const cached = this.spreadCache.get(cacheKey);

    // 10 min cache for spread odds
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      return cached;
    }

    const odds = await fetchSpreadOdds(league, teamName, this.oddsApiKey).catch(() => null);
    if (odds) {
      const entry = { odds, timestamp: Date.now() };
      this.spreadCache.set(cacheKey, entry);
      return entry;
    }

    return cached ?? null;
  }

  private async getTotalsOdds(
    league: string,
    teamName: string,
    subjectTeamLower: string,
  ): Promise<{ odds: TotalsOdds; timestamp: number } | null> {
    const cacheKey = `totals:${league}:${subjectTeamLower}`;
    const cached = this.totalsCache.get(cacheKey);

    // 10 min cache for totals odds
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      return cached;
    }

    const odds = await fetchTotalsOdds(league, teamName, this.oddsApiKey).catch(() => null);
    if (odds) {
      const entry = { odds, timestamp: Date.now() };
      this.totalsCache.set(cacheKey, entry);
      return entry;
    }

    return cached ?? null;
  }
}
