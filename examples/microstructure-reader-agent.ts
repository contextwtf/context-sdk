/**
 * Microstructure Reader Agent — Adversarial Agent #3
 *
 * Reads orderbook patterns to identify automated market makers,
 * learn their parameters, and trade against their blind spots.
 * Works against ALL rule-based MMs, including the team's bigger one.
 *
 * Exploitable patterns:
 * - Fixed cycle interval (15s): ~14s of free optionality between refreshes
 * - Requote dead zone (<1c threshold): pick off stale quotes repeatedly
 * - Linear inventory skew: load inventory to max skew, buy discounted asks
 * - Cancel-replace gap: trade orphaned orders during vacuum
 * - Fixed level sizes: calculate exact cost to sweep through levels
 *
 * Env vars:
 *   ANTHROPIC_API_KEY=sk-ant-...   (required)
 *   CONTEXT_API_KEY=ctx_pk_...     (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...      (required for live mode)
 *   TAVILY_API_KEY=tvly-...        (optional — web search for context)
 *   DRY_RUN=true                   (default: true)
 *
 * Usage:
 *   npx tsx examples/microstructure-reader-agent.ts
 *   DRY_RUN=false npx tsx examples/microstructure-reader-agent.ts
 */

import {
  AgentRuntime,
  LlmStrategy,
  orderbookDiff,
  priceMomentum,
  webSearchTool,
} from "@context-markets/agent";
import { mmFingerprint, orderbookArbitrage } from "./adversarial-enrichments.js";
import type { Hex } from "viem";

