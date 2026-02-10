/**
 * Sports Trading Agent — LLM-powered price corrector for sports markets.
 *
 * Uses Claude Haiku to evaluate sports prediction markets, enriched with
 * ESPN team stats and Vegas odds. Aggressively corrects mispricings by
 * sweeping the book — selling YES into overpriced bids and buying YES
 * at underpriced asks.
 *
 * Mints complete sets on startup so it has inventory to sell both sides.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY=sk-ant-...   (required)
 *   CONTEXT_API_KEY=ctx_pk_...     (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...      (required for live mode)
 *   ODDS_API_KEY=...               (optional — Vegas odds enrichment)
 *   DRY_RUN=false                  (default: true)
 *   MINT_AMOUNT=50                 (complete sets per market, default: 50)
 *
 * Usage:
 *   npx tsx examples/sports-trading-agent.ts                    # dry run
 *   DRY_RUN=false npx tsx examples/sports-trading-agent.ts      # live
 */

import {
  AgentRuntime,
  EdgeTradingStrategy,
  LlmFairValue,
} from "@context-markets/agent";
import { ContextClient, ContextTrader } from "@context-markets/sdk";
import type { Hex } from "viem";

/**
 * Mint complete sets so the trader has YES + NO tokens to sell.
 * Checks existing balances first and only mints the delta.
 */
async function ensureInventory(trader: ContextTrader, targetPerMarket: number) {
  console.log(`[setup] Ensuring ${targetPerMarket} sets per active market...`);

  const client = trader as ContextClient;
  const result = await client.searchMarkets({ status: "active" });
  const markets = result.markets;

  if (markets.length === 0) {
    console.log("[setup] No active markets found");
    return;
  }

  console.log(`[setup] Found ${markets.length} active markets`);

  // Check existing portfolio
  const rawPortfolio = await trader.getMyPortfolio() as any;
  const positions: any[] = rawPortfolio.positions ?? rawPortfolio.portfolio ?? [];
  const positionsByMarket = new Map<string, number>();

  for (const pos of positions) {
    const size = typeof pos.size === "number" ? pos.size : Number(pos.balance ?? 0) / 1e6;
    const existing = positionsByMarket.get(pos.marketId) ?? Infinity;
    positionsByMarket.set(pos.marketId, Math.min(existing, size));
  }

  for (const market of markets) {
    const existingBalance = positionsByMarket.get(market.id) ?? 0;
    const mintAmount = Math.max(0, targetPerMarket - existingBalance);

    if (mintAmount <= 0) {
      console.log(
        `[setup] ${market.id.slice(0, 8)}... already has ${existingBalance} sets, skipping`,
      );
      continue;
    }

    try {
      const hash = await trader.mintCompleteSets(market.id, mintAmount);
      console.log(
        `[setup] Minted ${mintAmount} sets for ${market.id.slice(0, 8)}... (had ${existingBalance}) tx=${hash}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[setup] Mint failed for ${market.id.slice(0, 8)}...: ${msg}`,
      );
    }
  }

  const balance = await trader.getMyBalance();
  console.log(
    `[setup] USDC balance: ${typeof balance.usdc === "number" ? balance.usdc.toFixed(2) : balance.usdc}`,
  );
}

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = process.env.CONTEXT_PRIVATE_KEY as Hex | undefined;
  const dryRun = process.env.DRY_RUN !== "false";
  const mintAmount = Number(process.env.MINT_AMOUNT ?? "50");

  const traderConfig =
    apiKey && privateKey
      ? { apiKey, signer: { privateKey } as const }
      : undefined;

  if (!traderConfig && !dryRun) {
    console.error(
      "Live mode requires CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY",
    );
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required for LLM fair value estimation");
    process.exit(1);
  }

  // Mint inventory so we have tokens to sell (live mode only)
  if (traderConfig && !dryRun && mintAmount > 0) {
    const trader = new ContextTrader(traderConfig);
    await ensureInventory(trader, mintAmount);
  }

  // LLM fair value provider — Haiku + ESPN + Vegas enrichment
  const llmFairValue = new LlmFairValue({
    model: "claude-haiku-4-5-20251001",
    cacheTtlMs: 120_000,     // 2 min cache for pre-game
    liveCacheTtlMs: 30_000,  // 30s cache for live games
    league: "nba",
  });

  // Edge trading strategy — places single large orders at FV ± minEdge
  const strategy = new EdgeTradingStrategy({
    markets: { type: "search", query: "", status: "active" },
    fairValueProvider: llmFairValue,
    minEdgeCents: 5,          // Need 5¢+ edge to trade
    minConfidence: 0.6,       // Need medium+ confidence
    maxPositionPerMarket: 2000, // Room to push price to FV
  });

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy,
    risk: {
      maxPositionSize: 15000, // Total across all markets
      maxOpenOrders: 500,
      maxOrderSize: 5000,     // No practical limit — position limits are the real cap
      maxLoss: -500,
    },
    intervalMs: 30_000,       // 30s cycles (LLM calls take time)
    dryRun,
    maxCycles: dryRun ? 3 : 0,
  });

  console.log(`Starting Sports Trading Agent (dryRun=${dryRun})...`);
  console.log("Strategy: LLM edge trading (Haiku + ESPN + Vegas)");
  console.log(`Config: minEdge=5¢, minConf=60%, maxPos=500 (single large orders)`);
  if (process.env.ODDS_API_KEY) {
    console.log("Vegas odds: enabled");
  } else {
    console.log("Vegas odds: disabled (set ODDS_API_KEY to enable)");
  }
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
