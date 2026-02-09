/**
 * Oracle Tracker Agent — buys when oracle confidence exceeds threshold.
 *
 * Requires (for live mode):
 *   CONTEXT_API_KEY=ctx_pk_...
 *   CONTEXT_PRIVATE_KEY=0x...
 *
 * Usage:
 *   npx tsx examples/oracle-tracker-agent.ts           # dry run
 *   DRY_RUN=false npx tsx examples/oracle-tracker-agent.ts  # live
 */
import { AgentRuntime, OracleTrackerStrategy } from "@context-markets/agent";
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
    strategy: new OracleTrackerStrategy({
      markets: { type: "search", query: "politics", status: "active" },
      minConfidence: 0.75,
      orderSize: 10,
      minEdgeCents: 5,
    }),
    risk: {
      maxPositionSize: 200,
      maxOpenOrders: 10,
      maxOrderSize: 50,
      maxLoss: -100,
    },
    intervalMs: 15_000,
    dryRun,
    maxCycles: dryRun ? 3 : 0, // Run 3 cycles in dry run, unlimited in live
  });

  console.log(`Starting Oracle Tracker (dryRun=${dryRun})...`);
  console.log("Press Ctrl+C to stop\n");

  await agent.start();
}

main().catch(console.error);
