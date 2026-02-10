/**
 * Sports Market Maker Agent — data-driven liquidity provider for sports markets.
 *
 * Provides bid/ask liquidity across sports markets using Vegas odds + ESPN live
 * scores. No LLM needed — purely algorithmic. Adjusts spread profile based on
 * game state and margin:
 *
 * - Pre-game: Tight spreads (2¢), concentrated liquidity
 * - In-game early (Q1-Q2): Medium spreads (4¢), standard ladder
 * - In-game late, blowout (≥15pt, Q3+): Tight spreads (2¢)
 * - In-game late, close (<8pt, Q3+): WIDE spreads (6¢), deep ladder
 * - Final: Pull all quotes (let resolution sniper handle it)
 *
 * Env vars:
 *   CONTEXT_API_KEY=ctx_pk_...     (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...      (required for live mode, falls back to AGENT_1_PRIVATE_KEY)
 *   ODDS_API_KEY=...               (optional — Vegas odds, degrades gracefully)
 *   DRY_RUN=false                  (default: true)
 *   MINT_AMOUNT=100                (complete sets per market, default: 100)
 *
 * Usage:
 *   npx tsx examples/sports-mm-agent.ts                    # dry run
 *   DRY_RUN=false npx tsx examples/sports-mm-agent.ts      # live
 */

import {
  AgentRuntime,
  SportsMmStrategy,
  VegasFairValue,
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
  const privateKey = (process.env.CONTEXT_PRIVATE_KEY || process.env.AGENT_1_PRIVATE_KEY) as Hex | undefined;
  const dryRun = process.env.DRY_RUN !== "false";
  const mintAmount = Number(process.env.MINT_AMOUNT ?? "1000");

  const traderConfig =
    apiKey && privateKey
      ? { apiKey, signer: { privateKey } as const }
      : undefined;

  if (!traderConfig && !dryRun) {
    console.error("Live mode requires CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY");
    process.exit(1);
  }

  if (traderConfig && !dryRun && mintAmount > 0) {
    const trader = new ContextTrader(traderConfig);
    await ensureInventory(trader, mintAmount);
  }

  // VegasFairValue for sports odds — shared between service and strategy
  const vegasFV = new VegasFairValue({
    closeGameMarginPts: 8,
    blowoutMarginPts: 15,
  });

  // FairValueService owns caching and rate limiting for the provider
  const fairValueConfig: FairValueServiceOptions = {
    default: vegasFV,
  };

  const strategy = new SportsMmStrategy({
    markets: { type: "search", query: "", status: "active" },
    league: ["nba", "ncaab", "nhl", "epl", "laliga", "bundesliga", "seriea", "ligue1", "ucl", "uel", "mls"],
    closeGameMarginPts: 8,
    blowoutMarginPts: 15,
    maxSkewCents: 8,
    requoteDeltaCents: 1,
    fairValueProvider: vegasFV, // Shared instance — strategy uses for gameState
  });

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy,
    fairValue: fairValueConfig,
    risk: {
      maxPositionSize: 10000,
      maxOpenOrders: 500,
      maxOrderSize: 200,
      maxLoss: -1000,
    },
    intervalMs: 15_000,       // 15s cycles for responsive quoting
    dryRun,
    maxCycles: dryRun ? 3 : 0,
  });

  console.log(`Starting Sports Market Maker (dryRun=${dryRun})...`);
  console.log("Strategy: Vegas + ESPN data-driven market making (no LLM)");
  console.log("Leagues: NBA, NCAAB, NHL, EPL, La Liga, Bundesliga, Serie A, Ligue 1, UCL, UEL, MLS");
  console.log("Config: tight pre-game, adaptive in-game, pull at final");
  if (process.env.ODDS_API_KEY) {
    console.log("Vegas odds: enabled");
  } else {
    console.log("Vegas odds: disabled (set ODDS_API_KEY to enable — degrades to midpoint FV)");
  }
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
