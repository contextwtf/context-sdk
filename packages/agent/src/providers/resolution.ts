/**
 * Resolution Fair Value Provider
 *
 * Detects markets near resolution and returns deterministic fair values.
 * Sports markets: checks ESPN game status for "final" results.
 * Non-sports: checks oracle signals for high-confidence resolution indicators.
 * Market price extremes: confirms resolution when price is already at extremes.
 *
 * Returns FV 99 (resolved YES) or 1 (resolved NO) with confidence 1.0,
 * or FV 50 with confidence 0.0 for unresolved markets (confidence gate skips these).
 */

import type { FairValueProvider, FairValueEstimate } from "../fair-value.js";
import type { MarketSnapshot } from "../strategy.js";
import {
  extractLeagueFromQuestion,
  extractTeamsFromTitle,
  getUpcomingGames,
  type UpcomingGame,
} from "../signals/espn.js";

// ─── Resolution Detection ───

const YES_PATTERNS = [
  /resolved?\s+yes/i,
  /\bconfirmed\b/i,
  /\bhas occurred\b/i,
  /\bhas been\b/i,
  /\bwon\b/i,
  /\bpassed\b/i,
  /\bapproved\b/i,
  /\benacted\b/i,
];

const NO_PATTERNS = [
  /resolved?\s+no/i,
  /\bdid not\b/i,
  /\bfailed\b/i,
  /\bhas not\b/i,
  /\blost\b/i,
  /\brejected\b/i,
  /\bdenied\b/i,
  /\bdefeated\b/i,
];

interface ResolutionResult {
  resolved: boolean;
  outcome: "yes" | "no" | null;
  source: string;
}

// ─── Provider ───

export class ResolutionFairValue implements FairValueProvider {
  readonly name = "Resolution Fair Value";

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    const { market } = snapshot;
    const title = market.title || (market as any).question || "";

    // Path 1: Sports resolution
    const sportsResult = await this.checkSportsResolution(title);
    if (sportsResult.resolved && sportsResult.outcome) {
      console.log(
        `[resolution-fv] ${title.slice(0, 50)}... → SPORTS ${sportsResult.outcome.toUpperCase()} (${sportsResult.source})`,
      );
      return {
        yesCents: sportsResult.outcome === "yes" ? 99 : 1,
        confidence: 1.0,
      };
    }

    // Path 2: Oracle synthesis
    const oracleResult = this.checkOracleResolution(snapshot);
    if (oracleResult.resolved && oracleResult.outcome) {
      console.log(
        `[resolution-fv] ${title.slice(0, 50)}... → ORACLE ${oracleResult.outcome.toUpperCase()} (${oracleResult.source})`,
      );
      return {
        yesCents: oracleResult.outcome === "yes" ? 99 : 1,
        confidence: 1.0,
      };
    }

    // Path 3: Market price confirmation
    const priceResult = this.checkPriceResolution(snapshot);
    if (priceResult.resolved && priceResult.outcome) {
      console.log(
        `[resolution-fv] ${title.slice(0, 50)}... → PRICE ${priceResult.outcome.toUpperCase()} (${priceResult.source})`,
      );
      return {
        yesCents: priceResult.outcome === "yes" ? 99 : 1,
        confidence: 0.9,
      };
    }

    // Not resolved — return low confidence so strategy skips
    return { yesCents: 50, confidence: 0.0 };
  }

  // ─── Sports Path ───

  private async checkSportsResolution(title: string): Promise<ResolutionResult> {
    const league = extractLeagueFromQuestion(title);
    if (!league) return { resolved: false, outcome: null, source: "" };

    const teamNames = extractTeamsFromTitle(title);
    if (teamNames.length === 0) return { resolved: false, outcome: null, source: "" };

    const games = await getUpcomingGames(league).catch(() => null);
    if (!games) return { resolved: false, outcome: null, source: "" };

    const subjectTeam = teamNames[0].toLowerCase();
    const game = this.findTeamGame(games, subjectTeam);
    if (!game || game.status !== "final") {
      return { resolved: false, outcome: null, source: "" };
    }

    const homeScore = game.homeScore ?? 0;
    const awayScore = game.awayScore ?? 0;

    if (homeScore === awayScore) {
      return { resolved: false, outcome: null, source: "tie" };
    }

    const subjectIsHome = game.homeTeam.toLowerCase().includes(subjectTeam);
    const subjectWon = subjectIsHome
      ? homeScore > awayScore
      : awayScore > homeScore;

    return {
      resolved: true,
      outcome: subjectWon ? "yes" : "no",
      source: `${game.homeTeam} ${homeScore}-${awayScore} ${game.awayTeam} (FINAL)`,
    };
  }

  private findTeamGame(games: UpcomingGame[], teamLower: string): UpcomingGame | null {
    return games.find((g) => {
      const home = g.homeTeam.toLowerCase();
      const away = g.awayTeam.toLowerCase();
      return home.includes(teamLower) || away.includes(teamLower);
    }) || null;
  }

  // ─── Oracle Path ───

  private checkOracleResolution(snapshot: MarketSnapshot): ResolutionResult {
    const { oracleSignals } = snapshot;

    const highConfidence = oracleSignals.filter(
      (s) => typeof s.confidence === "number" && s.confidence >= 0.9,
    );

    if (highConfidence.length === 0) {
      return { resolved: false, outcome: null, source: "" };
    }

    let yesVotes = 0;
    let noVotes = 0;

    for (const signal of highConfidence) {
      const outcome = (signal as any).outcome;
      const evidence = signal.evidence || "";

      if (outcome === "yes" || outcome === true) {
        yesVotes++;
      } else if (outcome === "no" || outcome === false) {
        noVotes++;
      } else {
        // Scan evidence text for resolution patterns
        const hasYes = YES_PATTERNS.some((p) => p.test(evidence));
        const hasNo = NO_PATTERNS.some((p) => p.test(evidence));

        if (hasYes && !hasNo) yesVotes++;
        else if (hasNo && !hasYes) noVotes++;
      }
    }

    // Need agreement — if signals conflict, skip
    if (yesVotes > 0 && noVotes === 0) {
      return {
        resolved: true,
        outcome: "yes",
        source: `${yesVotes} oracle signal(s) agree YES`,
      };
    }
    if (noVotes > 0 && yesVotes === 0) {
      return {
        resolved: true,
        outcome: "no",
        source: `${noVotes} oracle signal(s) agree NO`,
      };
    }

    return { resolved: false, outcome: null, source: "conflicting signals" };
  }

  // ─── Price Path ───

  private checkPriceResolution(snapshot: MarketSnapshot): ResolutionResult {
    const { orderbook } = snapshot;
    const bestBid = orderbook.bids[0]?.price;
    const bestAsk = orderbook.asks[0]?.price;

    if (bestBid === undefined && bestAsk === undefined) {
      return { resolved: false, outcome: null, source: "" };
    }

    const mid = bestBid !== undefined && bestAsk !== undefined
      ? (bestBid + bestAsk) / 2
      : bestBid ?? bestAsk ?? 50;

    if (mid > 90) {
      return {
        resolved: true,
        outcome: "yes",
        source: `market mid=${Math.round(mid)}¢ (near 100)`,
      };
    }
    if (mid < 10) {
      return {
        resolved: true,
        outcome: "no",
        source: `market mid=${Math.round(mid)}¢ (near 0)`,
      };
    }

    return { resolved: false, outcome: null, source: "" };
  }
}
