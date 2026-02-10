/**
 * General Market Maker Agent — non-sports markets
 *
 * Uses Gemini with Google Search grounding to estimate fair values for
 * any market type (politics, crypto, entertainment, tech, geopolitics).
 * Recalculates FV hourly via LLM, adjusts to order flow between recalculations.
 *
 * Requires:
 *   GEMINI_API_KEY=...
 *   CONTEXT_API_KEY=ctx_pk_...
 *   CONTEXT_PRIVATE_KEY=0x...
 *
 * Usage:
 *   npx tsx examples/general-mm-agent.ts                # dry run
 *   DRY_RUN=false npx tsx examples/general-mm-agent.ts  # live
 */
import {
  AgentRuntime,
  AdaptiveMmStrategy,
  GeminiFairValue,
  extractLeagueFromQuestion,
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
    // Skip sports markets — the general MM only prices non-sports
    const title = (market as any).title || (market as any).question || "";
    if (extractLeagueFromQuestion(title)) {
      console.log(`[setup] SKIP sports: ${title.slice(0, 50)}...`);
      continue;
    }

    const existingBalance = positionsByMarket.get(market.id) ?? 0;
    const mintNeeded = Math.max(0, targetPerMarket - existingBalance);
    if (mintNeeded <= 0) continue;

    try {
      const hash = await trader.mintCompleteSets(market.id, mintNeeded);
      console.log(`[setup] Minted ${mintNeeded} sets for ${title.slice(0, 50)}... tx=${hash}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[setup] Mint failed for ${title.slice(0, 50)}...: ${msg}`);
    }
  }
}

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = (process.env.MM_PRIVATE_KEY || process.env.CONTEXT_PRIVATE_KEY) as Hex | undefined;
  const dryRun = process.env.DRY_RUN !== "false";
  const mintAmount = Number(process.env.MINT_AMOUNT ?? "2000");

  const traderConfig =
    apiKey && privateKey
      ? { apiKey, signer: { privateKey } as const }
      : undefined;

  if (!traderConfig && !dryRun) {
    console.error("Live mode requires CONTEXT_API_KEY and MM_PRIVATE_KEY");
    process.exit(1);
  }

  // Mint inventory before starting live
  if (traderConfig && !dryRun && mintAmount > 0) {
    const trader = new ContextTrader(traderConfig);
    await ensureInventory(trader, mintAmount);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is required for Gemini-based fair value estimation");
    process.exit(1);
  }

  const gemini = new GeminiFairValue({
    // Recalculate FV via Gemini every hour
    recalcIntervalMs: 60 * 60 * 1000,
  });

  // FairValueService owns caching, rate limiting, cooldowns, and flow tracking.
  // The provider (Gemini) is now just prompt + API call — the service handles the rest.
  const fairValueConfig: FairValueServiceOptions = {
    default: gemini,
    maxConcurrentCalls: 1,
    minCallIntervalMs: 20_000,
    flow: {
      impactPerContract: 0.02,
      maxDriftCents: 8,
      llmWeightOnRecalc: 0.7,
    },
    cooldown: {
      baseMs: 5 * 60 * 1000,
      maxMs: 30 * 60 * 1000,
    },
  };

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy: new AdaptiveMmStrategy({
      markets: { type: "search", query: "", status: "active" },
      fairValueCents: 50, // Fallback only — service-computed FV takes precedence
      levels: 5,
      levelSpacingCents: 2,
      levelSize: 15,
      baseSpreadCents: 3,
      skewPerContract: 0.1,
      maxSkewCents: 5,
      requoteDeltaCents: 1,
      minConfidence: 0.3, // Skip sports markets (confidence=0) and low-quality estimates
      fairValueProvider: gemini, // Still passed for backwards compat — Phase 2 will prefer snapshot.fairValue
    }),
    fairValue: fairValueConfig,
    risk: {
      maxPositionSize: 10000,
      maxOpenOrders: 500,
      maxOrderSize: 200,
      maxLoss: -1000,
      maxOrdersPerMarketPerCycle: 40,
    },
    intervalMs: 30_000, // 30s cycles (FV is cached, only re-fetched hourly)
    dryRun,
    maxCycles: dryRun ? 3 : 0,
  });

  console.log(`Starting General MM (dryRun=${dryRun})...`);
  console.log("  FV: Gemini with Google Search grounding (hourly recalc)");
  console.log("  FV Service: caching, rate limiting, cooldowns, flow tracking");
  console.log("  Flow: ±0.02¢/contract, max ±8¢ drift, 70/30 blend on recalc");
  console.log("  Quoting: dual-side (YES + NO), 5 levels, spread: 3¢, size: 15");
  console.log("  Sports markets: skipped (use sports-mm-agent instead)");
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
