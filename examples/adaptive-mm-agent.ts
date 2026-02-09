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
import { AgentRuntime, AdaptiveMmStrategy } from "@context-markets/agent";
import type { Hex } from "viem";

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = process.env.CONTEXT_PRIVATE_KEY as Hex | undefined;
  const dryRun = process.env.DRY_RUN !== "false";

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

  const agent = new AgentRuntime({
    trader: traderConfig,
    strategy: new AdaptiveMmStrategy({
      markets: {
        type: "ids",
        ids: [
          // Will the US conduct a military strike against Iran?
          "0x100f1e5cb7b165fb65ca673e78cc875c43e24009186b2abedfb1eeb157076587",
          // Will Sam Altman post about an OpenAI Super Bowl commercial?
          "0xb5f329e05db1957d502f3a360e90a9bcfd364466720ea937a48283f10728e392",
          // Will Context Markets announce a physical grocery store?
          "0x869b848d648b2bd27fa121a4e1b9b378dc825869c1f52dd6ae02adad57442e21",
        ],
      },
      fairValueCents: 50,
      levels: 3,
      levelSpacingCents: 2,
      levelSize: 10,
      baseSpreadCents: 2,
      skewPerContract: 0.1,
      maxSkewCents: 5,
      requoteDeltaCents: 1,
      useOracleAnchor: true,
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
