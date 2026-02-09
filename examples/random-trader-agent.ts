/**
 * Random Trader Agent — takes random trades against available liquidity.
 * Designed to test market maker adaptation by generating order flow.
 *
 * Usage:
 *   CONTEXT_API_KEY=... CONTEXT_PRIVATE_KEY=... npx tsx examples/random-trader-agent.ts
 */
import { ContextTrader } from "@context-markets/sdk";
import type { Hex } from "viem";

const MARKET_IDS = [
  // Will Context Markets announce a physical grocery store?
  "0x869b848d648b2bd27fa121a4e1b9b378dc825869c1f52dd6ae02adad57442e21",
];

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

  console.log(`Random Trader: ${trader.address}`);
  console.log("Buying against MM asks every 8-15s...\n");

  let cycle = 0;
  const running = true;

  const onSignal = () => {
    console.log("\n[random-trader] Shutting down...");
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  while (running) {
    cycle++;
    try {
      // Pick a random market
      const marketId = pick(MARKET_IDS);

      // Get the orderbook
      const ob = await trader.getOrderbook(marketId);

      const hasAsks = ob.asks && ob.asks.length > 0;

      if (!hasAsks) {
        console.log(`[cycle ${cycle}] No asks on ${marketId.slice(0, 8)}... skipping`);
      } else {
        // Buy against the best ask
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
        console.log(`  ✓ Order placed`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[cycle ${cycle}] Error: ${msg}`);
    }

    // Wait 8-15s between trades
    const delay = 8_000 + Math.random() * 7_000;
    await new Promise((r) => setTimeout(r, delay));
  }
}

main().catch(console.error);
