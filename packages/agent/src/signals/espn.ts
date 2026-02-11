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
  // Soccer
  mls: { sport: "soccer", league: "usa.1" },
  epl: { sport: "soccer", league: "eng.1" },
  laliga: { sport: "soccer", league: "esp.1" },
  bundesliga: { sport: "soccer", league: "ger.1" },
  seriea: { sport: "soccer", league: "ita.1" },
  ligue1: { sport: "soccer", league: "fra.1" },
  championship: { sport: "soccer", league: "eng.2" },
  ucl: { sport: "soccer", league: "uefa.champions" },
  uel: { sport: "soccer", league: "uefa.europa" },
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

/**
 * NCAAB team aliases. Separate from pro teams to avoid ambiguity
 * (e.g., "Miami" = Heat in NBA, Hurricanes in NCAAB).
 * Keys should match The Odds API naming (longest form of school name).
 * Values are aliases found in market titles.
 */
export const NCAAB_TEAM_ALIASES: Record<string, string[]> = {
  // ACC
  "north carolina": ["tar heels", "unc"],
  "duke": ["blue devils"],
  "virginia": ["cavaliers", "uva"],
  "florida state": ["florida st", "seminoles", "fsu"],
  "clemson": ["tigers"],
  "notre dame": ["fighting irish"],
  "pittsburgh": ["pitt", "panthers"],
  "syracuse": ["orange", "cuse"],
  "louisville": ["cardinals"],
  "wake forest": ["demon deacons"],
  "nc state": ["wolfpack"],
  "georgia tech": ["yellow jackets"],
  "boston college": ["eagles"],
  "smu": ["mustangs"],
  "stanford": ["cardinal"],
  "california": ["cal", "golden bears"],
  "miami": ["hurricanes", "miami (fl)"],
  "virginia tech": ["hokies"],
  // SEC
  "alabama": ["crimson tide", "bama"],
  "auburn": ["tigers"],
  "kentucky": ["wildcats", "uk"],
  "tennessee": ["volunteers", "vols"],
  "arkansas": ["razorbacks", "hogs"],
  "lsu": ["tigers"],
  "florida": ["gators"],
  "georgia": ["bulldogs", "uga"],
  "ole miss": ["rebels", "mississippi"],
  "mississippi state": ["bulldogs", "miss state", "miss st"],
  "texas a&m": ["aggies", "tamu"],
  "south carolina": ["gamecocks"],
  "missouri": ["mizzou", "tigers"],
  "vanderbilt": ["commodores", "vandy"],
  "texas": ["longhorns"],
  "oklahoma": ["sooners"],
  // Big Ten
  "purdue": ["boilermakers"],
  "illinois": ["fighting illini", "illini"],
  "michigan state": ["spartans", "msu"],
  "michigan": ["wolverines"],
  "indiana": ["hoosiers"],
  "iowa": ["hawkeyes"],
  "wisconsin": ["badgers"],
  "ohio state": ["buckeyes", "osu"],
  "maryland": ["terrapins", "terps"],
  "minnesota": ["golden gophers", "gophers"],
  "nebraska": ["cornhuskers", "huskers"],
  "northwestern": ["wildcats"],
  "penn state": ["nittany lions"],
  "rutgers": ["scarlet knights"],
  "usc": ["trojans"],
  "ucla": ["bruins"],
  "oregon": ["ducks"],
  // Big 12
  "kansas": ["jayhawks", "ku"],
  "baylor": ["bears"],
  "houston": ["cougars"],
  "iowa state": ["cyclones"],
  "kansas state": ["k-state", "wildcats"],
  "tcu": ["horned frogs"],
  "texas tech": ["red raiders"],
  "oklahoma state": ["oklahoma st", "cowboys"],
  "byu": ["cougars", "brigham young"],
  "cincinnati": ["bearcats"],
  "ucf": ["knights"],
  "west virginia": ["mountaineers", "wvu"],
  "colorado": ["buffaloes", "buffs"],
  "arizona": ["wildcats"],
  "arizona state": ["sun devils", "asu"],
  "utah": ["utes"],
  // Big East
  "uconn": ["huskies", "connecticut"],
  "marquette": ["golden eagles"],
  "creighton": ["bluejays"],
  "villanova": ["wildcats", "nova"],
  "xavier": ["musketeers"],
  "st. john's": ["red storm", "st john's", "saint john's"],
  "seton hall": ["pirates"],
  "butler": ["bulldogs"],
  "georgetown": ["hoyas"],
  "providence": ["friars"],
  "depaul": ["blue demons"],
  // Notable others
  "gonzaga": ["bulldogs", "zags"],
  "san diego state": ["aztecs", "sdsu"],
  "memphis": ["tigers"],
  "dayton": ["flyers"],
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
    // Use US Eastern time for the date — most sports games happen in US evenings,
    // so UTC date rolls over mid-game (e.g., 7 PM EST = midnight UTC next day).
    // Query both Eastern "today" and the UTC date to catch games on both.
    const now = new Date();
    const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const easternDate = `${eastern.getFullYear()}${String(eastern.getMonth() + 1).padStart(2, "0")}${String(eastern.getDate()).padStart(2, "0")}`;
    const utcDate = now.toISOString().slice(0, 10).replace(/-/g, "");

    // Fetch both dates if they differ (evening games after UTC midnight)
    const datesToQuery = [easternDate];
    if (utcDate !== easternDate) datesToQuery.push(utcDate);

    const games: UpcomingGame[] = [];
    const seenGameIds = new Set<string>();

    for (const dateStr of datesToQuery) {
    const url = `${ESPN_API}/${leagueInfo.sport}/${leagueInfo.league}/scoreboard?dates=${dateStr}`;
    const response = await fetch(url);
    if (!response.ok) continue;

    const data = await response.json();
    const events = data.events || [];

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

      if (!seenGameIds.has(game.gameId)) {
        seenGameIds.add(game.gameId);
        games.push(game);
      }
    }
    } // end datesToQuery loop

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
  if (lower.includes("march madness") || lower.includes("ncaa basketball") || lower.includes("ncaab") || lower.includes("college basketball")) return "ncaab";

  // Soccer league mentions
  if (lower.includes("premier league") || lower.includes("epl")) return "epl";
  if (lower.includes("la liga") || lower.includes("laliga")) return "laliga";
  if (lower.includes("bundesliga")) return "bundesliga";
  if (lower.includes("serie a")) return "seriea";
  if (lower.includes("ligue 1")) return "ligue1";
  if (lower.includes("champions league") || lower.includes("ucl")) return "ucl";
  if (lower.includes("europa league") || lower.includes("uel")) return "uel";
  if (lower.includes("mls") || lower.includes("major league soccer")) return "mls";
  if (lower.includes("championship") && lower.includes("english")) return "championship";

  // Team-based detection (all 30 teams per league)
  const nbaTeams = [
    "lakers", "celtics", "warriors", "heat", "nuggets", "bucks", "knicks", "thunder",
    "cavaliers", "cavs", "suns", "mavericks", "mavs", "timberwolves", "wolves",
    "rockets", "clippers", "spurs", "pacers", "pistons", "hornets", "nets",
    "bulls", "jazz", "76ers", "sixers", "kings", "pelicans", "grizzlies",
    "trail blazers", "blazers", "hawks", "wizards", "raptors", "magic",
  ];
  const nflTeams = [
    "chiefs", "49ers", "niners", "eagles", "bills", "cowboys", "ravens", "lions",
    "dolphins", "jets", "patriots", "steelers", "bengals", "browns", "texans",
    "colts", "jaguars", "titans", "broncos", "chargers", "raiders", "seahawks",
    "cardinals", "rams", "falcons", "panthers", "saints", "buccaneers", "bucs",
    "packers", "bears", "vikings", "commanders",
  ];
  const mlbTeams = [
    "yankees", "dodgers", "braves", "astros", "phillies", "mets", "cubs",
    "red sox", "padres", "guardians", "orioles", "twins", "mariners", "rays",
    "blue jays", "brewers", "diamondbacks", "d-backs", "giants", "cardinals",
    "reds", "pirates", "royals", "tigers", "white sox", "rockies", "angels",
    "athletics", "nationals", "marlins",
  ];
  const nhlTeams = [
    "rangers", "panthers", "oilers", "bruins", "avalanche", "maple leafs", "leafs",
    "canadiens", "habs", "red wings", "blackhawks", "penguins", "flyers",
    "capitals", "caps", "lightning", "hurricanes", "canes", "blues", "stars",
    "flames", "canucks", "senators", "sens", "jets", "predators", "preds",
    "sharks", "ducks", "wild", "kraken", "golden knights", "knights",
    "islanders", "devils", "sabres", "blue jackets",
  ];
  // EPL teams (all 20)
  const eplTeams = [
    "arsenal", "aston villa", "bournemouth", "brentford", "brighton",
    "chelsea", "crystal palace", "everton", "fulham", "ipswich",
    "leicester", "liverpool", "manchester city", "man city", "manchester united", "man utd", "man united",
    "newcastle", "nottingham forest", "southampton", "tottenham", "spurs",
    "west ham", "wolverhampton", "wolves",
  ];
  // La Liga teams (top clubs)
  const laligaTeams = [
    "real madrid", "barcelona", "atletico madrid", "atletico",
    "real sociedad", "athletic bilbao", "villarreal", "real betis",
    "sevilla", "valencia", "getafe", "celta vigo", "girona",
    "mallorca", "las palmas", "osasuna", "alaves", "rayo vallecano",
  ];
  // Bundesliga teams (top clubs)
  const bundesligaTeams = [
    "bayern munich", "bayern", "borussia dortmund", "dortmund", "bayer leverkusen", "leverkusen",
    "rb leipzig", "leipzig", "eintracht frankfurt", "frankfurt",
    "wolfsburg", "freiburg", "hoffenheim", "stuttgart", "union berlin",
    "werder bremen", "augsburg", "mainz", "monchengladbach", "gladbach",
  ];
  // Serie A teams (top clubs)
  const serieaTeams = [
    "juventus", "juve", "inter milan", "inter", "ac milan", "milan",
    "napoli", "roma", "lazio", "atalanta", "fiorentina",
    "torino", "bologna", "sassuolo", "monza", "udinese", "lecce",
  ];
  // Ligue 1 teams (top clubs)
  const ligue1Teams = [
    "psg", "paris saint-germain", "marseille", "lyon", "monaco",
    "lille", "nice", "lens", "rennes", "strasbourg",
  ];

  // NCAAB teams — school names from all major conferences.
  // Uses school names (not mascots) since market titles say "Will Purdue defeat Nebraska?"
  const ncaabTeams = [
    // SEC
    "alabama", "arkansas", "auburn", "florida", "gators",
    "georgia", "kentucky", "lsu",
    "mississippi state", "ole miss", "missouri", "mizzou",
    "oklahoma", "south carolina", "tennessee",
    "texas a&m", "texas", "vanderbilt",
    // Big Ten
    "illinois", "indiana", "iowa", "maryland",
    "michigan state", "michigan", "minnesota", "nebraska",
    "northwestern", "ohio state", "oregon",
    "penn state", "purdue", "rutgers",
    "ucla", "usc", "wisconsin",
    // Big 12
    "arizona state", "arizona", "baylor", "byu", "brigham young",
    "cincinnati", "colorado", "houston",
    "iowa state", "kansas state", "kansas", "oklahoma state",
    "tcu", "texas tech", "ucf", "utah", "west virginia",
    // ACC
    "boston college", "clemson", "duke", "florida state",
    "georgia tech", "louisville", "nc state", "north carolina",
    "notre dame", "pittsburgh", "pitt", "smu", "stanford",
    "syracuse", "virginia tech", "virginia", "wake forest",
    "california", "cal berkeley",
    // Big East
    "butler", "uconn", "connecticut", "creighton", "depaul",
    "georgetown", "marquette", "providence", "seton hall",
    "st. john's", "villanova", "xavier",
    // Notable mid-majors
    "gonzaga", "memphis", "san diego state", "dayton",
    "saint mary's", "wichita state", "boise state",
  ];

  if (nbaTeams.some((t) => lower.includes(t))) return "nba";
  if (nflTeams.some((t) => lower.includes(t))) return "nfl";
  if (mlbTeams.some((t) => lower.includes(t))) return "mlb";
  if (nhlTeams.some((t) => lower.includes(t))) return "nhl";
  // NCAAB before soccer — school names are distinctive enough, and pro team checks above
  // catch any mascot conflicts (e.g. "bears" → NFL, "bruins" → NHL)
  if (ncaabTeams.some((t) => lower.includes(t))) return "ncaab";
  // Soccer team detection — check before generic "soccer" / "football" keywords
  if (eplTeams.some((t) => lower.includes(t))) return "epl";
  if (laligaTeams.some((t) => lower.includes(t))) return "laliga";
  if (bundesligaTeams.some((t) => lower.includes(t))) return "bundesliga";
  if (serieaTeams.some((t) => lower.includes(t))) return "seriea";
  if (ligue1Teams.some((t) => lower.includes(t))) return "ligue1";

  return null;
}

