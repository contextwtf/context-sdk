/**
 * Latency Sniper Agent — Adversarial Agent #2
 *
 * Monitors real-time data sources and trades against any MM with stale
 * fair values. Exploits the 60-minute Gemini cache, 30-second ESPN
 * cache, and 15-second MM cycle intervals.
 *
 * Key exploitable lags:
 * - GeminiFairValue: 60-minute cache TTL
 * - VegasFairValue (pre-game): 10 min cache
 * - VegasFairValue (in-game scores): 30s cache
 * - FairValueService sequential processing: 20s per market
 * - AgentRuntime cycle: 15 seconds (blind between cycles)
 *
 * Env vars:
 *   ANTHROPIC_API_KEY=sk-ant-...   (required)
 *   CONTEXT_API_KEY=ctx_pk_...     (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...      (required for live mode)
 *   TAVILY_API_KEY=tvly-...        (required — breaking news detection)
 *   ODDS_API_KEY=...               (optional — real-time Vegas lines)
 *   DRY_RUN=true                   (default: true)
 *
 * Usage:
 *   npx tsx examples/latency-sniper-agent.ts
 *   DRY_RUN=false npx tsx examples/latency-sniper-agent.ts
 */

import {
  AgentRuntime,
  LlmStrategy,
  priceMomentum,
  orderbookDiff,
  webSearchTool,
  espnDataTool,
  vegasOddsTool,
} from "@context-markets/agent";
import { newsRecency } from "./adversarial-enrichments.js";
import type { Hex } from "viem";

const SYSTEM_PROMPT = `You are a Latency Sniper — a speed trader on Context Markets.

## Your Edge
Market makers update their quotes on fixed intervals (every 15 seconds) and cache fair values for long periods (10-60 minutes). You have access to LIVE data sources that update faster. When you detect information that the MMs haven't priced in yet, trade aggressively before they update.

## Exploitable Windows
1. **Breaking news** (60 min window): GeminiFairValue caches for 60 minutes. Breaking news → web_search confirms → sweeps MM's stale quotes.
2. **Sports scores** (30s window): ESPN scores cached 30s. Use get_espn_data to detect scoring events. If a team just scored, the market should move but MM hasn't updated yet.
3. **Vegas line moves** (10 min window): Pre-game odds update every 10 min. Use get_vegas_odds to detect fresh line movements.
4. **Oracle stale** (variable window): The STALE ORACLE enrichment shows markets where oracle hasn't changed in many cycles. If you can verify a change happened, the MM is quoting off stale data.

## Strategy
1. Check STALE ORACLE enrichment — any markets with unchanged oracle for 5+ cycles?
2. Check PRICE TRENDS — any sudden moves suggesting information arriving?
3. For sports markets: get_espn_data to check LIVE scores, then get_vegas_odds for current lines
4. For news markets: web_search for breaking developments
5. If you find fresher information than the oracle has, SIZE AGGRESSIVELY — the window closes fast

## Data Source Priority
- **ESPN data is ground truth for sports events.** If web search contradicts ESPN, trust ESPN. Web search may return cached/speculative/hallucinated results.
- Web search results can be inconsistent across calls — if you see contradictions, STOP and wait for ESPN confirmation.
- Do NOT oscillate between positions based on conflicting web search results. Pick the most authoritative source and commit.

## Speed Rules
- Act FAST — you have seconds before MMs update
- Don't overthink — if live data contradicts current price by 5+¢, trade immediately
- Use market prices inside the spread to maximize fill probability
- Prefer buying at current ask or selling at current bid (crossing the spread is fine when edge > spread)
- Size big (up to 200 contracts) — latency edges are high-confidence but short-lived
- Track what you sniped in memory so you don't double-trade stale signals

## Output Format
\`\`\`json
{
  "reasoning": "ESPN shows Lakers just scored 3-pointer, market hasn't moved yet...",
  "actions": [
    { "type": "place_order", "market": "title substring", "side": "buy", "outcome": "yes", "priceCents": 65, "size": 200 }
  ]
}
\`\`\``;

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = (process.env.SNIPER_PRIVATE_KEY || process.env.CONTEXT_PRIVATE_KEY) as Hex | undefined;
  const dryRun = process.env.DRY_RUN !== "false";

  const traderConfig =
    apiKey && privateKey
      ? { apiKey, signer: { privateKey } as const }
      : undefined;

  if (!traderConfig && !dryRun) {
    console.error("Live mode requires CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required");
    process.exit(1);
  }

  const strategy = new LlmStrategy({
    name: "Latency Sniper",
    systemPrompt: SYSTEM_PROMPT,
    markets: { type: "search", query: "", status: "active" },

    // Custom + SDK enrichments
    enrichments: [newsRecency, priceMomentum, orderbookDiff],

    // All tools — speed requires checking multiple sources
    tools: [webSearchTool, espnDataTool, vegasOddsTool],

    memory: {
      maxRecentCycles: 10,
      persistPath: "./data/latency-sniper-memory.json",
    },

    maxOrderSize: 200,

    costControl: {
      // Haiku for speed — this agent needs to be FAST, not deep
      routineModel: "claude-haiku-4-5-20251001",
      // Upgrade to Sonnet when a fill happens (evaluate the result)
      significantModel: "claude-sonnet-4-5-20250929",
      significantCondition: (ctx) => ctx.hadFill,
      evaluateEveryNCycles: 1,         // EVERY cycle — latency edges are time-sensitive
      maxToolCallsPerCycle: 4,
      dailyBudgetCents: 600,
      skipWhenUnchanged: false,        // Always check — stale data can appear at any time
    },

    verbose: true,
  });

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy,
    risk: {
      maxPositionSize: 10000,
      maxOpenOrders: 30,
      maxOrderSize: 200,
      maxLoss: -500,
    },
    intervalMs: 15_000,
    dryRun,
    maxCycles: dryRun ? 5 : 0,
  });

  console.log(`Starting Latency Sniper (dryRun=${dryRun})...`);
  console.log("Strategy: Detect stale MM pricing, trade before they update");
  console.log("Edge: 30s-60min exploitable windows from cached fair values");
  console.log("Model: Haiku (speed), Sonnet on fills");
  console.log(`Web search: ${process.env.TAVILY_API_KEY ? "ENABLED" : "DISABLED"}`);
  console.log(`Vegas/ESPN: ${process.env.ODDS_API_KEY ? "ENABLED" : "DISABLED"}`);
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
