/**
 * Sentiment Agent — general-purpose LLM trader for any market type.
 *
 * Uses Claude Haiku to reason about market questions and oracle evidence,
 * then trades directionally via EdgeTradingStrategy. Unlike the sports
 * trading agent, this is NOT sports-specific — works for politics, crypto,
 * entertainment, tech, geopolitics, etc.
 *
 * No ESPN or Vegas enrichment — just the market question, description,
 * oracle evidence, and current price. Simple prompt, general reasoning.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY=sk-ant-...   (required)
 *   CONTEXT_API_KEY=ctx_pk_...     (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...      (required for live mode)
 *   DRY_RUN=false                  (default: true)
 *   MINT_AMOUNT=50                 (complete sets per market, default: 50)
 *
 * Usage:
 *   npx tsx examples/sentiment-agent.ts                    # dry run
 *   DRY_RUN=false npx tsx examples/sentiment-agent.ts      # live
 */

import {
  AgentRuntime,
  EdgeTradingStrategy,
  SentimentFairValue,
  type FairValueServiceOptions,
} from "@context-markets/agent";
import { ContextClient, ContextTrader } from "@context-markets/sdk";
import type { Hex } from "viem";

async function ensureInventory(trader: ContextTrader, targetPerMarket: number) {
  console.log(`[setup] Ensuring ${targetPerMarket} sets per active market...`);

  const client = trader as ContextClient;
  const result = await client.searchMarkets({ status: "active" });
  const markets = result.markets;

  if (markets.length === 0) {
    console.log("[setup] No active markets found");
    return;
  }

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
    if (mintAmount <= 0) continue;

    try {
      const hash = await trader.mintCompleteSets(market.id, mintAmount);
      console.log(`[setup] Minted ${mintAmount} sets for ${market.id.slice(0, 8)}... tx=${hash}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[setup] Mint failed for ${market.id.slice(0, 8)}...: ${msg}`);
    }
  }
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
    console.error("Live mode requires CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required for sentiment analysis");
    process.exit(1);
  }

  if (traderConfig && !dryRun && mintAmount > 0) {
    const trader = new ContextTrader(traderConfig);
    await ensureInventory(trader, mintAmount);
  }

  // Sentiment fair value — general-purpose LLM reasoning
  const sentimentFV = new SentimentFairValue({
    model: "claude-haiku-4-5-20251001",
    cacheTtlMs: 300_000,  // 5 min cache (non-sports markets change slowly)
  });

  // FairValueService owns caching, rate limiting, cooldowns
  const fairValueConfig: FairValueServiceOptions = {
    default: sentimentFV,
    maxConcurrentCalls: 1,
    minCallIntervalMs: 20_000,
  };

  // Edge trading strategy — trades directionally based on LLM FV
  // Provider still passed for backwards compat — strategy prefers snapshot.fairValue
  const strategy = new EdgeTradingStrategy({
    markets: { type: "search", query: "", status: "active" },
    fairValueProvider: sentimentFV,
    minEdgeCents: 5,          // Need 5¢+ edge
    minConfidence: 0.6,       // Need medium+ confidence
    maxPositionPerMarket: 500,
  });

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy,
    fairValue: fairValueConfig,
    risk: {
      maxPositionSize: 10000,
      maxOpenOrders: 200,
      maxOrderSize: 500,
      maxLoss: -200,
    },
    intervalMs: 60_000,       // 60s cycles (LLM calls are slow, non-sports don't need rapid updates)
    dryRun,
    maxCycles: dryRun ? 3 : 0,
  });

  console.log(`Starting Sentiment Agent (dryRun=${dryRun})...`);
  console.log("Strategy: LLM sentiment analysis → edge trading");
  console.log("Works for: politics, crypto, entertainment, tech, geopolitics");
  console.log("Config: minEdge=5¢, minConf=60%, cycle=60s, cache=5min");
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