/**
 * Search an alias dictionary for team names in a lowercased title string.
 * @param useCanonicalAsName — if true, return the canonical key itself as the name
 *   (useful for NCAAB where keys are school names like "north carolina").
 *   If false, use the last word of the canonical name (e.g., "miami heat" → "Heat").
 */
function searchAliasDict(
  dict: Record<string, string[]>,
  lower: string,
  useCanonicalAsName: boolean,
): { name: string; position: number; matchLen: number }[] {
  const found: { name: string; position: number; matchLen: number }[] = [];

  for (const [canonical, aliases] of Object.entries(dict)) {
    const allAliases = [canonical, ...aliases].sort((a, b) => b.length - a.length);
    for (const alias of allAliases) {
      const pos = lower.indexOf(alias);
      if (pos !== -1) {
        const name = useCanonicalAsName
          ? canonical
          : (canonical.split(" ").pop() || canonical);

        const overlapIdx = found.findIndex((f) => {
          const aStart = pos, aEnd = pos + alias.length;
          const bStart = f.position, bEnd = f.position + f.matchLen;
          return aStart < bEnd && bStart < aEnd;
        });

        if (overlapIdx !== -1) {
          if (alias.length > found[overlapIdx].matchLen) {
            found[overlapIdx] = { name, position: pos, matchLen: alias.length };
          }
        } else if (!found.some((f) => f.name === name)) {
          found.push({ name, position: pos, matchLen: alias.length });
        }
        break;
      }
    }
  }

  return found;
}

