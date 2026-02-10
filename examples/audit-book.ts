/**
 * Audit all active market order books and MM open orders.
 * Usage: CONTEXT_API_KEY=... CONTEXT_PRIVATE_KEY=... npx tsx examples/audit-book.ts
 */
import { ContextClient, ContextTrader } from "@context-markets/sdk";
import type { Hex } from "viem";

async function main() {
  const c = new ContextClient();
  const t = new ContextTrader({
    apiKey: process.env.CONTEXT_API_KEY as string,
    signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY as Hex },
  });

  const markets = await c.searchMarkets({ status: "active" });

  for (const m of markets.markets) {
    const title = (m as any).title || (m as any).question || "?";
    console.log(`=== ${title} (${m.id.slice(0, 8)}...) ===`);

    const ob = await c.getOrderbook(m.id);
    const bids: any[] = (ob as any).bids || [];
    const asks: any[] = (ob as any).asks || [];

    console.log(
      "  Bids:",
      bids.length > 0
        ? bids.slice(0, 10).map((b) => `${b.price}¢ x${b.size}`).join(", ")
        : "(empty)",
    );
    console.log(
      "  Asks:",
      asks.length > 0
        ? asks.slice(0, 10).map((a) => `${a.price}¢ x${a.size}`).join(", ")
        : "(empty)",
    );

    if (bids.length > 0 && asks.length > 0 && bids[0].price >= asks[0].price) {
      console.log("  *** CROSSED BOOK ***");
    }

    const mid = bids.length > 0 && asks.length > 0
      ? ((bids[0].price + asks[0].price) / 2).toFixed(1)
      : "n/a";
    console.log(`  Midpoint: ${mid}¢`);
    console.log();
  }

  // Check MM open orders
  const raw = await t.getMyOrders();
  const orders: any[] = Array.isArray(raw) ? raw : (raw as any).orders ?? [];
  const open = orders.filter((o) => o.status === "open" || !o.status);

  console.log(`=== MM Open Orders: ${open.length} total ===`);
  const byMarket = new Map<string, any[]>();
  for (const o of open) {
    const mid = o.marketId?.slice(0, 8) || "???";
    if (!byMarket.has(mid)) byMarket.set(mid, []);
    byMarket.get(mid)?.push(o);
  }

  for (const [mid, mOrders] of byMarket) {
    console.log(`\n  ${mid}... (${mOrders.length} orders):`);
    for (const o of mOrders) {
      const outcome = o.outcome || (o.outcomeIndex === 0 ? "no" : "yes");
      const side = typeof o.side === "string" ? o.side : o.side === 0 ? "buy" : "sell";
      const price = typeof o.price === "number" ? o.price : Number(o.price);
      const size = typeof o.size === "number" ? o.size : Number(o.size) / 1e6;
      console.log(`    ${side.padEnd(4)} ${outcome.padEnd(3)} @ ${price}¢ x${size}`);
    }
  }
}

main().catch(console.error);
