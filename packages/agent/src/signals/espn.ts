/**
 * ESPN Sports Signal
 *
 * Fetches team standings, schedules, stats, and live game state from ESPN API.
 * Free, no auth needed. Ported from jit-pricing-test/src/lib/signals/sports.ts
 * with live game state extension for in-game trading.
 */

// ESPN API base URLs (public, no auth)
const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_API_V2 = "https://site.api.espn.com/apis/v2/sports";

// ─── Types ───

export interface TeamStanding {
  team: string;
  teamId: string;
  logo?: string;
  wins: number;
  losses: number;
  ties?: number;
  winPct: number;
  streak?: string;
  divisionRank?: number;
  conferenceRank?: number;
  playoffSeed?: number;
  gamesBack?: number;
  pointsFor?: number;
  pointsAgainst?: number;
}

export interface UpcomingGame {
  gameId: string;
  date: string;
  time: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string;
  awayTeamId: string;
  venue?: string;
  broadcast?: string;
  status: "scheduled" | "in_progress" | "final" | "postponed";
  homeScore?: number;
  awayScore?: number;
  /** Current quarter/period (1-4, 5+ for OT). Only when status === "in_progress". */
  period?: number;
  /** Game clock remaining, e.g. "5:32". Only when status === "in_progress". */
  displayClock?: string;
  /** Human-readable status, e.g. "3rd Quarter", "Halftime". */
  statusDetail?: string;
}

export interface TeamStats {
  teamId: string;
  team: string;
  league: string;
  gamesPlayed: number;
  pointsPerGame?: number;
  pointsAllowedPerGame?: number;
  pointDifferential?: number;
  fieldGoalPct?: number;
  threePointPct?: number;
  reboundsPerGame?: number;
  assistsPerGame?: number;
  turnoversPerGame?: number;
}

export interface TeamFullStats {
  team: string;
  teamId: string;
  league: string;
  wins: number;
  losses: number;
  winPct: number;
  conferenceRank?: number;
  pointsPerGame?: number;
  pointsAllowedPerGame?: number;
  pointDifferential?: number;
  lastFiveRecord?: string;
  lastFiveWinPct?: number;
  streak?: string;
}

// ─── League & Team Mappings ───

export const SPORT_LEAGUES: Record<string, { sport: string; league: string }> = {
  nfl: { sport: "football", league: "nfl" },
  nba: { sport: "basketball", league: "nba" },
  mlb: { sport: "baseball", league: "mlb" },
  nhl: { sport: "hockey", league: "nhl" },
  ncaaf: { sport: "football", league: "college-football" },
  ncaab: { sport: "basketball", league: "mens-college-basketball" },
  mls: { sport: "soccer", league: "usa.1" },
  epl: { sport: "soccer", league: "eng.1" },
};

export const TEAM_ALIASES: Record<string, string[]> = {
  // NFL
  "kansas city chiefs": ["chiefs", "kc chiefs", "kansas city"],
  "san francisco 49ers": ["49ers", "niners", "sf 49ers", "san francisco"],
  "philadelphia eagles": ["eagles"],
  "buffalo bills": ["bills", "buffalo"],
  "dallas cowboys": ["cowboys"],
  "new york giants": ["giants", "ny giants"],
  "new york jets": ["jets", "ny jets"],
  "los angeles rams": ["rams", "la rams"],
  "los angeles chargers": ["chargers", "la chargers"],
  // NBA (all 30 teams)
  "atlanta hawks": ["hawks", "atlanta"],
  "boston celtics": ["celtics"],
  "brooklyn nets": ["nets", "brooklyn"],
  "charlotte hornets": ["hornets", "charlotte"],
  "chicago bulls": ["bulls", "chicago"],
  "cleveland cavaliers": ["cavaliers", "cavs", "cleveland"],
  "dallas mavericks": ["mavericks", "mavs"],
  "denver nuggets": ["nuggets", "denver"],
  "detroit pistons": ["pistons", "detroit"],
  "golden state warriors": ["warriors", "gsw", "golden state"],
  "houston rockets": ["rockets", "houston"],
  "indiana pacers": ["pacers", "indiana"],
  "los angeles clippers": ["clippers", "la clippers"],
  "los angeles lakers": ["lakers", "la lakers"],
  "memphis grizzlies": ["grizzlies", "memphis"],
  "miami heat": ["heat", "miami"],
  "milwaukee bucks": ["bucks", "milwaukee"],
  "minnesota timberwolves": ["timberwolves", "wolves", "minnesota"],
  "new orleans pelicans": ["pelicans", "new orleans"],
  "new york knicks": ["knicks", "ny knicks"],
  "oklahoma city thunder": ["thunder", "okc"],
  "orlando magic": ["magic", "orlando"],
  "philadelphia 76ers": ["76ers", "sixers", "philly"],
  "phoenix suns": ["suns", "phoenix"],
  "portland trail blazers": ["trail blazers", "blazers", "portland"],
  "sacramento kings": ["kings", "sacramento"],
  "san antonio spurs": ["spurs", "san antonio"],
  "toronto raptors": ["raptors", "toronto"],
  "utah jazz": ["jazz", "utah"],
  "washington wizards": ["wizards", "washington"],
  // MLB
  "new york yankees": ["yankees", "ny yankees"],
  "los angeles dodgers": ["dodgers", "la dodgers"],
  "boston red sox": ["red sox", "boston sox"],
  // NHL
  "new york rangers": ["rangers", "ny rangers"],
  "vegas golden knights": ["golden knights", "vegas knights"],
};

