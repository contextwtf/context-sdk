/**
 * Simple Market Maker Agent — quotes bid/ask around midpoint.
 *
 * Requires (for live mode):
 *   CONTEXT_API_KEY=ctx_pk_...
 *   CONTEXT_PRIVATE_KEY=0x...
 *
 * Usage:
 *   npx tsx examples/simple-mm-agent.ts           # dry run
 *   DRY_RUN=false npx tsx examples/simple-mm-agent.ts  # live
 */
import { AgentRuntime, SimpleMmStrategy } from "@context-markets/agent";
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
    strategy: new SimpleMmStrategy({
      markets: { type: "search", query: "crypto", status: "active" },
      halfSpreadCents: 3,
      quoteSize: 10,
      requoteDeltaCents: 2,
    }),
    risk: {
      maxPositionSize: 200,
      maxOpenOrders: 20,
      maxOrderSize: 50,
      maxLoss: -100,
      maxOrdersPerMarketPerCycle: 4,
    },
    intervalMs: 10_000,
    dryRun,
    maxCycles: dryRun ? 3 : 0,
  });

  console.log(`Starting Simple MM (dryRun=${dryRun})...`);
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
