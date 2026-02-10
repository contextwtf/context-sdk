/**
 * Adaptive Market Maker Agent — quotes multi-level bid/ask ladders
 * on both YES and NO outcomes with per-outcome inventory skewing.
 *
 * Features:
 * - Flow-weighted fair value that moves with buy/sell flow
 * - All active markets (not hardcoded IDs)
 * - 5-level deep book
 * - Smart inventory minting (checks existing balances first)
 * - Restart resilience via .mm-state.json persistence
 *
 * Requires (for live mode):
 *   CONTEXT_API_KEY=ctx_pk_...
 *   CONTEXT_PRIVATE_KEY=0x...
 *
 * Usage:
 *   npx tsx examples/adaptive-mm-agent.ts                # dry run
 *   DRY_RUN=false npx tsx examples/adaptive-mm-agent.ts  # live
 */
import {
  AgentRuntime,
  AdaptiveMmStrategy,
  OracleFairValue,
  MidpointFairValue,
  StaticFairValue,
  ChainedFairValue,
  FlowWeightedFairValue,
} from "@context-markets/agent";
import { ContextClient, ContextTrader } from "@context-markets/sdk";
import type { Hex } from "viem";

/**
 * Smart inventory minting — checks existing token balances per market
 * and only mints the difference to reach the target amount.
 */
async function ensureInventory(trader: ContextTrader, targetPerMarket: number) {
  console.log(`[setup] Ensuring ${targetPerMarket} sets per active market...`);

  // Search for active markets
  const client = trader as ContextClient;
  const result = await client.searchMarkets({ status: "active" });
  const markets = result.markets;

  if (markets.length === 0) {
    console.log("[setup] No active markets found");
    return;
  }

  console.log(`[setup] Found ${markets.length} active markets`);

  // Check existing portfolio — API returns { portfolio: [...], marketIds, cursor }
  const rawPortfolio = await trader.getMyPortfolio() as any;
  const positions: any[] = rawPortfolio.positions ?? rawPortfolio.portfolio ?? [];
  const positionsByMarket = new Map<string, number>();

  for (const pos of positions) {
    const size = typeof pos.size === "number" ? pos.size : Number(pos.balance ?? 0) / 1e6;
    const existing = positionsByMarket.get(pos.marketId) ?? Infinity;
    // Track minimum across outcomes — complete sets need both YES and NO
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
  const mintAmount = Number(process.env.MINT_AMOUNT ?? "100");

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

  // Smart inventory minting (live mode only)
  if (traderConfig && !dryRun && mintAmount > 0) {
    const trader = new ContextTrader(traderConfig);
    await ensureInventory(trader, mintAmount);
  }

  // Chained anchor: oracle → 50¢ fallback
  // NOTE: midpoint excluded — when MM is sole liquidity provider, midpoint
  // just reads our own quotes back, creating a feedback loop.
  const anchor = new ChainedFairValue([
    new OracleFairValue(50),
    new StaticFairValue(50),
  ]);

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy: new AdaptiveMmStrategy({
      markets: { type: "search", query: "", status: "active" },
      fairValueCents: 50,
      levels: 8,
      levelSpacingCents: 2,
      levelSize: 40,
      baseSpreadCents: 2,
      skewPerContract: 0.1,
      maxSkewCents: 5,
      requoteDeltaCents: 1,
      fairValueProvider: new FlowWeightedFairValue({
        anchorProvider: anchor,
        impactCents: 0.2,
        decayRate: 0.02,
        maxDriftCents: 45,
        statePath: ".mm-state.json",
      }),
    }),
    risk: {
      maxPositionSize: 5000,
      maxOpenOrders: 500,
      maxOrderSize: 200,
      maxLoss: -500,
      maxOrdersPerMarketPerCycle: 60,
    },
    intervalMs: 15_000,
    dryRun,
    maxCycles: dryRun ? 3 : 0,
  });

  console.log(`Starting Adaptive MM (dryRun=${dryRun})...`);
  console.log("  Markets: all active (search)");
  console.log("  FV: flow-weighted with chained anchor (oracle → static)");
  console.log("  Quoting: dual-side (YES + NO), 5 levels, spacing: 2¢, size: 5");
  console.log("  State: .mm-state.json");
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