// ─── Core Functions ───

/**
 * Get league standings.
 */
export async function getStandings(league: string): Promise<TeamStanding[] | null> {
  const leagueInfo = SPORT_LEAGUES[league.toLowerCase()];
  if (!leagueInfo) return null;

  try {
    const url = `${ESPN_API_V2}/${leagueInfo.sport}/${leagueInfo.league}/standings`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const standings: TeamStanding[] = [];

    const groups = data.children || [];
    for (const group of groups) {
      const entries = group.standings?.entries || [];
      for (const entry of entries) {
        const team = entry.team;
        const stats = entry.stats || [];

        const getStatValue = (name: string): number => {
          const stat = stats.find((s: any) => s.name === name || s.abbreviation === name);
          return stat?.value ?? 0;
        };

        const getStatDisplay = (name: string): string | undefined => {
          const stat = stats.find((s: any) => s.name === name);
          return stat?.displayValue;
        };

        standings.push({
          team: team.displayName,
          teamId: team.id,
          logo: team.logos?.[0]?.href,
          wins: getStatValue("wins"),
          losses: getStatValue("losses"),
          ties: getStatValue("ties") || undefined,
          winPct: getStatValue("winPercent") || getStatValue("leagueWinPercent") || 0,
          streak: getStatDisplay("streak"),
          divisionRank: getStatValue("divisionRank") || undefined,
          conferenceRank: getStatValue("playoffSeed") || undefined,
          playoffSeed: getStatValue("playoffSeed") || undefined,
          gamesBack: getStatValue("gamesBehind") || undefined,
          pointsFor: getStatValue("pointsFor") || getStatValue("avgPointsFor"),
          pointsAgainst: getStatValue("pointsAgainst") || getStatValue("avgPointsAgainst"),
        });
      }
    }

    return standings.sort((a, b) => b.winPct - a.winPct);
  } catch (error) {
    console.error(`[espn] Failed to fetch ${league} standings:`, error);
    return null;
  }
}

/**
 * Get today's games with live scores and game state.
 */
