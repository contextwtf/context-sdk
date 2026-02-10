/**
 * LLM Fair Value Provider
 *
 * Uses Claude Haiku to estimate fair value for sports prediction markets.
 * Enriches market snapshots with ESPN team stats and Vegas odds before prompting.
 * Adapts the 3-step reasoning framework from jit-pricing-test/haiku-estimate.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FairValueProvider, FairValueEstimate } from "../fair-value.js";
import type { MarketSnapshot } from "../strategy.js";
import {
  extractLeagueFromQuestion,
  extractTeamsFromTitle,
  getTeamFullStats,
  getUpcomingGames,
  type TeamFullStats,
  type UpcomingGame,
} from "../signals/espn.js";
import { fetchGameOdds, type GameOdds } from "../signals/vegas.js";

// ─── Types ───

export interface LlmFairValueOptions {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Model to use. Default: "claude-haiku-4-5-20251001". */
  model?: string;
  /** Cache TTL in ms for pre-game markets. Default: 120_000 (2 min). */
  cacheTtlMs?: number;
  /** Cache TTL in ms for live in-game markets. Default: 30_000 (30s). */
  liveCacheTtlMs?: number;
  /** Fallback FV in cents if LLM call fails. Default: 50. */
  fallbackCents?: number;
  /** The Odds API key for Vegas odds. Falls back to ODDS_API_KEY env var. */
  oddsApiKey?: string;
  /** League to fetch data for. Default: auto-detect from market title. */
  league?: string;
}

interface CacheEntry {
  estimate: FairValueEstimate;
  reasoning: string;
  timestamp: number;
  ttl: number;
  /** Cached score for invalidation on score change */
  homeScore?: number;
  awayScore?: number;
}

interface EnrichedContext {
  league: string | null;
  teamNames: string[];
  homeStats: TeamFullStats | null;
  awayStats: TeamFullStats | null;
  vegasOdds: GameOdds | null;
  liveGame: UpcomingGame | null;
  /** Whether teamNames[0] (the subject team) is the home team. */
  subjectIsHome: boolean;
}

// ─── LLM Fair Value Provider ───

