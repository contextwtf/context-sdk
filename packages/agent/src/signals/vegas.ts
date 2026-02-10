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

export interface TotalsOdds {
  event: string;
  homeTeam: string;
  awayTeam: string;
  /** The totals line (e.g. 224.5, 2.5) */
  line: number;
  /** Implied probability of going over the line. */
  overImplied: number;
  /** Implied probability of going under the line. */
  underImplied: number;
}

export interface SpreadOdds {
  event: string;
  homeTeam: string;
  awayTeam: string;
  /** Spread from the subject team's perspective (negative = favorite, positive = underdog). */
  spread: number;
  /** Implied probability the subject team covers. */
  coverImplied: number;
  /** Implied probability the subject team does NOT cover. */
  noCoverImplied: number;
}

// ─── Sport Key Mapping ───

export const SPORT_CONFIG: Record<string, { key: string; name: string }> = {
  nfl: { key: "americanfootball_nfl", name: "NFL" },
  nba: { key: "basketball_nba", name: "NBA" },
  ncaab: { key: "basketball_ncaab", name: "NCAAB" },
  mlb: { key: "baseball_mlb", name: "MLB" },
  nhl: { key: "icehockey_nhl", name: "NHL" },
  // Soccer
  epl: { key: "soccer_epl", name: "EPL" },
  laliga: { key: "soccer_spain_la_liga", name: "La Liga" },
  bundesliga: { key: "soccer_germany_bundesliga", name: "Bundesliga" },
  seriea: { key: "soccer_italy_serie_a", name: "Serie A" },
  ligue1: { key: "soccer_france_ligue_one", name: "Ligue 1" },
  ucl: { key: "soccer_uefa_champs_league", name: "Champions League" },
  uel: { key: "soccer_uefa_europa_league", name: "Europa League" },
  mls: { key: "soccer_usa_mls", name: "MLS" },
  championship: { key: "soccer_efl_champ", name: "Championship" },
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
        const drawOutcome = h2h?.outcomes.find((o: any) => o.name === "Draw");

        return {
          homeMl: homeOutcome?.price || 0,
          awayMl: awayOutcome?.price || 0,
          homeImplied: americanToImplied(homeOutcome?.price || -100),
          awayImplied: americanToImplied(awayOutcome?.price || 100),
          drawImplied: drawOutcome ? americanToImplied(drawOutcome.price) : 0,
        };
      });

      if (bookmakers.length === 0) continue;

      const avgHomeImplied = bookmakers.reduce((s: number, b: any) => s + b.homeImplied, 0) / bookmakers.length;
      const avgAwayImplied = bookmakers.reduce((s: number, b: any) => s + b.awayImplied, 0) / bookmakers.length;
      const avgDrawImplied = bookmakers.reduce((s: number, b: any) => s + b.drawImplied, 0) / bookmakers.length;

      // For 3-way markets (soccer), remove vig across all 3 outcomes.
      // For 2-way markets, avgDrawImplied === 0 so this is backwards-compatible.
      const allProbs = avgDrawImplied > 0
        ? [avgHomeImplied, avgAwayImplied, avgDrawImplied]
        : [avgHomeImplied, avgAwayImplied];
      const fair = removeVig(allProbs);
      const [fairHome, fairAway] = fair;

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

/**
 * Fetch spread odds for a specific team's upcoming game.
 * Returns the spread and implied cover probability.
 *
 * @param subjectTeam — the team in the market question (the one covering/not covering).
 *   We match this against both home and away, then return the spread from that team's perspective.
 */