export async function getUpcomingGames(league: string): Promise<UpcomingGame[] | null> {
  const leagueInfo = SPORT_LEAGUES[league.toLowerCase()];
  if (!leagueInfo) return null;

  try {
    const url = `${ESPN_API}/${leagueInfo.sport}/${leagueInfo.league}/scoreboard`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const events = data.events || [];
    const games: UpcomingGame[] = [];

    for (const event of events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const homeTeam = competition.competitors?.find((c: any) => c.homeAway === "home");
      const awayTeam = competition.competitors?.find((c: any) => c.homeAway === "away");
      if (!homeTeam || !awayTeam) continue;

      let status: UpcomingGame["status"] = "scheduled";
      const state = event.status?.type?.state?.toLowerCase();
      if (state === "in") status = "in_progress";
      else if (state === "post") status = "final";
      else if (state === "postponed" || state === "canceled") status = "postponed";

      const game: UpcomingGame = {
        gameId: event.id,
        date: event.date?.split("T")[0] || "",
        time: event.date || "",
        homeTeam: homeTeam.team.displayName,
        awayTeam: awayTeam.team.displayName,
        homeTeamId: homeTeam.team.id,
        awayTeamId: awayTeam.team.id,
        venue: competition.venue?.fullName,
        broadcast: competition.broadcasts?.[0]?.names?.[0],
        status,
        homeScore: status !== "scheduled" ? parseInt(homeTeam.score) : undefined,
        awayScore: status !== "scheduled" ? parseInt(awayTeam.score) : undefined,
      };

      // Live game state (only when in progress)
      if (status === "in_progress") {
        game.period = event.status?.period;
        game.displayClock = event.status?.displayClock;
        game.statusDetail = event.status?.type?.shortDetail;
      }

      games.push(game);
    }

    return games;
  } catch (error) {
    console.error(`[espn] Failed to fetch ${league} games:`, error);
    return null;
  }
}

/**
 * Find a team by name (fuzzy match against standings).
 */
export async function findTeam(
  league: string,
  teamQuery: string,
): Promise<{ id: string; name: string; logo?: string } | null> {
  const standings = await getStandings(league);
  if (!standings) return null;

  const query = teamQuery.toLowerCase().trim();

  // Exact match first
  const exact = standings.find((t) => t.team.toLowerCase() === query);
  if (exact) return { id: exact.teamId, name: exact.team, logo: exact.logo };

  // Check aliases
  let canonicalName: string | null = null;
  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some((a) => a === query || query.includes(a) || a.includes(query))) {
      canonicalName = canonical;
      break;
    }
  }

  if (canonicalName) {
    const parts = canonicalName.split(" ");
    const shortName = parts[parts.length - 1];
    const match = standings.find((t) => {
      const teamLower = t.team.toLowerCase();
      return teamLower === canonicalName ||
        teamLower.includes(canonicalName!) ||
        teamLower.endsWith(shortName);
    });
    if (match) return { id: match.teamId, name: match.team, logo: match.logo };
  }

  // Partial match — team name or nickname
  const partial = standings.find((t) => {
    const teamLower = t.team.toLowerCase();
    const nickname = teamLower.split(" ").pop() || "";
    return teamLower.includes(query) || nickname === query || query.includes(nickname);
  });
  if (partial) return { id: partial.teamId, name: partial.team, logo: partial.logo };

  return null;
}

/**
 * Get team's current record from standings.
 */
export async function getTeamRecord(
  league: string,
  teamQuery: string,
): Promise<TeamStanding | null> {
  const standings = await getStandings(league);
  if (!standings) return null;

  const team = await findTeam(league, teamQuery);
  if (!team) return null;

  return standings.find((s) => s.teamId === team.id) || null;
}

/**
 * Get comprehensive team statistics.
 */
export async function getTeamStats(
  league: string,
  teamId: string,
): Promise<TeamStats | null> {
  const leagueInfo = SPORT_LEAGUES[league.toLowerCase()];
  if (!leagueInfo) return null;

  try {
    const url = `${ESPN_API}/${leagueInfo.sport}/${leagueInfo.league}/teams/${teamId}/statistics`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const categories = data.results?.stats?.categories || [];

    const findStat = (categoryName: string, statName: string): number | undefined => {
      const category = categories.find((c: any) => c.name === categoryName);
      if (!category) return undefined;
      const stat = category.stats?.find((s: any) =>
        s.name === statName || s.abbreviation === statName,
      );
      return stat?.value;
    };

    const findStatAny = (statName: string): number | undefined => {
      for (const category of categories) {
        const stat = category.stats?.find((s: any) =>
          s.name === statName || s.abbreviation === statName,
        );
        if (stat?.value !== undefined) return stat.value;
      }
      return undefined;
    };

    const teamStats: TeamStats = {
      teamId,
      team: data.team?.displayName || "Unknown",
      league: league.toLowerCase(),
      gamesPlayed: findStatAny("gamesPlayed") || findStatAny("GP") || 0,
    };

    if (["nba", "ncaab"].includes(league.toLowerCase())) {
      teamStats.pointsPerGame = findStat("offensive", "avgPoints") || findStatAny("PTS");
      teamStats.pointsAllowedPerGame = findStat("defensive", "avgPointsAgainst");
      teamStats.fieldGoalPct = findStat("offensive", "fieldGoalPct") || findStatAny("FG%");
      teamStats.threePointPct = findStat("offensive", "threePointPct") || findStatAny("3P%");
      teamStats.reboundsPerGame = findStatAny("avgRebounds") || findStatAny("REB");
      teamStats.assistsPerGame = findStatAny("avgAssists") || findStatAny("AST");
      teamStats.turnoversPerGame = findStatAny("avgTurnovers") || findStatAny("TO");

      if (teamStats.pointsPerGame && teamStats.pointsAllowedPerGame) {
        teamStats.pointDifferential = teamStats.pointsPerGame - teamStats.pointsAllowedPerGame;
      }
    }

    if (["nfl", "ncaaf"].includes(league.toLowerCase())) {
      teamStats.pointsPerGame = findStat("scoring", "totalPointsPerGame") || findStatAny("PTS/G");
    }

    return teamStats;
  } catch (error) {
    console.error(`[espn] Failed to fetch team stats for ${teamId}:`, error);
    return null;
  }
}

