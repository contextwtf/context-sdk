/**
 * LLM Tool System
 *
 * Defines the tool interface and built-in tools for LLM-powered strategies.
 * Tools are on-demand lookups the LLM can request during evaluation.
 * Market data is always in context — tools are for optional deep-dives.
 */

import type { MarketSnapshot, AgentState } from "../strategy.js";
import type { AgentMemory } from "./memory.js";
import {
  extractLeagueFromQuestion,
  extractTeamsFromTitle,
  getUpcomingGames,
  getTeamFullStats,
} from "../signals/espn.js";
import {
  fetchGameOdds,
  fetchSpreadOdds,
  fetchTotalsOdds,
} from "../signals/vegas.js";

// ─── Types ───

export interface ToolContext {
  markets: MarketSnapshot[];
  state: AgentState;
  memory: AgentMemory;
}

export interface LlmTool {
  definition: {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  };
  execute(params: Record<string, unknown>, context: ToolContext): Promise<string>;
}

// ─── Search Cache (prevents flip-flopping from inconsistent results) ───

interface CachedSearch {
  result: string;
  summary: string;
  timestamp: number;
}

/** TTL for cached search results in ms (2 minutes). */
const SEARCH_CACHE_TTL = 2 * 60 * 1000;

/**
 * Tracks recent search results to:
 * 1. Return cached results for identical queries within TTL (prevents flip-flopping)
 * 2. Detect contradictions when similar queries return conflicting answers
 */
const searchCache = new Map<string, CachedSearch>();

/** Normalize a query for cache key matching. */
function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Find a cached result for an exact or very similar query. */
function findCachedResult(query: string): CachedSearch | null {
  const now = Date.now();
  const normalized = normalizeQuery(query);

  // Exact match first
  const exact = searchCache.get(normalized);
  if (exact && now - exact.timestamp < SEARCH_CACHE_TTL) {
    return exact;
  }

  // Fuzzy match — if 80%+ of words overlap
  const queryWords = new Set(normalized.split(" "));
  for (const [key, cached] of searchCache) {
    if (now - cached.timestamp >= SEARCH_CACHE_TTL) continue;
    const keyWords = new Set(key.split(" "));
    const overlap = [...queryWords].filter((w) => keyWords.has(w)).length;
    const similarity = overlap / Math.max(queryWords.size, keyWords.size);
    if (similarity >= 0.8) return cached;
  }

  return null;
}

/** Check for contradictions between a new summary and recent cached results. */
function findContradictions(query: string, newSummary: string): string | null {
  const now = Date.now();
  const queryWords = new Set(normalizeQuery(query).split(" "));
  const contradictions: string[] = [];

  for (const [key, cached] of searchCache) {
    if (now - cached.timestamp >= SEARCH_CACHE_TTL * 3) continue; // Check wider window for contradictions
    const keyWords = new Set(key.split(" "));
    const overlap = [...queryWords].filter((w) => keyWords.has(w)).length;
    const similarity = overlap / Math.max(queryWords.size, keyWords.size);
    if (similarity < 0.5) continue; // Not related

    // Simple contradiction detection: "not yet" vs definitive claims, different numbers
    const oldLower = cached.summary.toLowerCase();
    const newLower = newSummary.toLowerCase();
    const hasNotYet = (s: string) => s.includes("not yet") || s.includes("not available") || s.includes("has not");
    const hasFinal = (s: string) => s.includes("final score") || s.includes("defeated") || s.includes("won");
    if ((hasNotYet(oldLower) && hasFinal(newLower)) || (hasFinal(oldLower) && hasNotYet(newLower))) {
      contradictions.push(
        `Previous search (${Math.round((now - cached.timestamp) / 1000)}s ago) said: "${cached.summary.slice(0, 100)}"`
      );
    }
  }

  if (contradictions.length === 0) return null;
  return `\n\n⚠️ CONTRADICTION DETECTED — previous searches for similar queries returned conflicting information:\n${contradictions.join("\n")}\nTreat this result with caution. For sports events, prefer ESPN data as ground truth.`;
}

/** Evict expired entries. */
function evictExpired(): void {
  const now = Date.now();
  const maxAge = SEARCH_CACHE_TTL * 5; // Keep contradiction history longer
  for (const [key, cached] of searchCache) {
    if (now - cached.timestamp >= maxAge) searchCache.delete(key);
  }
}

// ─── Built-in Tools ───

