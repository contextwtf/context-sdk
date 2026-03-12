/**
 * Batch market data — fetch quotes, orderbooks, and oracle signals for multiple markets.
 *
 * Usage:
 *   npx tsx examples/batch-markets.ts
 */
import { ContextClient } from "context-markets";

async function main() {
  const ctx = new ContextClient();

  console.log("--- Fetching active markets ---");
  const { markets } = await ctx.markets.list({ status: "active", limit: 10 });
  console.log(`Found ${markets.length} active markets\n`);

  // Fetch data for all markets in parallel
  const results = await Promise.all(
    markets.map(async (m) => {
      const [quotes, book, oracleResp] = await Promise.all([
        ctx.markets.quotes(m.id),
        ctx.markets.orderbook(m.id),
        ctx.markets.oracle(m.id),
      ]);
      return { market: m, quotes, book, oracle: oracleResp.oracle };
    }),
  );

  for (const { market, quotes, book, oracle } of results) {
    console.log(`=== ${market.question} ===`);

    // Quotes
    console.log(`  YES: bid=${quotes.yes.bid}¢ ask=${quotes.yes.ask}¢`);
    console.log(`  NO:  bid=${quotes.no.bid}¢ ask=${quotes.no.ask}¢`);

    // Spread
    if (book.bids.length > 0 && book.asks.length > 0) {
      const spread = book.asks[0].price - book.bids[0].price;
      console.log(`  Spread: ${spread.toFixed(1)}¢ (${book.bids.length} bids, ${book.asks.length} asks)`);
    } else {
      console.log("  No orderbook liquidity");
    }

    // Oracle
    if (oracle.summary) {
      console.log(`  Oracle: ${oracle.summary.decision} — ${oracle.summary.shortSummary}`);
    }

    console.log();
  }
}

main().catch(console.error);
