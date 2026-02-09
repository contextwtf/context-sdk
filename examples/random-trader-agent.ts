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
  "0x100f1e5cb7b165fb65ca673e78cc875c43e24009186b2abedfb1eeb157076587",
  "0xb5f329e05db1957d502f3a360e90a9bcfd364466720ea937a48283f10728e392",
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
  console.log("Taking random trades every 10-30s against MM quotes...\n");

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

      const hasBids = ob.bids && ob.bids.length > 0;
      const hasAsks = ob.asks && ob.asks.length > 0;

      if (!hasBids && !hasAsks) {
        console.log(`[cycle ${cycle}] No liquidity on ${marketId.slice(0, 8)}... skipping`);
      } else {
        // Randomly decide: buy (lift the ask) or sell (hit the bid)
        const wantToBuy = Math.random() > 0.5;

        if (wantToBuy && hasAsks) {
          const bestAsk = ob.asks[0];
          const outcome = pick(["yes", "no"] as const);
          const size = pick([1, 2, 3, 5]);

          console.log(
            `[cycle ${cycle}] BUY ${size} ${outcome.toUpperCase()} @ ${bestAsk.price}¢ on ${marketId.slice(0, 8)}...`,
          );

          await trader.placeOrder({
            marketId,
            outcome,
            side: "buy",
            priceCents: bestAsk.price,
            size,
          });
          console.log(`  ✓ Order placed`);
        } else if (!wantToBuy && hasBids) {
          const bestBid = ob.bids[0];
          const outcome = pick(["yes", "no"] as const);
          const size = pick([1, 2, 3, 5]);

          console.log(
            `[cycle ${cycle}] SELL ${size} ${outcome.toUpperCase()} @ ${bestBid.price}¢ on ${marketId.slice(0, 8)}...`,
          );

          await trader.placeOrder({
            marketId,
            outcome,
            side: "sell",
            priceCents: bestBid.price,
            size,
          });
          console.log(`  ✓ Order placed`);
        } else {
          console.log(`[cycle ${cycle}] No matching side, skipping`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[cycle ${cycle}] Error: ${msg}`);
    }

    // Wait 10-30s between trades
    const delay = 10_000 + Math.random() * 20_000;
    await new Promise((r) => setTimeout(r, delay));
  }
}

main().catch(console.error);