/**
 * Get recent games for a team (last N games).
 */
export async function getRecentGames(
  league: string,
  teamId: string,
  limit: number = 5,
): Promise<Array<{
  date: string;
  opponent: string;
  isHome: boolean;
  teamScore: number;
  opponentScore: number;
  result: "W" | "L" | "T";
}> | null> {
  const leagueInfo = SPORT_LEAGUES[league.toLowerCase()];
  if (!leagueInfo) return null;

  try {
    const url = `${ESPN_API}/${leagueInfo.sport}/${leagueInfo.league}/teams/${teamId}/schedule`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const events = data.events || [];

    const completedGames = events
      .filter((e: any) => e.competitions?.[0]?.status?.type?.completed)
      .slice(-limit)
      .reverse();

    return completedGames.map((event: any) => {
      const competition = event.competitions[0];
      const competitors = competition.competitors || [];
      const teamCompetitor = competitors.find((c: any) => c.id === teamId);
      const opponentCompetitor = competitors.find((c: any) => c.id !== teamId);

      const getScore = (competitor: any): number => {
        const score = competitor?.score;
        if (typeof score === "number") return score;
        if (typeof score === "string") return parseInt(score) || 0;
        if (typeof score === "object" && score !== null) {
          return score.value ?? parseInt(score.displayValue) ?? 0;
        }
        return 0;
      };

      const teamScore = getScore(teamCompetitor);
      const opponentScore = getScore(opponentCompetitor);

      let result: "W" | "L" | "T" = "T";
      if (teamScore > opponentScore) result = "W";
      else if (teamScore < opponentScore) result = "L";

      return {
        date: event.date?.split("T")[0] || "",
        opponent: opponentCompetitor?.team?.displayName || "Unknown",
        isHome: teamCompetitor?.homeAway === "home",
        teamScore,
        opponentScore,
        result,
      };
    });
  } catch (error) {
    console.error(`[espn] Failed to fetch recent games for ${teamId}:`, error);
    return null;
  }
}

/**
 * Calculate team's recent form (W-L in last N games + streak).
 */
export async function getRecentForm(
  league: string,
  teamId: string,
  games: number = 5,
): Promise<{ record: string; winPct: number; streak: string } | null> {
  const recentGames = await getRecentGames(league, teamId, games);
  if (!recentGames || recentGames.length === 0) return null;

  const wins = recentGames.filter((g) => g.result === "W").length;
  const losses = recentGames.filter((g) => g.result === "L").length;
  const ties = recentGames.filter((g) => g.result === "T").length;

  let streakCount = 1;
  const lastResult = recentGames[0]?.result;
  for (let i = 1; i < recentGames.length; i++) {
    if (recentGames[i].result === lastResult) {
      streakCount++;
    } else {
      break;
    }
  }
  const streak = `${lastResult}${streakCount}`;

  return {
    record: ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
    winPct: recentGames.length > 0 ? wins / recentGames.length : 0,
    streak,
  };
}

/**
 * Get combined team data: standings + stats + recent form.
 * Main entry point for team data enrichment.
 */