/** Web search via Tavily API. Requires TAVILY_API_KEY env var. */
export const webSearchTool: LlmTool = {
  definition: {
    name: "web_search",
    description:
      "Search the web for current information. Use this to verify your thesis, check recent news, or find facts about events referenced in prediction markets. Note: Results are cached for 2 minutes to ensure consistency. For sports events, ESPN data (get_espn_data) is more authoritative than web search.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
      },
      required: ["query"],
    },
  },
  async execute(params) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return "Error: TAVILY_API_KEY not set. Web search unavailable.";

    const query = params.query as string;

    // Check cache first — prevents flip-flopping from inconsistent Tavily results
    const cached = findCachedResult(query);
    if (cached) {
      return `${cached.result}\n\n(Cached result from ${Math.round((Date.now() - cached.timestamp) / 1000)}s ago)`;
    }

    evictExpired();

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: 5,
          include_answer: true,
        }),
      });

      if (!response.ok) {
        return `Search failed: ${response.status} ${response.statusText}`;
      }

      const data = await response.json();
      const parts: string[] = [];
      const summary = data.answer ?? "";

      if (summary) {
        parts.push(`Summary: ${summary}`);
        parts.push("");
      }

      const results = data.results ?? [];
      for (const result of results.slice(0, 5)) {
        parts.push(`- ${result.title}`);
        parts.push(`  ${result.content?.slice(0, 200) ?? ""}`);
        parts.push(`  Source: ${result.url}`);
      }

      let output = parts.join("\n") || "No results found.";

      // Check for contradictions with recent results
      const contradictionNote = findContradictions(query, summary);
      if (contradictionNote) {
        output += contradictionNote;
      }

      // Cache the result
      searchCache.set(normalizeQuery(query), {
        result: output.split("\n\n⚠️")[0], // Cache without contradiction note
        summary,
        timestamp: Date.now(),
      });

      return output;
    } catch (err) {
      return `Search error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** Get ESPN sports data — scores, standings, team stats. */
export const espnDataTool: LlmTool = {
  definition: {
    name: "get_espn_data",
    description:
      "Get live sports data from ESPN: today's scores, game status, and team stats. Use for sports prediction markets.",
    input_schema: {
      type: "object",
      properties: {
        league: {
          type: "string",
          description:
            "Sport league: nba, nfl, mlb, nhl, ncaab, epl, laliga, bundesliga, seriea, ligue1, ucl, uel, mls",
        },
        team: {
          type: "string",
          description: "Team name to get stats for (optional — omit for all today's games)",
        },
      },
      required: ["league"],
    },
  },
  async execute(params) {
    const league = params.league as string;
    const team = params.team as string | undefined;

    const parts: string[] = [];

    // Always get today's games
    const games = await getUpcomingGames(league);
    if (games && games.length > 0) {
      parts.push(`Today's ${league.toUpperCase()} games:`);
      for (const game of games) {
        let line = `  ${game.awayTeam} @ ${game.homeTeam}`;
        if (game.status === "in_progress") {
          line += ` — LIVE ${game.statusDetail}: ${game.awayScore}-${game.homeScore}`;
        } else if (game.status === "final") {
          line += ` — FINAL: ${game.awayScore}-${game.homeScore}`;
        } else {
          line += ` — ${game.time}`;
        }
        parts.push(line);
      }
      parts.push("");
    } else {
      parts.push(`No ${league.toUpperCase()} games found today.`);
      parts.push("");
    }

    // Team stats if requested
    if (team) {
      const stats = await getTeamFullStats(league, team);
      if (stats) {
        parts.push(`${stats.team} stats:`);
        parts.push(`  Record: ${stats.wins}-${stats.losses} (${(stats.winPct * 100).toFixed(1)}%)`);
        if (stats.conferenceRank) parts.push(`  Conference rank: #${stats.conferenceRank}`);
        if (stats.pointsPerGame) parts.push(`  PPG: ${stats.pointsPerGame.toFixed(1)}`);
        if (stats.pointsAllowedPerGame) parts.push(`  Opp PPG: ${stats.pointsAllowedPerGame.toFixed(1)}`);
        if (stats.pointDifferential) parts.push(`  Point diff: ${stats.pointDifferential > 0 ? "+" : ""}${stats.pointDifferential.toFixed(1)}`);
        if (stats.lastFiveRecord) parts.push(`  Last 5: ${stats.lastFiveRecord}`);
        if (stats.streak) parts.push(`  Streak: ${stats.streak}`);
      } else {
        parts.push(`Could not find stats for "${team}" in ${league.toUpperCase()}.`);
      }
    }

    return parts.join("\n");
  },
};