/**
 * Extract team names from market title.
 * Returns up to two team names for head-to-head matchups.
 * @param league — if provided, uses league-specific aliases (e.g., NCAAB) to avoid
 *   ambiguity with pro teams (e.g., "Miami" = Heat in NBA, Hurricanes in NCAAB).
 */
export function extractTeamsFromTitle(title: string | undefined | null, league?: string | null): string[] {
  if (!title) return [];
  const lower = title.toLowerCase();

  // For NCAAB, search college aliases first to avoid pro team conflicts
  // (e.g., "Miami" = Heat in NBA, Hurricanes in NCAAB)
  if (league === "ncaab") {
    const found = searchAliasDict(NCAAB_TEAM_ALIASES, lower, /* useCanonicalAsName */ true);
    if (found.length >= 2) {
      return found.sort((a, b) => a.position - b.position).slice(0, 2).map((f) => f.name);
    }
    // Fall through to regex fallback if we didn't find 2 teams
  }

  // Find teams with their position in the title so we preserve mention order
  // (first team mentioned = subject team in "Will X defeat Y?" patterns)
  // Include canonical name in search to match full team names in titles
  const found = searchAliasDict(TEAM_ALIASES, lower, /* useCanonicalAsName */ false);

  // Sort by position in title and return up to 2
  if (found.length > 0) {
    return found.sort((a, b) => a.position - b.position).slice(0, 2).map((f) => f.name);
  }

  // Fallback: parse "Will X defeat Y?" pattern for unrecognized teams (e.g. college)
  const defeatMatch = lower.match(/will (?:the )?(.+?) defeat (?:the )?(.+?)(?:\s+in\b|\s+tonight|\?|$)/);
  if (defeatMatch) {
    return [defeatMatch[1].trim(), defeatMatch[2].trim()];
  }

  // Fallback: parse "Will X cover ... against Y?" pattern for spread markets
  const coverMatchWithOpponent = lower.match(/will (?:the )?(.+?) cover .+?(?:against|vs\.?|versus) (?:the )?(.+?)(?:\s+in\b|\s+tonight|\?|$)/);
  if (coverMatchWithOpponent) {
    return [coverMatchWithOpponent[1].trim(), coverMatchWithOpponent[2].trim()];
  }
  const coverMatch = lower.match(/will (?:the )?(.+?) cover/);
  if (coverMatch) {
    return [coverMatch[1].trim()];
  }

  // Fallback: totals patterns
  // "Will the X vs Y game go over/under Z?" or "Will the X and Y game go over/under Z?"
  const totalsVsMatch = lower.match(/will (?:the )?(.+?) (?:vs\.?|versus|and|&) (?:the )?(.+?) (?:game |match |total )?(?:go |combine (?:for )?)?(?:over|under)/);
  if (totalsVsMatch) {
    return [totalsVsMatch[1].trim(), totalsVsMatch[2].trim()];
  }
  // "Will there be over/under X goals in X vs Y?"
  const totalsInMatch = lower.match(/(?:in|for) (?:the )?(.+?) (?:vs\.?|versus|and|&) (?:the )?(.+?)(?:\s+game|\s+match|\?|$)/);
  if (totalsInMatch) {
    return [totalsInMatch[1].trim(), totalsInMatch[2].trim()];
  }

  return [];
}