export class LlmFairValue implements FairValueProvider {
  readonly name = "LLM Fair Value";

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly cacheTtlMs: number;
  private readonly liveCacheTtlMs: number;
  private readonly fallbackCents: number;
  private readonly oddsApiKey?: string;
  private readonly defaultLeague?: string;

  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: LlmFairValueOptions = {}) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model || "claude-haiku-4-5-20251001";
    this.cacheTtlMs = options.cacheTtlMs ?? 120_000;
    this.liveCacheTtlMs = options.liveCacheTtlMs ?? 30_000;
    this.fallbackCents = options.fallbackCents ?? 50;
    this.oddsApiKey = options.oddsApiKey;
    this.defaultLeague = options.league;
  }

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    const { market } = snapshot;

    try {
      // Phase 1: Quick game state check (ESPN scoreboard only)
      const title = market.title || (market as any).question || "";
      const league = this.defaultLeague || extractLeagueFromQuestion(title);
      const teamNames = extractTeamsFromTitle(title);
      const liveGame = await this.findLiveGame(league, teamNames);

      // Final game → deterministic FV based on score, skip LLM entirely
      if (liveGame?.status === "final") {
        return this.handleFinalGame(market.id, liveGame, teamNames);
      }

      // Check cache (with score-based invalidation for live games)
      const cached = this.getCachedWithScore(market.id, liveGame);
      if (cached) return cached;

      // Phase 2: Full enrichment + LLM (only on cache miss)
      const context = await this.enrich(snapshot, league, teamNames, liveGame);

      const ttl = liveGame?.status === "in_progress"
        ? this.liveCacheTtlMs
        : this.cacheTtlMs;

      const prompt = this.buildPrompt(snapshot, context);
      const result = await this.callLlm(prompt);

      // Cache result with score for future invalidation
      this.cache.set(market.id, {
        estimate: result.estimate,
        reasoning: result.reasoning,
        timestamp: Date.now(),
        ttl,
        homeScore: liveGame?.homeScore,
        awayScore: liveGame?.awayScore,
      });

      this.logEstimate(snapshot, context, result);
      return result.estimate;
    } catch (error) {
      console.error(`[llm-fv] Error estimating ${market.id}:`, error);
      return { yesCents: this.fallbackCents, confidence: 0.3 };
    }
  }

  // ─── Game State ───

  private async findLiveGame(
    league: string | null,
    teamNames: string[],
  ): Promise<UpcomingGame | null> {
    if (!league || teamNames.length === 0) return null;

    const games = await getUpcomingGames(league).catch(() => null);
    if (!games) return null;

    const teamLower = teamNames[0].toLowerCase();
    return (
      games.find((g) => {
        const home = g.homeTeam.toLowerCase();
        const away = g.awayTeam.toLowerCase();
        return home.includes(teamLower) || away.includes(teamLower);
      }) || null
    );
  }

  private handleFinalGame(
    marketId: string,
    game: UpcomingGame,
    teamNames: string[],
  ): FairValueEstimate {
    const subjectLower = (teamNames[0] || "").toLowerCase();
    const subjectIsHome = game.homeTeam.toLowerCase().includes(subjectLower);
    const homeScore = game.homeScore ?? 0;
    const awayScore = game.awayScore ?? 0;
    const homeWon = homeScore > awayScore;
    const subjectWon =
      homeScore === awayScore
        ? null // tie (rare — NBA has OT, but other sports can tie)
        : subjectIsHome
          ? homeWon
          : !homeWon;

    const yesCents = subjectWon === null ? 50 : subjectWon ? 97 : 3;
    const confidence = subjectWon === null ? 0.5 : 0.99;
    const estimate: FairValueEstimate = { yesCents, confidence };

    console.log(
      `[llm-fv] FINAL: ${game.homeTeam} ${homeScore} - ${game.awayTeam} ${awayScore} → ${teamNames[0] || "subject"} ${subjectWon === null ? "TIED" : subjectWon ? "WON" : "LOST"} → FV=${yesCents}¢`,
    );

    // Cache indefinitely — game result won't change
    this.cache.set(marketId, {
      estimate,
      reasoning: `Game final: ${game.homeTeam} ${homeScore} - ${game.awayTeam} ${awayScore}`,
      timestamp: Date.now(),
      ttl: Number.MAX_SAFE_INTEGER,
      homeScore,
      awayScore,
    });

    return estimate;
  }

  // ─── Cache ───

  private getCachedWithScore(
    marketId: string,
    liveGame: UpcomingGame | null,
  ): FairValueEstimate | null {
    const entry = this.cache.get(marketId);
    if (!entry) return null;

    // TTL check
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(marketId);
      return null;
    }

    // Score-based invalidation for live games
    if (liveGame?.status === "in_progress") {
      if (entry.homeScore === undefined || entry.awayScore === undefined) {
        // Game just went live — cached entry is from pre-game, invalidate immediately
        console.log(
          `[llm-fv] Game went live ${marketId.slice(0, 8)}..., re-evaluating with live data`,
        );
        this.cache.delete(marketId);
        return null;
      }
      if (
        entry.homeScore !== liveGame.homeScore ||
        entry.awayScore !== liveGame.awayScore
      ) {
        console.log(
          `[llm-fv] Score changed ${marketId.slice(0, 8)}... (${entry.homeScore}-${entry.awayScore} → ${liveGame.homeScore}-${liveGame.awayScore}), re-evaluating`,
        );
        this.cache.delete(marketId);
        return null;
      }
    }

    return entry.estimate;
  }

  // ─── Enrichment ───

  private async enrich(
    snapshot: MarketSnapshot,
    league: string | null,
    teamNames: string[],
    liveGame: UpcomingGame | null,
  ): Promise<EnrichedContext> {
    // teamNames[0] is the "subject team" — the team the market asks about
    // (e.g., "Will the Thunder defeat the Lakers?" → subject = Thunder)

    // Parallel fetch: team stats + vegas odds (scoreboard already fetched in phase 1)
    const [subjectStats, opponentStats, vegasOdds] = await Promise.all([
      league && teamNames[0]
        ? getTeamFullStats(league, teamNames[0]).catch(() => null)
        : Promise.resolve(null),
      league && teamNames[1]
        ? getTeamFullStats(league, teamNames[1]).catch(() => null)
        : Promise.resolve(null),
      league && teamNames[0]
        ? fetchGameOdds(league, teamNames[0], this.oddsApiKey).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Determine which side the subject team is on
    let homeStats = subjectStats;
    let awayStats = opponentStats;
    let subjectIsHome = true;

    if (teamNames[0]) {
      const subjectLower = teamNames[0].toLowerCase();
      // Determine home/away from Vegas data, fall back to ESPN game data
      if (vegasOdds) {
        if (vegasOdds.awayTeam.toLowerCase().includes(subjectLower)) {
          subjectIsHome = false;
        }
      } else if (liveGame) {
        if (liveGame.awayTeam.toLowerCase().includes(subjectLower)) {
          subjectIsHome = false;
        }
      }
      // Swap so homeStats/awayStats match actual home/away
      if (!subjectIsHome) {
        homeStats = opponentStats;
        awayStats = subjectStats;
      }
    }

    return { league, teamNames, homeStats, awayStats, vegasOdds, liveGame, subjectIsHome };
  }

  // ─── Prompt Building ───

  private buildPrompt(snapshot: MarketSnapshot, ctx: EnrichedContext): string {
    const { market, oracleSignals, orderbook } = snapshot;
    const title = market.title || (market as any).question || "Unknown market";
    const isLive = ctx.liveGame?.status === "in_progress";

    const parts: string[] = [];

    // Header
    if (isLive) {
      parts.push(`You are a sports probability analyst. A game is IN PROGRESS.

MARKET QUESTION: ${title}${market.description ? `\nRESOLUTION: ${market.description}` : ""}`);
    } else {
      parts.push(`You are a sports probability analyst for prediction markets.

MARKET QUESTION: ${title}${market.description ? `\nRESOLUTION CRITERIA: ${market.description}` : ""}`);
    }

    // Live game state (highest priority for in-game)
    if (isLive && ctx.liveGame) {
      const g = ctx.liveGame;
      const homeScore = g.homeScore ?? 0;
      const awayScore = g.awayScore ?? 0;
      const lead = homeScore - awayScore;
      const leadTeam = lead > 0 ? g.homeTeam : lead < 0 ? g.awayTeam : "Tied";
      const leadAmt = Math.abs(lead);

      // Determine subject team's relationship to the score
      const subjectLower = (ctx.teamNames[0] || "").toLowerCase();
      const subjectIsHome = g.homeTeam.toLowerCase().includes(subjectLower);
      const subjectScore = subjectIsHome ? homeScore : awayScore;
      const opponentScore = subjectIsHome ? awayScore : homeScore;
      const subjectLead = subjectScore - opponentScore;
      const subjectTeamName = ctx.teamNames[0] || "subject team";
      const subjectStatus = subjectLead > 0
        ? `${subjectTeamName} is WINNING by ${subjectLead}`
        : subjectLead < 0
          ? `${subjectTeamName} is LOSING by ${Math.abs(subjectLead)}`
          : `Game is TIED`;

      parts.push(`
LIVE GAME STATE:
  Score: ${g.homeTeam} ${homeScore} - ${g.awayTeam} ${awayScore}
  ${subjectStatus}
  Period: ${g.statusDetail || `Period ${g.period}`}${g.displayClock ? `, ${g.displayClock} remaining` : ""}
  Quarters remaining: ~${Math.max(0, 4 - (g.period ?? 1))} full quarters + current period`);

      parts.push(`
CRITICAL — USE THESE NBA WIN PROBABILITY BENCHMARKS:
  The market asks about: ${subjectTeamName}
  A team that is LOSING in an NBA game has LESS than 50% win probability.
  Approximate NBA win probabilities by deficit and quarter:
    Down 5 in Q1:  ~38%    Down 5 in Q2:  ~33%    Down 5 in Q3:  ~27%    Down 5 in Q4:  ~18%
    Down 10 in Q1: ~30%    Down 10 in Q2: ~22%    Down 10 in Q3: ~14%    Down 10 in Q4: ~5%
    Down 15 in Q1: ~22%    Down 15 in Q2: ~13%    Down 15 in Q3: ~5%     Down 15 in Q4: ~1%
    Up 5 in Q1:    ~62%    Up 5 in Q2:    ~67%    Up 5 in Q3:    ~73%    Up 5 in Q4:    ~82%
    Up 10 in Q1:   ~70%    Up 10 in Q2:   ~78%    Up 10 in Q3:   ~86%    Up 10 in Q4:   ~95%
  Use these as your ANCHOR. Adjust slightly for team quality, but the score + clock dominates.
  Do NOT return a probability above 50% for a team that is currently losing.`);
    }

    // Team data
    if (ctx.homeStats || ctx.awayStats) {
      parts.push(`\nTEAM DATA:
  League: ${ctx.league?.toUpperCase() || "Unknown"}`);

      if (ctx.homeStats) {
        const h = ctx.homeStats;
        parts.push(`  Home: ${h.team}
    Record: ${h.wins}-${h.losses} (${h.winPct.toFixed(3)})${h.pointsPerGame ? `, PPG: ${h.pointsPerGame.toFixed(1)}` : ""}${h.pointsAllowedPerGame ? `, Opp PPG: ${h.pointsAllowedPerGame.toFixed(1)}` : ""}${h.lastFiveRecord ? `, Last 5: ${h.lastFiveRecord}` : ""}${h.streak ? `, Streak: ${h.streak}` : ""}`);
      }

      if (ctx.awayStats) {
        const a = ctx.awayStats;
        parts.push(`  Away: ${a.team}
    Record: ${a.wins}-${a.losses} (${a.winPct.toFixed(3)})${a.pointsPerGame ? `, PPG: ${a.pointsPerGame.toFixed(1)}` : ""}${a.pointsAllowedPerGame ? `, Opp PPG: ${a.pointsAllowedPerGame.toFixed(1)}` : ""}${a.lastFiveRecord ? `, Last 5: ${a.lastFiveRecord}` : ""}${a.streak ? `, Streak: ${a.streak}` : ""}`);
      }
    }

    // Vegas odds — label with actual team names, highlight subject team
    if (ctx.vegasOdds) {
      const v = ctx.vegasOdds.consensus;
      const subjectImplied = ctx.subjectIsHome ? v.homeImplied : v.awayImplied;
      const subjectMl = ctx.subjectIsHome ? v.homeMl : v.awayMl;
      const opponentImplied = ctx.subjectIsHome ? v.awayImplied : v.homeImplied;
      const opponentMl = ctx.subjectIsHome ? v.awayMl : v.homeMl;
      const subjectName = ctx.teamNames[0] || "Subject";
      const opponentName = ctx.teamNames[1] || "Opponent";

      parts.push(`
VEGAS ODDS:
  ${subjectName} (${ctx.subjectIsHome ? "Home" : "Away"}): ML ${subjectMl > 0 ? "+" : ""}${subjectMl}, Implied ${(subjectImplied * 100).toFixed(1)}%
  ${opponentName} (${ctx.subjectIsHome ? "Away" : "Home"}): ML ${opponentMl > 0 ? "+" : ""}${opponentMl}, Implied ${(opponentImplied * 100).toFixed(1)}%
  → Vegas gives ${subjectName} a ${(subjectImplied * 100).toFixed(0)}% chance to win`);
    }

    // Oracle evidence
    if (oracleSignals.length > 0) {
      parts.push(`\nORACLE EVIDENCE:`);
      for (const signal of oracleSignals.slice(0, 3)) {
        parts.push(`  [${signal.source}] confidence: ${(signal.confidence * 100).toFixed(0)}%${signal.evidence ? `\n    ${signal.evidence.slice(0, 200)}` : ""}`);
      }
    }

    // Current market price (orderbook prices are already in cents)
    const bestBid = orderbook.bids[0];
    const bestAsk = orderbook.asks[0];
    if (bestBid || bestAsk) {
      const bidCents = bestBid ? Math.round(bestBid.price) : "—";
      const askCents = bestAsk ? Math.round(bestAsk.price) : "—";
      const mid = bestBid && bestAsk
        ? Math.round((bestBid.price + bestAsk.price) / 2)
        : "—";
      parts.push(`
CURRENT MARKET: Best bid ${bidCents}¢, Best ask ${askCents}¢ (midpoint: ${mid}¢)`);
    }

    // Reasoning framework — weight Vegas vs score based on game progress
    const period = ctx.liveGame?.period ?? 0;
    const isEarlyGame = isLive && period <= 1;
    const isMidGame = isLive && period === 2;
    const isLateGame = isLive && period >= 3;

    let step1: string;
    let step2: string;
    let step3: string;

    if (!isLive) {
      step1 = ctx.vegasOdds
        ? "• Use Vegas implied probability as your anchor — it's the strongest pre-game signal."
        : "• Use team records and recent form to set an initial estimate. If no data, start at 50%.";
      step2 = `• ESPN team stats (record, PPG, recent form, streak)
• Oracle evidence (if available and relevant)
• Current market price (what other traders think)`;
      step3 = `• Home court advantage (NBA: ~3-4 pts, worth ~5-7% for evenly matched teams)
• Recent form and momentum (hot/cold streaks)
• Strength of schedule context`;
    } else if (isEarlyGame) {
      // Q1: Vegas is the primary anchor, score is noise
      step1 = ctx.vegasOdds
        ? `• START from Vegas implied probability — it is your PRIMARY anchor in Q1.
• The score this early is mostly noise. A 5-point lead in Q1 shifts win probability only ~3-5%.`
        : "• Use team records and quality as your anchor. Early game score shifts are small.";
      step2 = `• Vegas odds are the strongest signal in Q1 (~80% weight)
• Current score adjusts Vegas by only a few percent (e.g., down 5 in Q1 = Vegas minus ~4%)
• Team quality and home court matter more than the scoreboard right now`;
      step3 = `• Stay close to the Vegas line — do NOT overreact to early scoring runs
• Adjust Vegas by at most ±8% for the current score in Q1
• Home court adds ~2-3% on top of Vegas`;
    } else if (isMidGame) {
      // Q2: Blend Vegas and score roughly 50/50
      step1 = `• Blend Vegas odds and score-based benchmarks roughly equally.
• Use the WIN PROBABILITY BENCHMARKS as a reference, but anchor partially on Vegas.`;
      step2 = `• Vegas odds still carry significant weight (~50%) in Q2
• Score margin starts to matter more — use the benchmarks table as a guide
• A 10-point deficit in Q2 is meaningful but not decisive`;
      step3 = `• Your estimate should be between the Vegas implied probability and the score-based benchmark
• Stronger teams can recover from Q2 deficits — adjust ~3-5% for team quality
• Home court adds ~2-3% in close games`;
    } else {
      // Q3+/Q4: Score dominates
      step1 = "• Use the WIN PROBABILITY BENCHMARKS above as your anchor. Find the row matching the current deficit/lead and quarter.";
      step2 = `• START from the benchmark win probability for the current score margin and quarter
• Adjust slightly for team quality (better teams recover from deficits more often)
• Pre-game Vegas odds are secondary context only — the live score dominates`;
      step3 = `• A losing team's probability should be BELOW 50% unless the deficit is tiny (1-2 pts)
• Stronger teams get +3-5% adjustment vs the benchmark, weaker teams get -3-5%
• Home court adds ~2-3% in close games
• NEVER return above 50% for a team that is losing by 5+ points`;
    }

    parts.push(`
YOUR TASK — Estimate the probability that YES wins this market.

Follow this 3-step process:

STEP 1: SET YOUR PRIOR
${step1}

STEP 2: INCORPORATE SIGNALS
${step2}

STEP 3: APPLY ADJUSTMENTS
${step3}

Respond with ONLY this JSON:
{
  "estimate": <number 1-99, probability YES wins>,
  "confidence": "high" | "medium" | "low",
  "reasoning": "<2-3 sentences: prior → signals → adjustments → final>"
}`);

    return parts.join("\n");
  }

  // ─── LLM Call ───

  private async callLlm(prompt: string): Promise<{
    estimate: FairValueEstimate;
    reasoning: string;
  }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[llm-fv] Failed to parse JSON: ${text.slice(0, 200)}`);
      return {
        estimate: { yesCents: this.fallbackCents, confidence: 0.3 },
        reasoning: "Failed to parse LLM response",
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      const yesCents = typeof parsed.estimate === "number"
        ? Math.max(1, Math.min(99, Math.round(parsed.estimate)))
        : this.fallbackCents;

      const confidenceMap: Record<string, number> = {
        high: 0.9,
        medium: 0.7,
        low: 0.4,
      };
      const confidence = confidenceMap[parsed.confidence] ?? 0.5;

      return {
        estimate: { yesCents, confidence },
        reasoning: parsed.reasoning || "",
      };
    } catch {
      // Try to extract just the estimate
      const estimateMatch = text.match(/"estimate"\s*:\s*(\d+(?:\.\d+)?)/);
      const yesCents = estimateMatch
        ? Math.max(1, Math.min(99, Math.round(parseFloat(estimateMatch[1]))))
        : this.fallbackCents;

      return {
        estimate: { yesCents, confidence: 0.4 },
        reasoning: "Partial parse of LLM response",
      };
    }
  }

  // ─── Logging ───

  private logEstimate(
    snapshot: MarketSnapshot,
    ctx: EnrichedContext,
    result: { estimate: FairValueEstimate; reasoning: string },
  ) {
    const title = (snapshot.market.title || (snapshot.market as any).question || "Unknown").slice(0, 50);
    const id = snapshot.market.id.slice(0, 10);
    const fv = result.estimate.yesCents;
    const conf = result.estimate.confidence >= 0.8 ? "high"
      : result.estimate.confidence >= 0.6 ? "med" : "low";

    const subjectImplied = ctx.vegasOdds
      ? (ctx.subjectIsHome ? ctx.vegasOdds.consensus.homeImplied : ctx.vegasOdds.consensus.awayImplied)
      : null;
    const vegasStr = subjectImplied !== null
      ? `Vegas=${(subjectImplied * 100).toFixed(0)}%`
      : "no Vegas";

    const bestBid = snapshot.orderbook.bids[0];
    const bestAsk = snapshot.orderbook.asks[0];
    const mid = bestBid && bestAsk
      ? Math.round((bestBid.price + bestAsk.price) / 2)
      : "—";

    const liveStr = ctx.liveGame?.status === "in_progress"
      ? ` [LIVE: ${ctx.liveGame.homeScore}-${ctx.liveGame.awayScore} ${ctx.liveGame.statusDetail}]`
      : "";

    console.log(
      `[llm-fv] ${title}... (${id}): FV=${fv}¢ (${conf}), ${vegasStr}, Market mid=${mid}¢${liveStr}`,
    );
  }
}
