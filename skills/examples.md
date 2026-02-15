# Context SDK -- Complete Examples

Six self-contained TypeScript scripts covering read-only scanning, trading, portfolio management, monitoring, bulk operations, and orderbook analysis.

---

## 1. Read-Only Market Scanner

Scan active markets without authentication. Fetches quotes for each market and prints a summary with YES/NO prices, spread, volume, and participants.

```typescript
import { ContextClient } from "@contextwtf/sdk";

async function main() {
  // No apiKey or signer needed for read-only access
  const ctx = new ContextClient();

  const { markets } = await ctx.markets.list({ status: "active", limit: 20 });
  console.log(`Found ${markets.length} active markets\n`);

  for (const m of markets) {
    const quotes = await ctx.markets.quotes(m.id);

    // outcomePrices[0] = YES, outcomePrices[1] = NO
    const yesPrice = quotes.yes.bid ?? quotes.yes.last ?? 0;
    const noPrice = quotes.no.bid ?? quotes.no.last ?? 0;
    const spread = quotes.spread ?? 0;

    const label = (m.shortQuestion || m.question).slice(0, 50);
    console.log(`${label}`);
    console.log(
      `  YES: ${yesPrice}c  NO: ${noPrice}c  ` +
      `spread: ${spread}c  vol: ${m.volume}  participants: ${m.participantCount}`
    );
    console.log();
  }
}

main().catch(console.error);
```

---

## 2. Place a Buy Order (Full Flow)

Complete trading lifecycle: initialize with signer, ensure wallet is set up, fund the account if empty (mint testnet USDC + deposit), find a market, place an order, check status, then cancel.

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

async function main() {
  const ctx = new ContextClient({
    apiKey: process.env.CONTEXT_API_KEY!,
    signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as Hex },
  });

  console.log(`Trader: ${ctx.address}`);

  // Step 1: Ensure wallet approvals are in place
  const walletStatus = await ctx.account.status();
  if (walletStatus.needsApprovals) {
    console.log("Setting up wallet approvals...");
    await ctx.account.setup();
  }

  // Step 2: Check balance, mint + deposit if empty (testnet only)
  const bal = await ctx.portfolio.balance();
  const settlementUsdc = Number(bal.usdc.settlementBalance);
  if (settlementUsdc < 10) {
    console.log("Low balance -- minting 1000 test USDC and depositing...");
    await ctx.account.mintTestUsdc(1000);
    await ctx.account.deposit(1000);
  }

  // Step 3: Find an active market
  const { markets } = await ctx.markets.list({ status: "active", limit: 1 });
  if (markets.length === 0) throw new Error("No active markets");
  const market = markets[0];
  console.log(`Market: ${market.question}`);

  // Step 4: Place a limit buy for 10 YES shares at 35 cents
  const result = await ctx.orders.create({
    marketId: market.id,
    outcome: "yes",
    side: "buy",
    priceCents: 35,
    size: 10,
  });
  console.log(`Order placed: nonce=${result.order.nonce} status=${result.order.status}`);

  // Step 5: Check the order
  const fetched = await ctx.orders.get(result.order.nonce);
  console.log(`Order status: ${fetched.status}, filled: ${fetched.filledSize}/${fetched.size}`);

  // Step 6: Cancel the order
  const cancel = await ctx.orders.cancel(result.order.nonce);
  console.log(`Cancelled: ${cancel.success}`);
}

main().catch(console.error);
```

---

## 3. Portfolio Dashboard Data

Fetch all data a portfolio dashboard needs in parallel: positions, USDC balance (wallet + settlement), claimable amounts from resolved markets, and portfolio stats.

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

async function main() {
  const ctx = new ContextClient({
    apiKey: process.env.CONTEXT_API_KEY!,
    signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as Hex },
  });

  console.log(`Dashboard for: ${ctx.address}\n`);

  // Fetch everything in parallel for speed
  const [portfolio, balance, claimable, stats] = await Promise.all([
    ctx.portfolio.get(),                // all positions
    ctx.portfolio.balance(),            // USDC breakdown
    ctx.portfolio.claimable(),          // winnings from resolved markets
    ctx.portfolio.stats(),              // portfolio value + percent change
  ]);

  // USDC balances
  console.log("--- USDC ---");
  console.log(`  Wallet:     ${balance.usdc.walletBalance}`);
  console.log(`  Settlement: ${balance.usdc.settlementBalance}`);
  console.log(`  Total:      ${balance.usdc.balance}`);

  // Portfolio stats
  console.log("\n--- Stats ---");
  console.log(`  Value:   ${stats.currentPortfolioValue}`);
  console.log(`  Change:  ${stats.currentPortfolioPercentChange.toFixed(2)}%`);

  // Active positions
  console.log(`\n--- Positions (${portfolio.portfolio.length}) ---`);
  for (const pos of portfolio.portfolio) {
    console.log(
      `  ${pos.outcomeName} on ${pos.marketId.slice(0, 8)}...  ` +
      `invested: ${pos.netInvestment}  value: ${pos.currentValue}`
    );
  }

  // Claimable winnings
  console.log(`\n--- Claimable: ${claimable.totalClaimable} USDC ---`);
  for (const pos of claimable.positions) {
    console.log(`  ${pos.outcomeName} on ${pos.marketId.slice(0, 8)}...  amount: ${pos.claimableAmount}`);
  }
}

main().catch(console.error);
```