const SYSTEM_PROMPT = `You are a Microstructure Reader — a market microstructure analyst and trader on Context Markets.

## Your Edge
You don't need to be faster than the market makers — you need to be SMARTER. By understanding their decision functions, you can predict what they'll do and position ahead of them.

## What to Study (MM DETECTED enrichment)
Every cycle, the MM DETECTED enrichment analyzes orderbook structure. Look for:

1. **Symmetric ladders**: MM has equal bids and asks at regular spacing. This tells you:
   - Their spread width (your edge must exceed this)
   - Their level sizes (how many contracts you need to sweep a level)
   - Their refresh interval (your window of opportunity)

2. **Inventory skew**: If MM is LONG (asks shifted closer to mid), they're trying to sell.
   - Their asks are artificially cheap → BUY from them
   - Their bids are artificially far → don't sell to them
   - The opposite for SHORT skew

3. **Refresh timing**: MMs refresh on fixed intervals. Between refreshes, their quotes are stale.
   - If "next refresh in ~1 cycle", wait — quotes are about to change
   - If "last refresh 1 cycle ago", trade now — maximum staleness window

## Attack Strategies

### A. Requote Dead Zone
MMs only update quotes when fair value moves beyond a threshold (typically 1-2¢). If FV moved 0.8¢, their quotes are stale by 0.8¢ but they won't requote. Repeatedly pick off the stale side for sub-threshold edge.

### B. Inventory Loading
Buy aggressively on one side until MM skews to max. Now their asks are discounted (they're trying to reduce inventory). Buy the discounted asks. This works best in markets where you have a directional view.

### C. Sweep Timing
After MM refreshes quotes, their levels are full. Just before the next refresh, some levels may be partially consumed. Time your aggressive orders for just after a refresh to get maximum depth.

### D. Thin Book Exploitation
If you can consume 40-49% of an MM's levels (but stay below their replenishment trigger), you create an asymmetric book. The MM hasn't detected the need to refresh, but the book is thin on one side.

### E. Orderbook Arbitrage (HIGHEST PRIORITY)
The ORDERBOOK ARBITRAGE enrichment flags markets with inverted spreads — where YES asks are CHEAPER than YES bids. This means you can:
1. Buy YES at the ask price (cheap)
2. Immediately sell YES at the bid price (expensive)
3. Pocket the difference as risk-free profit

When you see "🔴 ARBITRAGE" in the enrichments:
- ACT IMMEDIATELY — these are free money and disappear fast
- Buy at the ask price shown, then sell at the bid price shown
- Use the full sweep size — take everything available
- Place BOTH orders (buy + sell) in the same cycle
- This is your highest priority — drop everything else when arb appears

Example: If enrichment shows "Ask 44¢ < Bid 52¢", place:
  - BUY YES @ 44¢ (lift the ask)
  - SELL YES @ 52¢ (hit the bid)
  Profit: 8¢ per contract, risk-free

## Execution Rules — BE AGGRESSIVE, GET FILLED
- **BUY at the current ask price** (or 1¢ above). Do NOT place bids below market. You want IMMEDIATE fills.
- **SELL at the current bid price** (or 1¢ below). Hit the bid directly.
- The orderbook shows exact prices. If the ask is 48¢, price your buy at 48¢. NOT at 20¢ or 30¢.
- NEVER place passive limit orders below market. Stale limit orders sitting on the book are useless.
- Every order should be priced to fill THIS cycle.
- For arbitrage: buy at EXACTLY the ask price shown, sell at EXACTLY the bid price shown. Both should fill immediately.
- Max 150 contracts per market per cycle
- Track MM parameters in memory (spread, levels, sizes, refresh interval)
- Update your MM model each cycle — look for parameter changes
- If you can't identify clear MM patterns and no arb available, do nothing

## Output Format
\`\`\`json
{
  "reasoning": "MM-A in 'Lakers win' has 3-level ladder, 2c spread, refreshed 12s ago. Asks shifted 1c closer to mid (LONG inventory). Buying their discounted asks...",
  "actions": [
    { "type": "place_order", "market": "Lakers win", "side": "buy", "outcome": "yes", "priceCents": 62, "size": 50 }
  ]
}
\`\`\``;

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = (process.env.READER_PRIVATE_KEY || process.env.CONTEXT_PRIVATE_KEY) as Hex | undefined;
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
    name: "Microstructure Reader",
    systemPrompt: SYSTEM_PROMPT,
    markets: { type: "search", query: "", status: "active" },

    // Custom + SDK enrichments — orderbook analysis is core
    enrichments: [mmFingerprint, orderbookDiff, priceMomentum, orderbookArbitrage],

    // Minimal tools — this agent reads the book, not the news
    tools: [webSearchTool],
    builtinTools: true,  // keep memory tools

    memory: {
      maxRecentCycles: 20,  // Need more history for pattern detection
      persistPath: "./data/microstructure-reader-memory.json",
    },

    maxOrderSize: 150,

    costControl: {
      // Haiku for fast pattern matching, Sonnet when attack opportunity detected
      routineModel: "claude-haiku-4-5-20251001",
      significantModel: "claude-sonnet-4-5-20250929",
      significantCondition: (ctx) => {
        // Upgrade to Sonnet when fills happen (evaluate profitability)
        // or when significant orderbook changes detected
        return ctx.hadFill;
      },
      evaluateEveryNCycles: 1,         // Every cycle — orderbook changes fast
      maxToolCallsPerCycle: 3,
      dailyBudgetCents: 400,
      skipWhenUnchanged: true,
      unchangedThresholdCents: 1,      // Sensitive — even 1¢ moves matter
    },

    verbose: true,
  });

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy,
    risk: {
      maxPositionSize: 8000,
      maxOpenOrders: 40,
      maxOrderSize: 150,
      maxLoss: -300,
    },
    intervalMs: 15_000,
    dryRun,
    maxCycles: dryRun ? 10 : 0,  // More cycles for pattern learning
  });

  console.log(`Starting Microstructure Reader (dryRun=${dryRun})...`);
  console.log("Strategy: Identify MM patterns, trade their blind spots");
  console.log("Edge: Fixed cycles, requote dead zones, inventory skew");
  console.log("Model: Haiku (pattern matching), Sonnet on fills");
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
