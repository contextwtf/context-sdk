/**
 * Basic read-only example — no authentication needed.
 *
 * Usage:
 *   npx tsx examples/basic-read.ts
 */
import { ContextClient } from "@context-markets/sdk";

async function main() {
  const ctx = new ContextClient();

  // Search markets
  console.log("--- Searching markets ---");
  const { markets } = await ctx.markets.list({
    status: "active",
    limit: 5,
  });
  console.log(`Found ${markets.length} markets:`);
  for (const m of markets) {
    console.log(`  [${m.resolutionStatus}] ${m.question} (${m.id.slice(0, 10)}...)`);
  }

  if (markets.length === 0) {
    console.log("No markets found.");
    return;
  }

  const market = markets[0];
  console.log(`\n--- Market: ${market.question} ---`);

  // Get quotes
  console.log("\nQuotes:");
  const quotes = await ctx.markets.quotes(market.id);
  console.log(`  YES: bid=${quotes.yes.bid}¢ ask=${quotes.yes.ask}¢ last=${quotes.yes.last}¢`);
  console.log(`  NO:  bid=${quotes.no.bid}¢ ask=${quotes.no.ask}¢ last=${quotes.no.last}¢`);
  console.log(`  Spread: ${quotes.spread}¢`);

  // Get orderbook
  console.log("\nOrderbook:");
  const book = await ctx.markets.orderbook(market.id);
  console.log(`  Bids: ${book.bids.length} levels`);
  if (book.bids[0]) console.log(`    Best bid: ${book.bids[0].price}¢ × ${book.bids[0].size}`);
  console.log(`  Asks: ${book.asks.length} levels`);
  if (book.asks[0]) console.log(`    Best ask: ${book.asks[0].price}¢ × ${book.asks[0].size}`);

  // Get oracle signals
  console.log("\nOracle:");
  const { oracle } = await ctx.markets.oracle(market.id);
  if (oracle.summary) {
    console.log(`  Decision: ${oracle.summary.decision}`);
    console.log(`  Summary: ${oracle.summary.shortSummary}`);
  }
  if (oracle.sourcesMonitored) {
    console.log(`  Sources: ${oracle.sourcesMonitored.join(", ")}`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