export async function fetchSpreadOdds(
  league: string,
  subjectTeam: string,
  apiKey?: string,
): Promise<SpreadOdds | null> {
  const key = apiKey || process.env.ODDS_API_KEY;
  if (!key) return null;

  const config = SPORT_CONFIG[league.toLowerCase()];
  if (!config) return null;

  try {
    const url = `${ODDS_API_BASE}/sports/${config.key}/odds?apiKey=${key}&regions=us&markets=spreads&oddsFormat=american`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const events = await response.json();
    const teamLower = subjectTeam.toLowerCase();

    for (const event of events) {
      const homeMatch = event.home_team.toLowerCase().includes(teamLower);
      const awayMatch = event.away_team.toLowerCase().includes(teamLower);
      if (!homeMatch && !awayMatch) continue;

      const isHome = homeMatch;
      const subjectName = isHome ? event.home_team : event.away_team;
      const opponentName = isHome ? event.away_team : event.home_team;

      const bookmakers = event.bookmakers.map((b: any) => {
        const spreadMarket = b.markets.find((m: any) => m.key === "spreads");
        const subjectOutcome = spreadMarket?.outcomes.find((o: any) => o.name === subjectName);
        const opponentOutcome = spreadMarket?.outcomes.find((o: any) => o.name === opponentName);

        return {
          spread: subjectOutcome?.point ?? 0,
          coverPrice: subjectOutcome?.price ?? -110,
          noCoverPrice: opponentOutcome?.price ?? -110,
        };
      });

      if (bookmakers.length === 0) continue;

      const avgSpread = bookmakers.reduce((s: number, b: any) => s + b.spread, 0) / bookmakers.length;
      const avgCoverImplied = bookmakers.reduce((s: number, b: any) => s + americanToImplied(b.coverPrice), 0) / bookmakers.length;
      const avgNoCoverImplied = bookmakers.reduce((s: number, b: any) => s + americanToImplied(b.noCoverPrice), 0) / bookmakers.length;
      const [fairCover, fairNoCover] = removeVig([avgCoverImplied, avgNoCoverImplied]);

      return {
        event: `${event.away_team} @ ${event.home_team}`,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        spread: avgSpread,
        coverImplied: fairCover,
        noCoverImplied: fairNoCover,
      };
    }

    return null;
  } catch (error) {
    console.error("[vegas] Spread odds fetch error:", error);
    return null;
  }
}

/**
 * Fetch totals (over/under) odds for a specific game.
 * Matches by team name and returns the line + vig-removed over/under probabilities.
 */
export async function fetchTotalsOdds(
  league: string,
  teamName: string,
  apiKey?: string,
): Promise<TotalsOdds | null> {
  const key = apiKey || process.env.ODDS_API_KEY;
  if (!key) return null;

  const config = SPORT_CONFIG[league.toLowerCase()];
  if (!config) return null;

  try {
    const url = `${ODDS_API_BASE}/sports/${config.key}/odds?apiKey=${key}&regions=us&markets=totals&oddsFormat=american`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const events = await response.json();
    const teamLower = teamName.toLowerCase();

    for (const event of events) {
      const homeMatch = event.home_team.toLowerCase().includes(teamLower);
      const awayMatch = event.away_team.toLowerCase().includes(teamLower);
      if (!homeMatch && !awayMatch) continue;

      const bookmakers = event.bookmakers
        .map((b: any) => {
          const totalsMarket = b.markets.find((m: any) => m.key === "totals");
          const overOutcome = totalsMarket?.outcomes.find((o: any) => o.name === "Over");
          const underOutcome = totalsMarket?.outcomes.find((o: any) => o.name === "Under");
          if (!overOutcome || !underOutcome) return null;

          return {
            line: overOutcome.point ?? 0,
            overPrice: overOutcome.price ?? -110,
            underPrice: underOutcome.price ?? -110,
          };
        })
        .filter(Boolean) as { line: number; overPrice: number; underPrice: number }[];

      if (bookmakers.length === 0) continue;

      const avgLine = bookmakers.reduce((s, b) => s + b.line, 0) / bookmakers.length;
      const avgOverImplied = bookmakers.reduce((s, b) => s + americanToImplied(b.overPrice), 0) / bookmakers.length;
      const avgUnderImplied = bookmakers.reduce((s, b) => s + americanToImplied(b.underPrice), 0) / bookmakers.length;
      const [fairOver, fairUnder] = removeVig([avgOverImplied, avgUnderImplied]);

      return {
        event: `${event.away_team} @ ${event.home_team}`,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        line: avgLine,
        overImplied: fairOver,
        underImplied: fairUnder,
      };
    }

    return null;
  } catch (error) {
    console.error("[vegas] Totals odds fetch error:", error);
    return null;
  }
}