/**
 * Extract spread value from a market title.
 * Returns the spread from the subject team's perspective, or null if not a spread market.
 *
 * Examples:
 *   "Will the Lakers cover -3.5 against the Spurs?" → -3.5
 *   "Will the Pacers cover +7 against the Knicks?" → 7
 *   "Will the Chiefs cover the spread (-6.5) against the Bills?" → -6.5
 *   "Will Arsenal defeat Chelsea?" → null (not a spread market)
 */
export function extractSpreadFromTitle(title: string | undefined | null): number | null {
  if (!title) return null;
  const lower = title.toLowerCase();

  // Must contain "cover" or "spread" to be a spread market
  if (!lower.includes("cover") && !lower.includes("spread")) return null;

  // Match patterns: "cover -3.5", "cover +7", "cover the spread (-6.5)", "spread of -3.5"
  const patterns = [
    /cover\s+([+-]?\d+\.?\d*)/,
    /spread\s*\(?([+-]?\d+\.?\d*)\)?/,
    /([+-]\d+\.?\d*)\s*(?:point|pt)?\s*spread/,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      return parseFloat(match[1]);
    }
  }

  return null;
}

// ─── Totals Extraction ───

export interface TotalsInfo {
  /** The line (e.g. 224.5, 2.5) */
  line: number;
  /** Which side of the total this market represents */
  side: "over" | "under";
}

