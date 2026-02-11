/**
 * Audit all active market order books and your open orders.
 *
 * Usage:
 *   CONTEXT_API_KEY=... CONTEXT_PRIVATE_KEY=... npx tsx examples/audit-book.ts
 */
import { ContextClient } from "@context-markets/sdk";
import type { Hex } from "viem";

async function main() {
  const ctx = new ContextClient({
    apiKey: process.env.CONTEXT_API_KEY,
    signer: process.env.CONTEXT_PRIVATE_KEY
      ? { privateKey: process.env.CONTEXT_PRIVATE_KEY as Hex }
      : undefined,
  });

  const { markets } = await ctx.markets.list({ status: "active" });

  for (const m of markets) {
    console.log(`=== ${m.question} (${m.id.slice(0, 8)}...) ===`);

    const ob = await ctx.markets.orderbook(m.id);

    console.log(
      "  Bids:",
      ob.bids.length > 0
        ? ob.bids.slice(0, 10).map((b) => `${b.price}¢ x${b.size}`).join(", ")
        : "(empty)",
    );
    console.log(
      "  Asks:",
      ob.asks.length > 0
        ? ob.asks.slice(0, 10).map((a) => `${a.price}¢ x${a.size}`).join(", ")
        : "(empty)",
    );

    if (ob.bids.length > 0 && ob.asks.length > 0 && ob.bids[0].price >= ob.asks[0].price) {
      console.log("  *** CROSSED BOOK ***");
    }

    const mid = ob.bids.length > 0 && ob.asks.length > 0
      ? ((ob.bids[0].price + ob.asks[0].price) / 2).toFixed(1)
      : "n/a";
    console.log(`  Midpoint: ${mid}¢`);
    console.log();
  }

  // Check open orders (requires signer)
  if (ctx.address) {
    const orders = await ctx.orders.mine();
    const open = orders.filter((o) => o.status === "open" || !o.status);

    console.log(`=== My Open Orders: ${open.length} total ===`);
    const byMarket = new Map<string, typeof open>();
    for (const o of open) {
      const mid = o.marketId?.slice(0, 8) || "???";
      if (!byMarket.has(mid)) byMarket.set(mid, []);
      byMarket.get(mid)!.push(o);
    }

    for (const [mid, mOrders] of byMarket) {
      console.log(`\n  ${mid}... (${mOrders.length} orders):`);
      for (const o of mOrders) {
        console.log(`    ${o.side.padEnd(4)} ${o.outcome.padEnd(3)} @ ${o.price}¢ x${o.size}`);
      }
    }
  }
}

main().catch(console.error);
