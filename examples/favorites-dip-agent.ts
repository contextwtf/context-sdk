/**
 * Favorites Dip Agent — Buy-the-dip strategy for sports favorites.
 *
 * Buys favorites and home teams who fall behind early in games. Markets
 * overreact to early deficits — favorites tend to come back, creating a
 * mean-reversion opportunity. Tight stop loss (6¢), wide trailing stop (4¢).
 *
 * Env vars:
 *   CONTEXT_API_KEY=ctx_pk_...   (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...    (required for live mode)
 *   ODDS_API_KEY=...             (optional — Vegas odds enrichment)
 *   DRY_RUN=false                (default: true)
 *
 * Usage:
 *   npx tsx examples/favorites-dip-agent.ts                    # dry run
 *   DRY_RUN=false npx tsx examples/favorites-dip-agent.ts      # live
 */

import {
  AgentRuntime,
  FavoritesDipStrategy,
  VegasFairValue,
  type FairValueServiceOptions,
} from "@context-markets/agent";
import type { Hex } from "viem";

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = (process.env.AGENT_2_PRIVATE_KEY || process.env.CONTEXT_PRIVATE_KEY) as Hex | undefined;
  const dryRun = process.env.DRY_RUN !== "false";

  const traderConfig =
    apiKey && privateKey
      ? { apiKey, signer: { privateKey } as const }
      : undefined;

  if (!traderConfig && !dryRun) {
    console.error("Live mode requires CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY");
    process.exit(1);
  }

  // Vegas fair value provider — game state, closing odds, point diff
  const vegasFV = new VegasFairValue({
    closeGameMarginPts: 8,
    blowoutMarginPts: 15,
  });

  // Favorites dip strategy — buy favorites who fall behind early
  const strategy = new FavoritesDipStrategy({
    markets: { type: "search", query: "", status: "active" },
    league: ["nba", "ncaab", "nhl", "epl", "laliga", "bundesliga", "seriea", "ligue1", "ucl", "mls"],
    dipThresholdCents: 6,
    minFavoriteImplied: 0.50,
    includeHomeUnderdogs: true,
    entrySize: 100,
    maxPositionPerMarket: 200,
    maxConcurrentPositions: 8,
    stopLossCents: 6,
    trailingStopCents: 4,
    profitTightenThreshold: 12,
    fairValueProvider: vegasFV,
  });

  // FairValueService — caching layer (not used for entry decisions, but
  // the runtime requires it for snapshot.fairValue)
  const fairValueConfig: FairValueServiceOptions = {
    default: vegasFV,
    maxConcurrentCalls: 1,
    minCallIntervalMs: 10_000,
  };

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy,
    fairValue: fairValueConfig,
    risk: {
      maxPositionSize: 15000,
      maxOpenOrders: 100,
      maxOrderSize: 1000,
      maxLoss: -2000,
    },
    intervalMs: 15_000,
    dryRun,
    maxCycles: dryRun ? 10 : 0,
  });

  console.log(`Starting Favorites Dip Agent (dryRun=${dryRun})...`);
  console.log("Strategy: Buy favorites/home teams who fall behind early");
  console.log(
    `Config: dipThreshold=6¢, stopLoss=6¢, trailStop=4¢, ` +
    `entrySize=100, maxPos=200, maxConcurrent=8, homeUnderdogs=on`,
  );
  console.log(`Leagues: NBA, NCAAB, NHL, EPL, La Liga, Bundesliga, Serie A, Ligue 1, UCL, MLS`);
  if (process.env.ODDS_API_KEY) {
    console.log("Vegas odds: enabled");
  } else {
    console.log("Vegas odds: disabled (set ODDS_API_KEY to enable)");
  }
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