/**
 * Extract totals/over-under info from a market title.
 * Returns the line and side, or null if not a totals market.
 *
 * Examples:
 *   "Will the Lakers vs Spurs game go over 224.5?" → { line: 224.5, side: "over" }
 *   "Will there be under 2.5 goals in Chelsea vs Leeds?" → { line: 2.5, side: "under" }
 *   "Will the Rockets and Clippers combine for over 215.5 points?" → { line: 215.5, side: "over" }
 *   "Will the total points in Lakers vs Clippers exceed 224.5?" → { line: 224.5, side: "over" }
 *   "Will the Lakers defeat the Spurs?" → null (not a totals market)
 */
export function extractTotalsFromTitle(title: string | undefined | null): TotalsInfo | null {
  if (!title) return null;
  const lower = title.toLowerCase();

  // Exclude spread "cover" markets
  if (lower.includes("cover")) return null;

  // Must contain totals-related keyword
  const hasTotalsKeyword = lower.includes("over") || lower.includes("under") || lower.includes("total")
    || lower.includes("o/u") || lower.includes("fewer") || lower.includes("more than") || lower.includes("exceed");
  if (!hasTotalsKeyword) return null;

  // "exceed X" / "more than X" → over
  const exceedMatch = lower.match(/(?:exceed|more than|above)\s+(\d+\.?\d*)/);
  if (exceedMatch) {
    return { line: parseFloat(exceedMatch[1]), side: "over" };
  }

  // "fewer than X" / "less than X" / "stay under X" → under
  const fewerMatch = lower.match(/(?:fewer than|less than|stay under|below)\s+(\d+\.?\d*)/);
  if (fewerMatch) {
    return { line: parseFloat(fewerMatch[1]), side: "under" };
  }

  // "over X", "go over X", "combine for over X"
  const overMatch = lower.match(/over\s+(\d+\.?\d*)/);
  if (overMatch) {
    return { line: parseFloat(overMatch[1]), side: "over" };
  }

  // "under X", "go under X"
  const underMatch = lower.match(/under\s+(\d+\.?\d*)/);
  if (underMatch) {
    return { line: parseFloat(underMatch[1]), side: "under" };
  }

  // "o/u X" or "total X" — default to over
  const ouMatch = lower.match(/(?:o\/u|total)\s+(\d+\.?\d*)/);
  if (ouMatch) {
    return { line: parseFloat(ouMatch[1]), side: "over" };
  }

  return null;
}