export async function getTeamFullStats(
  league: string,
  teamName: string,
): Promise<TeamFullStats | null> {
  const team = await findTeam(league, teamName);
  if (!team) return null;

  const [standing, stats, recentForm] = await Promise.all([
    getTeamRecord(league, teamName),
    getTeamStats(league, team.id),
    getRecentForm(league, team.id, 5).catch(() => null),
  ]);

  if (!standing) return null;

  return {
    team: team.name,
    teamId: team.id,
    league: league.toLowerCase(),
    wins: standing.wins,
    losses: standing.losses,
    winPct: standing.winPct,
    conferenceRank: standing.conferenceRank,
    pointsPerGame: stats?.pointsPerGame,
    pointsAllowedPerGame: stats?.pointsAllowedPerGame,
    pointDifferential: stats?.pointDifferential,
    lastFiveRecord: recentForm?.record,
    lastFiveWinPct: recentForm?.winPct,
    streak: recentForm?.streak || standing.streak,
  };
}

// ─── Text Extraction Helpers ───

/**
 * Extract league from market title text.
 */
export function extractLeagueFromQuestion(question: string | undefined | null): string | null {
  if (!question) return null;
  const lower = question.toLowerCase();

  // Direct league mentions
  if (lower.includes("nfl") || lower.includes("super bowl")) return "nfl";
  if (lower.includes("nba") || lower.includes("nba finals")) return "nba";
  if (lower.includes("mlb") || lower.includes("world series")) return "mlb";
  if (lower.includes("nhl") || lower.includes("stanley cup")) return "nhl";
  if (lower.includes("march madness") || lower.includes("ncaa basketball") || lower.includes("ncaab")) return "ncaab";

  // Team-based detection
  const nbaTeams = ["lakers", "celtics", "warriors", "heat", "nuggets", "bucks", "knicks", "thunder", "cavaliers", "suns", "mavericks", "timberwolves"];
  const nflTeams = ["chiefs", "49ers", "eagles", "bills", "cowboys", "ravens", "lions"];
  const mlbTeams = ["yankees", "dodgers", "braves", "astros", "phillies"];
  const nhlTeams = ["rangers", "panthers", "oilers", "bruins", "avalanche"];

  if (nbaTeams.some((t) => lower.includes(t))) return "nba";
  if (nflTeams.some((t) => lower.includes(t))) return "nfl";
  if (mlbTeams.some((t) => lower.includes(t))) return "mlb";
  if (nhlTeams.some((t) => lower.includes(t))) return "nhl";

  return null;
}

/**
 * Extract team names from market title.
 * Returns up to two team names for head-to-head matchups.
 */
export function extractTeamsFromTitle(title: string | undefined | null): string[] {
  if (!title) return [];
  const lower = title.toLowerCase();

  // Find teams with their position in the title so we preserve mention order
  // (first team mentioned = subject team in "Will X defeat Y?" patterns)
  // Include canonical name in search to match full team names in titles
  const found: { name: string; position: number; matchLen: number }[] = [];

  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    // Include canonical name itself, sort all longest first
    const allAliases = [canonical, ...aliases].sort((a, b) => b.length - a.length);
    for (const alias of allAliases) {
      const pos = lower.indexOf(alias);
      if (pos !== -1) {
        const shortName = canonical.split(" ").pop() || canonical;

        // Check for overlapping match at same position range — keep the longer one
        const overlapIdx = found.findIndex((f) => {
          const aStart = pos, aEnd = pos + alias.length;
          const bStart = f.position, bEnd = f.position + f.matchLen;
          return aStart < bEnd && bStart < aEnd; // ranges overlap
        });

        if (overlapIdx !== -1) {
          // Replace only if this match is longer (more specific)
          if (alias.length > found[overlapIdx].matchLen) {
            found[overlapIdx] = { name: shortName, position: pos, matchLen: alias.length };
          }
        } else if (!found.some((f) => f.name === shortName)) {
          found.push({ name: shortName, position: pos, matchLen: alias.length });
        }
        break; // Best match for this canonical entry
      }
    }
  }

  // Sort by position in title and return up to 2
  return found.sort((a, b) => a.position - b.position).slice(0, 2).map((f) => f.name);
}
