/**
 * Oracle Skeptic Agent — Adversarial Agent #1
 *
 * Detects when the oracle is likely wrong and trades against it.
 * Exploits the measured 17% avg divergence between Haiku oracle and
 * real-world probabilities, especially in weak categories (entertainment,
 * crypto, geopolitics).
 *
 * Edge mechanics:
 * - Missing current fact (28.3% of high-div): web search to verify, buy correct side
 * - "Already happened" blindness (23.3%): quick web search, buy resolved outcome
 * - Stale base rate (20.0%): compare oracle to actual frequency data
 * - Category weakness (25%+ divergence in entertainment/crypto/geopolitics)
 *
 * Env vars:
 *   ANTHROPIC_API_KEY=sk-ant-...   (required)
 *   CONTEXT_API_KEY=ctx_pk_...     (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...      (required for live mode — use a dedicated wallet)
 *   TAVILY_API_KEY=tvly-...        (required — web search is core to this agent)
 *   ODDS_API_KEY=...               (optional — enables Vegas cross-reference)
 *   DRY_RUN=true                   (default: true)
 *
 * Usage:
 *   npx tsx examples/oracle-skeptic-agent.ts
 *   DRY_RUN=false npx tsx examples/oracle-skeptic-agent.ts
 */

import {
  AgentRuntime,
  LlmStrategy,
  oracleEvolution,
  priceMomentum,
  webSearchTool,
  espnDataTool,
  vegasOddsTool,
} from "@context-markets/agent";
import { oracleVsMarket } from "./adversarial-enrichments.js";
import type { Hex } from "viem";

const SYSTEM_PROMPT = `You are an Oracle Skeptic — a verification trader on Context Markets.

## Your Edge
The AI oracle (Haiku) that prices these markets has a measured 17% average divergence from reality. It's especially bad at:
- Entertainment markets (25% avg divergence)
- Crypto markets (20% avg divergence)
- Geopolitics (21% avg divergence)
- Events that have already happened (23% of failures)
- Current facts like prices, scores, counts (28% of failures)

## Strategy
Every cycle, check the ORACLE vs MARKET enrichment for gaps. When you see a 5+ cent gap between oracle confidence and market price:
1. Use web_search to verify the ACTUAL current state of the event
2. If the oracle is WRONG (stale, missing info, or bad reasoning), trade against it
3. If the oracle is RIGHT but market hasn't caught up, trade with it
4. Pay special attention to weak categories — the oracle is overconfident there

## Key Signals
- **ORACLE vs MARKET gaps**: Large gaps = mispricing opportunity. Web search to determine which is right.
- **ORACLE EVOLUTION**: If oracle just changed dramatically, verify the new info with web search.
- **"Already happened" events**: If web search reveals an event has resolved, buy the correct outcome FAST.
- **Weak categories**: Entertainment, crypto, geopolitics — oracle overconfident, verify everything.

## Data Source Priority
- **ESPN data is ground truth for sports events.** If web search contradicts ESPN, trust ESPN.
- Web search can return inconsistent results — if you see contradictions, rely on ESPN/Vegas for sports.

## Trading Rules
- Max 200 contracts per market
- Only take positions where you have HIGH confidence the oracle is wrong (web search confirmed)
- Price your orders inside the spread — you want fills, not to wait
- If the oracle and web search agree, skip (no edge)
- ALWAYS web search before trading — never trust your priors alone
- Write key findings to memory (what you verified, what was wrong)

## Output Format
After your analysis, output a JSON block:
\`\`\`json
{
  "reasoning": "Oracle says X but web search confirms Y because...",
  "actions": [
    { "type": "place_order", "market": "title substring", "side": "buy", "outcome": "yes", "priceCents": 45, "size": 100 }
  ]
}
\`\`\``;

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = (process.env.SKEPTIC_PRIVATE_KEY || process.env.CONTEXT_PRIVATE_KEY) as Hex | undefined;
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

  if (!process.env.TAVILY_API_KEY) {
    console.warn("WARNING: TAVILY_API_KEY not set — web search (core to this agent) will be disabled");
  }

  const strategy = new LlmStrategy({
    name: "Oracle Skeptic",
    systemPrompt: SYSTEM_PROMPT,
    markets: { type: "search", query: "", status: "active" },

    // Custom + SDK enrichments
    enrichments: [oracleVsMarket, oracleEvolution, priceMomentum],

    // Tools — web search is critical for verification
    tools: [webSearchTool, espnDataTool, vegasOddsTool],

    memory: {
      maxRecentCycles: 15,
      persistPath: "./data/oracle-skeptic-memory.json",
    },

    maxOrderSize: 200,

    costControl: {
      // Use Sonnet for verification quality — this agent needs reasoning depth
      routineModel: "claude-sonnet-4-5-20250929",
      significantModel: "claude-sonnet-4-5-20250929",
      evaluateEveryNCycles: 3,       // Every 3 cycles (45s) — oracle staleness is slow-moving
      maxToolCallsPerCycle: 5,       // Web search is core
      dailyBudgetCents: 800,
      skipWhenUnchanged: true,
      unchangedThresholdCents: 3,
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

  console.log(`Starting Oracle Skeptic (dryRun=${dryRun})...`);
  console.log("Strategy: Verify oracle accuracy, trade against mispricing");
  console.log("Edge: 17% avg oracle divergence, especially entertainment/crypto/geopolitics");
  console.log(`Web search: ${process.env.TAVILY_API_KEY ? "ENABLED" : "DISABLED (set TAVILY_API_KEY)"}`);
  console.log(`Vegas odds: ${process.env.ODDS_API_KEY ? "ENABLED" : "DISABLED (set ODDS_API_KEY)"}`);
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
