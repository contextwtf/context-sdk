/**
 * Watch markets — poll for price changes on active markets.
 *
 * Usage:
 *   npx tsx examples/watch-markets.ts
 */
import { ContextClient } from "@context-markets/sdk";

async function main() {
  const ctx = new ContextClient();
  const intervalMs = 10_000;

  console.log("Watching active markets (Ctrl+C to stop)...\n");

  const { markets } = await ctx.markets.list({ status: "active", limit: 5 });

  if (markets.length === 0) {
    console.log("No active markets found.");
    return;
  }

  console.log(`Tracking ${markets.length} markets:\n`);

  const previousPrices = new Map<string, number>();

  async function poll() {
    for (const m of markets) {
      const book = await ctx.markets.orderbook(m.id);

      if (book.bids.length > 0 && book.asks.length > 0) {
        const mid = (book.bids[0].price + book.asks[0].price) / 2;
        const prev = previousPrices.get(m.id);
        const delta = prev !== undefined ? (mid - prev).toFixed(1) : "—";
        const arrow = prev !== undefined ? (mid > prev ? "^" : mid < prev ? "v" : "=") : " ";
        const label = (m.shortQuestion || m.question).slice(0, 40).padEnd(40);

        console.log(`  ${arrow} ${label} mid=${mid.toFixed(1)}¢ (${delta})`);
        previousPrices.set(m.id, mid);
      }
    }
    console.log();
  }

  await poll();
  const timer = setInterval(poll, intervalMs);

  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("Stopped.");
    process.exit(0);
  });
}

main().catch(console.error);
