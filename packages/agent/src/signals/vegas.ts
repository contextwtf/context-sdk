/**
 * Vegas Odds Signal
 *
 * Fetches sports betting odds and converts to implied probabilities.
 * Uses The Odds API (https://the-odds-api.com).
 * Ported from jit-pricing-test/src/app/api/signals/vegas/route.ts — core utilities only.
 */

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// ─── Types ───

export interface GameOdds {
  event: string;
  sport: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  consensus: {
    homeImplied: number;
    awayImplied: number;
    homeMl: number;
    awayMl: number;
    vig: number;
  };
}

// ─── Sport Key Mapping ───

export const SPORT_CONFIG: Record<string, { key: string; name: string }> = {
  nfl: { key: "americanfootball_nfl", name: "NFL" },
  nba: { key: "basketball_nba", name: "NBA" },
  ncaab: { key: "basketball_ncaab", name: "NCAAB" },
  mlb: { key: "baseball_mlb", name: "MLB" },
  nhl: { key: "icehockey_nhl", name: "NHL" },
};

// ─── Core Utilities ───

/**
 * Convert American odds to implied probability (0-1).
 */
export function americanToImplied(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

/**
 * Remove bookmaker vig to get fair probabilities.
 * Input: raw implied probs that sum > 1. Output: fair probs that sum to 1.
 */
export function removeVig(probs: number[]): number[] {
  const total = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / total);
}

/**
 * Fetch moneyline game odds for a specific team's upcoming game.
 * Returns consensus odds across bookmakers with vig removed.
 */
export async function fetchGameOdds(
  league: string,
  teamName: string,
  apiKey?: string,
): Promise<GameOdds | null> {
  const key = apiKey || process.env.ODDS_API_KEY;
  if (!key) return null;

  const config = SPORT_CONFIG[league.toLowerCase()];
  if (!config) return null;

  try {
    const url = `${ODDS_API_BASE}/sports/${config.key}/odds?apiKey=${key}&regions=us&markets=h2h&oddsFormat=american`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const events = await response.json();
    const teamLower = teamName.toLowerCase();

    for (const event of events) {
      const homeMatch = event.home_team.toLowerCase().includes(teamLower);
      const awayMatch = event.away_team.toLowerCase().includes(teamLower);

      if (!homeMatch && !awayMatch) continue;

      const bookmakers = event.bookmakers.map((b: any) => {
        const h2h = b.markets.find((m: any) => m.key === "h2h");
        const homeOutcome = h2h?.outcomes.find((o: any) => o.name === event.home_team);
        const awayOutcome = h2h?.outcomes.find((o: any) => o.name === event.away_team);

        return {
          homeMl: homeOutcome?.price || 0,
          awayMl: awayOutcome?.price || 0,
          homeImplied: americanToImplied(homeOutcome?.price || -100),
          awayImplied: americanToImplied(awayOutcome?.price || 100),
        };
      });

      if (bookmakers.length === 0) continue;

      const avgHomeImplied = bookmakers.reduce((s: number, b: any) => s + b.homeImplied, 0) / bookmakers.length;
      const avgAwayImplied = bookmakers.reduce((s: number, b: any) => s + b.awayImplied, 0) / bookmakers.length;
      const [fairHome, fairAway] = removeVig([avgHomeImplied, avgAwayImplied]);

      return {
        event: `${event.away_team} @ ${event.home_team}`,
        sport: event.sport_title,
        commenceTime: event.commence_time,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        consensus: {
          homeMl: Math.round(bookmakers.reduce((s: number, b: any) => s + b.homeMl, 0) / bookmakers.length),
          awayMl: Math.round(bookmakers.reduce((s: number, b: any) => s + b.awayMl, 0) / bookmakers.length),
          homeImplied: fairHome,
          awayImplied: fairAway,
          vig: (avgHomeImplied + avgAwayImplied - 1) * 100,
        },
      };
    }

    return null;
  } catch (error) {
    console.error("[vegas] Game odds fetch error:", error);
    return null;
  }
}
