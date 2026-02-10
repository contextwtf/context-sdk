/**
 * LLM-Powered Trading Agent — Contrarian News Trader
 *
 * An agent where Claude IS the decision maker. The LLM receives market context,
 * enrichments (oracle evolution, price trends), and can use tools (web search,
 * ESPN, Vegas) to research before making trading decisions.
 *
 * The system prompt defines the strategy: look for overreactions to news,
 * buy dips when bad news won't materially change outcomes, sell pumps when
 * hype is already priced in.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY=sk-ant-...   (required)
 *   CONTEXT_API_KEY=ctx_pk_...     (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...      (required for live mode)
 *   TAVILY_API_KEY=tvly-...        (optional — enables web search tool)
 *   ODDS_API_KEY=...               (optional — enables Vegas odds tool)
 *   DRY_RUN=true                   (default: true)
 *
 * Usage:
 *   npx tsx examples/llm-agent.ts                    # dry run
 *   DRY_RUN=false npx tsx examples/llm-agent.ts      # live
 */

import {
  AgentRuntime,
  LlmStrategy,
  oracleEvolution,
  orderbookDiff,
  priceMomentum,
  webSearchTool,
} from "@context-markets/agent";
import type { Hex } from "viem";

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = (process.env.CONTEXT_PRIVATE_KEY || process.env.AGENT_1_PRIVATE_KEY) as Hex | undefined;
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
    console.error("ANTHROPIC_API_KEY is required for LLM strategy");
    process.exit(1);
  }

  const strategy = new LlmStrategy({
    name: "Contrarian News Trader",
    systemPrompt: `You are a contrarian prediction market trader on Context Markets.

Strategy: Look for overreactions to news. When oracle confidence moves sharply
in one direction, check whether the market price has already priced it in or
is lagging behind.

Key signals to watch:
- ORACLE EVOLUTION: If oracle confidence is trending up but market price hasn't
  moved much, the market may be underpricing the event. Buy before it catches up.
- PRICE TRENDS: If a market has moved 10+ cents with no oracle change, it may
  be an overreaction. Consider fading the move.
- ORDERBOOK CHANGES: Large new orders appearing can signal informed flow.
  Follow them cautiously.

Rules:
- Max 100 contracts per position, max 5 concurrent positions
- Only place limit orders (never market orders) — use bid/ask levels you see
- Use web_search to verify your thesis before trading on non-sports events
- Write key insights to memory so you remember next cycle
- If unsure, do nothing. Better to miss a trade than force one.
- Always explain your reasoning before outputting actions.

Output format: After your analysis, output a JSON block with your decisions:
\`\`\`json
{
  "reasoning": "Brief explanation of your thesis",
  "actions": [
    { "type": "place_order", "market": "title substring", "side": "buy", "outcome": "yes", "priceCents": 33, "size": 50 },
    { "type": "cancel_order", "nonce": "0x..." },
    { "type": "no_action", "reason": "nothing interesting" }
  ]
}
\`\`\``,

    markets: { type: "search", query: "", status: "active" },

    enrichments: [oracleEvolution, orderbookDiff, priceMomentum],
    tools: [webSearchTool],

    memory: {
      maxRecentCycles: 10,
      persistPath: "./data/contrarian-memory.json",
    },

    costControl: {
      routineModel: "claude-haiku-4-5-20251001",
      significantModel: "claude-sonnet-4-5-20250929",
      significantCondition: (ctx) => ctx.hadFill,
      evaluateEveryNCycles: 2,
      maxToolCallsPerCycle: 3,
      dailyBudgetCents: 500,
    },
  });

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy,
    risk: {
      maxPositionSize: 5000,
      maxOpenOrders: 20,
      maxOrderSize: 200,
      maxLoss: -200,
    },
    intervalMs: 15_000,
    dryRun,
    maxCycles: dryRun ? 5 : 0,
  });

  console.log(`Starting Contrarian News Trader (dryRun=${dryRun})...`);
  console.log("Strategy: LLM-powered contrarian trading (Claude makes all decisions)");
  console.log("Enrichments: oracle evolution, orderbook diff, price momentum");
  console.log(`Tools: web_search${process.env.TAVILY_API_KEY ? " (enabled)" : " (disabled — set TAVILY_API_KEY)"}, ESPN, Vegas${process.env.ODDS_API_KEY ? " (enabled)" : " (disabled — set ODDS_API_KEY)"}, memory`);
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
