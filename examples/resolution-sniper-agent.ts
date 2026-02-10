/**
 * Resolution Sniper Agent — captures spread on markets near resolution.
 *
 * Scans all active markets every 30s looking for resolution signals:
 * - Sports: ESPN game status === "final" → deterministic FV
 * - Oracle: High-confidence (≥0.9) signals with clear YES/NO outcome
 * - Price: Market already at extremes (mid < 10¢ or > 90¢)
 *
 * When a market is resolved but price hasn't converged, aggressively sweeps
 * the book to push price toward 0 or 100.
 *
 * Env vars:
 *   CONTEXT_API_KEY=ctx_pk_...     (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...      (required for live mode)
 *   DRY_RUN=false                  (default: true)
 *   MINT_AMOUNT=100                (complete sets per market, default: 100)
 *
 * Usage:
 *   npx tsx examples/resolution-sniper-agent.ts                    # dry run
 *   DRY_RUN=false npx tsx examples/resolution-sniper-agent.ts      # live
 */

import {
  AgentRuntime,
  ResolutionSniperStrategy,
  ResolutionFairValue,
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

  console.log(`[setup] Found ${markets.length} active markets`);

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
      console.log(
        `[setup] Minted ${mintAmount} sets for ${market.id.slice(0, 8)}... tx=${hash}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[setup] Mint failed for ${market.id.slice(0, 8)}...: ${msg}`);
    }
  }
}

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = (process.env.AGENT_3_PRIVATE_KEY || process.env.CONTEXT_PRIVATE_KEY) as Hex | undefined;
  const dryRun = process.env.DRY_RUN !== "false";
  const mintAmount = Number(process.env.MINT_AMOUNT ?? "500");

  const traderConfig =
    apiKey && privateKey
      ? { apiKey, signer: { privateKey } as const }
      : undefined;

  if (!traderConfig && !dryRun) {
    console.error("Live mode requires CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY");
    process.exit(1);
  }

  // Mint inventory (live mode only)
  if (traderConfig && !dryRun && mintAmount > 0) {
    const trader = new ContextTrader(traderConfig);
    await ensureInventory(trader, mintAmount);
  }

  // Resolution fair value provider
  const resolutionFV = new ResolutionFairValue();

  // FairValueService owns caching, rate limiting, cooldowns
  const fairValueConfig: FairValueServiceOptions = {
    default: resolutionFV,
  };

  // Resolution sniper strategy
  // Provider still passed for backwards compat — strategy prefers snapshot.fairValue
  const strategy = new ResolutionSniperStrategy({
    markets: { type: "search", query: "", status: "active" },
    fairValueProvider: resolutionFV,
    maxOrderSize: 2000,
    minPriceGapCents: 3,
  });

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy,
    fairValue: fairValueConfig,
    risk: {
      maxPositionSize: 20000,
      maxOpenOrders: 200,
      maxOrderSize: 2000,
      maxLoss: -5000,
    },
    intervalMs: 15_000,
    dryRun,
    maxCycles: dryRun ? 3 : 0,
  });

  console.log(`Starting Resolution Sniper (dryRun=${dryRun})...`);
  console.log("Scanning all active markets for resolution signals");
  console.log("Signals: ESPN finals, high-confidence oracle, extreme prices");
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