/** Get Vegas betting odds. Requires ODDS_API_KEY env var. */
export const vegasOddsTool: LlmTool = {
  definition: {
    name: "get_vegas_odds",
    description:
      "Get current Vegas betting odds for a team's game. Returns moneyline, spread, and totals with implied probabilities (vig removed).",
    input_schema: {
      type: "object",
      properties: {
        league: {
          type: "string",
          description:
            "Sport league: nba, nfl, mlb, nhl, ncaab, epl, laliga, bundesliga, seriea, ligue1, ucl, uel, mls",
        },
        team: {
          type: "string",
          description: "Team name to look up odds for",
        },
      },
      required: ["league", "team"],
    },
  },
  async execute(params) {
    const league = params.league as string;
    const team = params.team as string;
    const parts: string[] = [];

    const [gameOdds, spreadOdds, totalsOdds] = await Promise.all([
      fetchGameOdds(league, team).catch(() => null),
      fetchSpreadOdds(league, team).catch(() => null),
      fetchTotalsOdds(league, team).catch(() => null),
    ]);

    if (gameOdds) {
      parts.push(`Moneyline — ${gameOdds.event}:`);
      parts.push(`  ${gameOdds.homeTeam}: ${(gameOdds.consensus.homeImplied * 100).toFixed(1)}% (${gameOdds.consensus.homeMl > 0 ? "+" : ""}${gameOdds.consensus.homeMl})`);
      parts.push(`  ${gameOdds.awayTeam}: ${(gameOdds.consensus.awayImplied * 100).toFixed(1)}% (${gameOdds.consensus.awayMl > 0 ? "+" : ""}${gameOdds.consensus.awayMl})`);
      parts.push(`  Vig: ${gameOdds.consensus.vig.toFixed(1)}%`);
      parts.push("");
    }

    if (spreadOdds) {
      parts.push(`Spread — ${spreadOdds.event}:`);
      parts.push(`  ${team}: ${spreadOdds.spread > 0 ? "+" : ""}${spreadOdds.spread}`);
      parts.push(`  Cover implied: ${(spreadOdds.coverImplied * 100).toFixed(1)}%`);
      parts.push("");
    }

    if (totalsOdds) {
      parts.push(`Totals — ${totalsOdds.event}:`);
      parts.push(`  Line: ${totalsOdds.line}`);
      parts.push(`  Over: ${(totalsOdds.overImplied * 100).toFixed(1)}%`);
      parts.push(`  Under: ${(totalsOdds.underImplied * 100).toFixed(1)}%`);
    }

    if (parts.length === 0) {
      return `No Vegas odds found for "${team}" in ${league.toUpperCase()}. Check that ODDS_API_KEY is set and the team has an upcoming game.`;
    }

    return parts.join("\n");
  },
};

/** Read from persistent working memory. */
export const readMemoryTool: LlmTool = {
  definition: {
    name: "read_memory",
    description:
      "Read a value from your persistent working memory. Use this to recall insights, hypotheses, or notes you saved in previous cycles.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The key to read. Use 'list' to see all available keys.",
        },
      },
      required: ["key"],
    },
  },
  async execute(params, context) {
    const key = params.key as string;

    if (key === "list") {
      const keys = context.memory.listKeys();
      return keys.length > 0
        ? `Available keys: ${keys.join(", ")}`
        : "Working memory is empty.";
    }

    const value = context.memory.get(key);
    return value ?? `No value found for key "${key}".`;
  },
};

/** Write to persistent working memory. */
export const writeMemoryTool: LlmTool = {
  definition: {
    name: "write_memory",
    description:
      "Save a value to your persistent working memory. Use this to remember insights, track hypotheses, or note important observations across cycles.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The key to write (e.g., 'thesis_trump_china', 'market_note_nfp')",
        },
        value: {
          type: "string",
          description: "The value to store",
        },
      },
      required: ["key", "value"],
    },
  },
  async execute(params, context) {
    const key = params.key as string;
    const value = params.value as string;
    context.memory.set(key, value);
    return `Saved to memory: ${key}`;
  },
};

/** All built-in tools. */
export const builtinTools: LlmTool[] = [
  webSearchTool,
  espnDataTool,
  vegasOddsTool,
  readMemoryTool,
  writeMemoryTool,
];
