/**
 * Resolution Racer Agent — Adversarial Agent #4
 *
 * Detects markets approaching resolution and trades the correct outcome
 * before the price fully converges to 0 or 100. Smarter version of the
 * rule-based ResolutionSniper — uses LLM reasoning, web verification,
 * and multi-source confirmation.
 *
 * Improvements over ResolutionSniper:
 * - Multi-source verification (oracle + web + ESPN + Vegas)
 * - Ambiguity handling (reasons about oracle interpretation)
 * - Adaptive sizing (confidence-based position sizing)
 * - Pre-resolution prediction (spots resolution before oracle signals it)
 *
 * Env vars:
 *   ANTHROPIC_API_KEY=sk-ant-...   (required)
 *   CONTEXT_API_KEY=ctx_pk_...     (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...      (required for live mode)
 *   TAVILY_API_KEY=tvly-...        (required — resolution verification)
 *   ODDS_API_KEY=...               (optional — sports resolution)
 *   DRY_RUN=true                   (default: true)
 *
 * Usage:
 *   npx tsx examples/resolution-racer-agent.ts
 *   DRY_RUN=false npx tsx examples/resolution-racer-agent.ts
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
import { resolutionProximity } from "./adversarial-enrichments.js";
import type { Hex } from "viem";

const SYSTEM_PROMPT = `You are a Resolution Racer — a pre-resolution specialist on Context Markets.

## Your Edge
Markets resolve to $1 (YES wins) or $0 (NO wins). Before resolution, prices trade between 0¢ and 100¢. As resolution approaches, the correct outcome should converge to 100¢ — but this happens slowly because:
1. MMs keep quoting spreads even when outcome is near-certain
2. Oracle updates lag real-world events
3. Traders are slow to act on available information

You buy the winning outcome BEFORE it hits 95¢+, locking in 5-50¢ of profit per contract.

## How to Spot Resolution Opportunities

### The RESOLUTION SIGNAL enrichment shows:
- Markets leaning strongly toward YES or NO
- Oracle confidence trending in one direction
- Time to deadline (urgent if close)
- Disagreements between oracle and market (opportunity!)

### Resolution patterns to exploit:
1. **Sports game ending**: Game in 4th quarter, team up by 20 → outcome near-certain but market at 85¢
2. **Event already happened**: News broke 10 min ago, oracle confirmed, but market still at 75¢
3. **Deadline approaching**: Market expires tonight, oracle says 90% YES, market at 82¢
4. **Oracle trending strongly**: Oracle went 40% → 60% → 80% over 6 cycles, market only at 72¢

## Strategy
1. Check RESOLUTION SIGNAL for markets approaching resolution
2. If oracle is strong (>75% or <25%), verify with web_search or ESPN
3. If MULTIPLE sources agree on the outcome:
   - Buy aggressively at current ask (don't wait for fills at bid)
   - Size based on confidence: 90%+ confident = 200 contracts, 80% = 100, 70% = 50
4. Watch for DISAGREEMENTS — if oracle says YES but market says NO, investigate carefully
5. Remember past resolution patterns — save to memory what worked

## Data Source Priority
- **ESPN data is ground truth for sports events.** If web search contradicts ESPN, trust ESPN.
- Web search can return inconsistent results — if you see contradictions, wait for authoritative confirmation.

## Critical Warnings
- **Ambiguous markets**: Some markets have unclear resolution criteria. Check the market description.
- **Oracle can be wrong**: Don't blindly follow the oracle. VERIFY with web search.
- **Multiple outcomes possible**: "Will X happen by DATE?" — check if X already happened
- **Early resolution**: Some markets resolve before their deadline if the outcome is clear

## Execution Rules — BE AGGRESSIVE, GET FILLED
- **BUY at the current ask price** (or 1¢ above). Do NOT place bids below market. Resolution edges disappear fast — you need IMMEDIATE fills.
- **SELL at the current bid price** (or 1¢ below). Hit the bid directly.
- The orderbook shows exact prices. If the ask is 88¢ and you want to buy the winning outcome, price at 88¢. NOT at 80¢.
- NEVER place passive limit orders below market. By the time they fill, the market has already converged.
- Every order should be priced to fill THIS cycle.

## Sizing Rules
- Near-certain resolution (3+ sources agree, >90%): up to 200 contracts
- High confidence (2+ sources, >80%): up to 100 contracts
- Moderate confidence (oracle strong, 1 verification): up to 50 contracts
- Price above 95¢: skip — not enough edge remaining
- Price below 70¢: needs strong verification before taking large position

## Output Format
\`\`\`json
{
  "reasoning": "Oracle at 92% and trending up. ESPN confirms Lakers leading 110-85 with 2 min left. Market at 87¢ — buying the 8¢ spread before resolution.",
  "actions": [
    { "type": "place_order", "market": "Lakers win", "side": "buy", "outcome": "yes", "priceCents": 90, "size": 150 }
  ]
}
\`\`\``;

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = (process.env.RACER_PRIVATE_KEY || process.env.CONTEXT_PRIVATE_KEY) as Hex | undefined;
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
    name: "Resolution Racer",
    systemPrompt: SYSTEM_PROMPT,
    markets: { type: "search", query: "", status: "active" },

    // Custom + SDK enrichments
    enrichments: [resolutionProximity, oracleEvolution, priceMomentum],

    // All verification tools
    tools: [webSearchTool, espnDataTool, vegasOddsTool],

    memory: {
      maxRecentCycles: 10,
      persistPath: "./data/resolution-racer-memory.json",
    },

    maxOrderSize: 200,

    costControl: {
      // Haiku routine scan, Sonnet when resolution opportunity detected
      routineModel: "claude-haiku-4-5-20251001",
      significantModel: "claude-sonnet-4-5-20250929",
      significantCondition: (ctx) => {
        // Upgrade to Sonnet on fills or when any market mid > 80 or < 20
        if (ctx.hadFill) return true;
        return ctx.markets.some((m) => {
          const bid = m.orderbook.bids[0]?.price ?? 0;
          const ask = m.orderbook.asks[0]?.price ?? 100;
          const mid = (bid + ask) / 2;
          return mid > 80 || mid < 20;
        });
      },
      evaluateEveryNCycles: 2,         // Every 2 cycles (30s) — resolution is time-sensitive
      maxToolCallsPerCycle: 5,         // Need multiple verifications
      dailyBudgetCents: 600,
      skipWhenUnchanged: true,
      unchangedThresholdCents: 2,
    },

    verbose: true,
  });

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy,
    risk: {
      maxPositionSize: 12000,
      maxOpenOrders: 30,
      maxOrderSize: 200,
      maxLoss: -400,
    },
    intervalMs: 15_000,
    dryRun,
    maxCycles: dryRun ? 5 : 0,
  });

  console.log(`Starting Resolution Racer (dryRun=${dryRun})...`);
  console.log("Strategy: Detect approaching resolution, buy winning outcome before convergence");
  console.log("Edge: 5-50¢ per trade on markets near resolution");
  console.log("Model: Haiku (scan), Sonnet when resolution near");
  console.log(`Web search: ${process.env.TAVILY_API_KEY ? "ENABLED" : "DISABLED"}`);
  console.log(`ESPN/Vegas: ${process.env.ODDS_API_KEY ? "ENABLED" : "DISABLED"}`);
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