---

## 4. Market Monitoring Loop

Poll active markets on an interval. Track previous midpoint prices in a Map. Detect and log price movements with directional arrows. Handles SIGINT for clean shutdown.

```typescript
import { ContextClient } from "@contextwtf/sdk";

async function main() {
  const ctx = new ContextClient();
  const POLL_MS = 10_000;

  // Load markets once at startup
  const { markets } = await ctx.markets.list({ status: "active", limit: 10 });
  if (markets.length === 0) { console.log("No markets."); return; }

  console.log(`Monitoring ${markets.length} markets every ${POLL_MS / 1000}s (Ctrl+C to stop)\n`);

  // Track previous midpoint for each market
  const prevMid = new Map<string, number>();

  async function poll() {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}]`);

    for (const m of markets) {
      const book = await ctx.markets.orderbook(m.id);
      if (book.bids.length === 0 || book.asks.length === 0) continue;

      const mid = (book.bids[0].price + book.asks[0].price) / 2;
      const prev = prevMid.get(m.id);
      const arrow = prev === undefined ? " " : mid > prev ? "^" : mid < prev ? "v" : "=";
      const delta = prev !== undefined ? (mid - prev).toFixed(1) : "--";
      const label = (m.shortQuestion || m.question).slice(0, 40).padEnd(40);

      console.log(`  ${arrow} ${label} mid=${mid.toFixed(1)}c  delta=${delta}`);
      prevMid.set(m.id, mid);
    }
    console.log();
  }

  await poll();
  const timer = setInterval(poll, POLL_MS);

  // Clean shutdown on Ctrl+C
  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("\nStopped.");
    process.exit(0);
  });
}

main().catch(console.error);
```

---

## 5. Bulk Operations

Place a ladder of buy orders at different price levels (30, 35, 40, 45 cents), then cancel all of them in one call. Demonstrates `bulkCreate` and `bulkCancel`.

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

async function main() {
  const ctx = new ContextClient({
    apiKey: process.env.CONTEXT_API_KEY!,
    signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as Hex },
  });

  // Find an active market
  const { markets } = await ctx.markets.list({ status: "active", limit: 1 });
  if (markets.length === 0) throw new Error("No active markets");
  const market = markets[0];
  console.log(`Market: ${market.question}\n`);

  // Build a ladder: buy YES at 30, 35, 40, 45 cents
  const priceLadder = [30, 35, 40, 45];
  const orders = priceLadder.map((priceCents) => ({
    marketId: market.id,
    outcome: "yes" as const,
    side: "buy" as const,
    priceCents,
    size: 5,
  }));

  // Place all orders in a single batch call
  console.log("Placing ladder orders...");
  const results = await ctx.orders.bulkCreate(orders);
  const nonces: Hex[] = [];

  for (const r of results) {
    console.log(`  ${r.order.price}c x${r.order.size} -> nonce=${r.order.nonce} success=${r.success}`);
    nonces.push(r.order.nonce);
  }

  // Cancel all orders in a single batch call
  console.log(`\nCancelling ${nonces.length} orders...`);
  const cancels = await ctx.orders.bulkCancel(nonces);

  for (const c of cancels) {
    console.log(`  cancelled: ${c.success}`);
  }

  console.log("\nDone -- all ladder orders placed and cancelled.");
}

main().catch(console.error);
```

---

## 6. Orderbook Analysis

Fetch orderbooks for multiple markets. For each, calculate the spread, midpoint, total bid/ask depth in contracts, and detect crossed books (where best bid >= best ask).

```typescript
import { ContextClient } from "@contextwtf/sdk";

async function main() {
  const ctx = new ContextClient();

  const { markets } = await ctx.markets.list({ status: "active", limit: 10 });
  console.log(`Analyzing orderbooks for ${markets.length} markets\n`);

  // Fetch all orderbooks in parallel
  const books = await Promise.all(
    markets.map(async (m) => ({
      market: m,
      book: await ctx.markets.orderbook(m.id),
    }))
  );

  for (const { market, book } of books) {
    const label = (market.shortQuestion || market.question).slice(0, 50);
    console.log(`=== ${label} ===`);

    if (book.bids.length === 0 && book.asks.length === 0) {
      console.log("  No liquidity\n");
      continue;
    }

    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 100;
    const spread = bestAsk - bestBid;
    const midpoint = (bestBid + bestAsk) / 2;

    // Sum total contracts on each side
    const bidDepth = book.bids.reduce((sum, lvl) => sum + lvl.size, 0);
    const askDepth = book.asks.reduce((sum, lvl) => sum + lvl.size, 0);

    console.log(`  Best bid: ${bestBid}c  Best ask: ${bestAsk}c`);
    console.log(`  Spread:   ${spread.toFixed(1)}c  Midpoint: ${midpoint.toFixed(1)}c`);
    console.log(`  Bid depth: ${bidDepth} contracts (${book.bids.length} levels)`);
    console.log(`  Ask depth: ${askDepth} contracts (${book.asks.length} levels)`);

    // Detect crossed book (arbitrage condition)
    if (bestBid >= bestAsk) {
      console.log(`  *** CROSSED BOOK *** bid ${bestBid}c >= ask ${bestAsk}c`);
    }
    console.log();
  }
}

main().catch(console.error);
```
