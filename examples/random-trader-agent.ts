/**
 * Random Trader Agent — takes random trades against available liquidity.
 * Designed to test market maker adaptation by generating order flow.
 *
 * Trades across all active markets, buying against best asks.
 *
 * Usage:
 *   CONTEXT_API_KEY=... CONTEXT_PRIVATE_KEY=... npx tsx examples/random-trader-agent.ts
 */
import { ContextClient, ContextTrader } from "@context-markets/sdk";
import type { Hex } from "viem";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = process.env.CONTEXT_PRIVATE_KEY as Hex | undefined;

  if (!apiKey || !privateKey) {
    console.error("CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY required");
    process.exit(1);
  }

  const trader = new ContextTrader({
    apiKey,
    signer: { privateKey } as const,
  });

  const client = trader as ContextClient;

  console.log(`Random Trader: ${trader.address}`);
  console.log("Trading across all active markets every 8-15s...\n");

  // Refresh market list periodically
  let marketIds: string[] = [];
  let lastRefresh = 0;

  const onSignal = () => {
    console.log("\n[random-trader] Shutting down...");
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let cycle = 0;
  while (true) {
    cycle++;

    // Refresh market list every 5 minutes
    if (Date.now() - lastRefresh > 5 * 60 * 1000) {
      const result = await client.searchMarkets({ status: "active" });
      marketIds = result.markets.map((m: { id: string }) => m.id);
      lastRefresh = Date.now();
      console.log(`[random-trader] Refreshed markets: ${marketIds.length} active`);
    }

    if (marketIds.length === 0) {
      console.log(`[cycle ${cycle}] No active markets`);
      await new Promise((r) => setTimeout(r, 15_000));
      continue;
    }

    try {
      const marketId = pick(marketIds);
      const ob = await trader.getOrderbook(marketId);

      const hasAsks = ob.asks && ob.asks.length > 0;

      if (!hasAsks) {
        console.log(`[cycle ${cycle}] No asks on ${marketId.slice(0, 8)}... skipping`);
      } else {
        const bestAsk = ob.asks[0].price;
        const outcome = pick(["yes", "no"] as const);
        const size = pick([1, 2, 3]);

        console.log(
          `[cycle ${cycle}] BUY ${size} ${outcome.toUpperCase()} @ ${bestAsk}¢ on ${marketId.slice(0, 8)}...`,
        );

        await trader.placeOrder({
          marketId,
          outcome,
          side: "buy",
          priceCents: bestAsk,
          size,
        });
        console.log(`  placed`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[cycle ${cycle}] Error: ${msg}`);
    }

    const delay = 8_000 + Math.random() * 7_000;
    await new Promise((r) => setTimeout(r, delay));
  }
}

main().catch(console.error);
