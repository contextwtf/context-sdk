/**
 * Basic read-only example — no authentication needed.
 *
 * Usage:
 *   npx tsx examples/basic-read.ts
 */
import { ContextClient } from "@context-markets/sdk";

async function main() {
  const client = new ContextClient();

  // Search markets
  console.log("--- Searching markets ---");
  const { markets } = await client.searchMarkets({
    query: "super bowl",
    limit: 5,
  });
  console.log(`Found ${markets.length} markets:`);
  for (const m of markets) {
    console.log(`  [${m.status}] ${m.title} (${m.id})`);
  }

  if (markets.length === 0) {
    console.log("No markets found. Try a different query.");
    return;
  }

  const market = markets[0];
  console.log(`\n--- Market: ${market.title} ---`);

  // Get quotes
  console.log("\nQuotes:");
  const quotes = await client.getQuotes(market.id);
  for (const q of quotes) {
    console.log(
      `  ${q.outcome}: ${(q.probability * 100).toFixed(1)}%` +
        (q.confidence ? ` (confidence: ${(q.confidence * 100).toFixed(0)}%)` : ""),
    );
  }

  // Get orderbook
  console.log("\nOrderbook:");
  const book = await client.getOrderbook(market.id);
  console.log(`  Bids: ${book.bids.length} levels`);
  if (book.bids[0]) console.log(`    Best bid: ${book.bids[0].price}¢ × ${book.bids[0].size}`);
  console.log(`  Asks: ${book.asks.length} levels`);
  if (book.asks[0]) console.log(`    Best ask: ${book.asks[0].price}¢ × ${book.asks[0].size}`);

  // Get oracle signals
  console.log("\nOracle Signals:");
  const signals = await client.getOracleSignals(market.id);
  for (const s of signals) {
    console.log(
      `  [${s.source}] confidence: ${(s.confidence * 100).toFixed(0)}%` +
        (s.outcome ? ` → ${s.outcome}` : ""),
    );
  }

  // Global activity
  console.log("\n--- Global Activity (last 5) ---");
  const activity = await client.getGlobalActivity();
  for (const item of activity.slice(0, 5)) {
    console.log(`  [${item.type}] ${item.timestamp}`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
