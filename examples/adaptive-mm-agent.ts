/**
 * Adaptive Market Maker Agent — quotes multi-level bid/ask ladders
 * on both YES and NO outcomes with per-outcome inventory skewing.
 *
 * Requires (for live mode):
 *   CONTEXT_API_KEY=ctx_pk_...
 *   CONTEXT_PRIVATE_KEY=0x...
 *
 * Usage:
 *   npx tsx examples/adaptive-mm-agent.ts                # dry run
 *   DRY_RUN=false npx tsx examples/adaptive-mm-agent.ts  # live
 */
import { AgentRuntime, AdaptiveMmStrategy, OracleFairValue } from "@context-markets/agent";
import { ContextTrader } from "@context-markets/sdk";
import type { Hex } from "viem";

const MARKET_IDS = [
  // Will Context Markets announce a physical grocery store?
  "0x869b848d648b2bd27fa121a4e1b9b378dc825869c1f52dd6ae02adad57442e21",
];

/** Mint complete sets so the MM has inventory for sell orders. */
async function ensureInventory(trader: ContextTrader, mintAmount: number) {
  console.log(`[setup] Minting ${mintAmount} complete sets per market...`);

  for (const marketId of MARKET_IDS) {
    try {
      const hash = await trader.mintCompleteSets(marketId, mintAmount);
      console.log(`[setup] Minted ${mintAmount} sets for ${marketId.slice(0, 8)}... tx=${hash}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[setup] Mint failed for ${marketId.slice(0, 8)}...: ${msg}`);
    }
  }

  const balance = await trader.getMyBalance();
  console.log(`[setup] USDC balance: ${(Number(balance.usdc.balance) / 1e6).toFixed(2)}`);
  if (balance.outcomeTokens.length > 0) {
    for (const t of balance.outcomeTokens) {
      console.log(`[setup]   ${t.outcomeName} (${t.marketId.slice(0, 8)}...): ${(Number(t.balance) / 1e6).toFixed(2)}`);
    }
  }
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

  // Mint inventory before starting (live mode only)
  if (traderConfig && !dryRun && mintAmount > 0) {
    const trader = new ContextTrader(traderConfig);
    await ensureInventory(trader, mintAmount);
  }

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy: new AdaptiveMmStrategy({
      markets: { type: "ids", ids: MARKET_IDS },
      fairValueCents: 50,
      levels: 1,
      levelSpacingCents: 2,
      levelSize: 5,
      baseSpreadCents: 2,
      skewPerContract: 0.1,
      maxSkewCents: 5,
      requoteDeltaCents: 1,
      fairValueProvider: new OracleFairValue(50),
    }),
    risk: {
      maxPositionSize: 200,
      maxOpenOrders: 80,
      maxOrderSize: 50,
      maxLoss: -100,
      maxOrdersPerMarketPerCycle: 20,
    },
    intervalMs: 15_000,
    dryRun,
    maxCycles: dryRun ? 3 : 0,
  });

  console.log(`Starting Adaptive MM (dryRun=${dryRun})...`);
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
