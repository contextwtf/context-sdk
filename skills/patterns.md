# Patterns & Recipes

Common patterns for building with the Context Markets SDK. Every snippet is self-contained TypeScript you can drop into a project.

---

## 1. Client Setup

### Read-only client (no auth required)

```typescript
import { ContextClient } from "@contextwtf/sdk";

const ctx = new ContextClient();

// ctx.address is null -- no signer was provided
const { markets } = await ctx.markets.list({ status: "active" });
```

No API key or signer is needed for read-only operations: listing markets, fetching orderbooks, price history, and oracle data.

### Trading client (apiKey + signer)

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

const ctx = new ContextClient({
  apiKey: "ctx_pk_...",
  signer: { privateKey: "0x..." as Hex },
});

console.log(ctx.address); // "0xYourAddress..."
```

### Three signer formats

| Format | When to use | Example |
|--------|-------------|---------|
| `{ privateKey }` | Bots and server-side scripts | `{ privateKey: "0x..." as Hex }` |
| `{ walletClient }` | Browser dApps with wallet extensions | `{ walletClient: viemWalletClient }` |
| `{ account }` | When you already have a viem `Account` object | `{ account: viemAccount }` |

```typescript
// Bot / server
const ctx = new ContextClient({
  apiKey,
  signer: { privateKey: "0xabc..." as Hex },
});

// Browser with wallet extension
import { createWalletClient, custom } from "viem";
import { baseSepolia } from "viem/chains";

const walletClient = createWalletClient({
  chain: baseSepolia,
  transport: custom(window.ethereum!),
});
const ctx = new ContextClient({
  apiKey,
  signer: { walletClient },
});

// Existing viem account
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0xabc...");
const ctx = new ContextClient({
  apiKey,
  signer: { account },
});
```

---

## 2. Wallet Onboarding (CRITICAL)

**This is the #1 gotcha.** You must complete on-chain setup before placing orders, or they will be voided with `MISSING_OPERATOR_APPROVAL` or `UNDER_COLLATERALIZED`.

### Required sequence

```
status() -> setup() if needed -> mintTestUsdc() -> deposit() -> place orders
```

### Full onboarding code

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

const ctx = new ContextClient({
  apiKey: "ctx_pk_...",
  signer: { privateKey: "0x..." as Hex },
});

// Step 1: Check wallet status
const status = await ctx.account.status();
console.log("Needs approvals:", status.needsApprovals);
console.log("Operator approved:", status.isOperatorApproved);
console.log("USDC allowance:", status.usdcAllowance);

// Step 2: Run setup if needed (approves USDC + sets operator)
if (status.needsApprovals) {
  const result = await ctx.account.setup();
  console.log("USDC approval tx:", result.usdcApprovalTx);
  console.log("Operator approval tx:", result.operatorApprovalTx);
}

// Step 3: Mint test USDC (testnet only!)
await ctx.account.mintTestUsdc(1000);

// Step 4: Deposit USDC into the settlement system
const depositTx = await ctx.account.deposit(500);
console.log("Deposit tx:", depositTx);

// NOW you can safely place orders
```

### Checking if ready

```typescript
const status = await ctx.account.status();

if (status.needsApprovals) {
  // needsApprovals is true when EITHER:
  //   - usdcAllowance === 0n  (USDC not approved for Holdings contract)
  //   - isOperatorApproved === false  (Settlement not set as operator)
  await ctx.account.setup();
}
```

### Common void reasons

| Void Reason | Cause | Fix |
|-------------|-------|-----|
| `MISSING_OPERATOR_APPROVAL` | `setup()` was never called | Call `ctx.account.setup()` |
| `UNDER_COLLATERALIZED` | Insufficient deposited USDC | Call `ctx.account.deposit(amount)` |
| `UNFILLED_MARKET_ORDER` | Market order could not fill against the book | Use limit orders or check liquidity first |

---

## 3. Market Discovery

### Search with filters

```typescript
const { markets } = await ctx.markets.list({
  query: "bitcoin",
  status: "active",
  sortBy: "volume",
  limit: 10,
});

for (const m of markets) {
  console.log(`${m.question} - Volume: ${m.volume}`);
}
```

Available `sortBy` values: `"new"`, `"volume"`, `"trending"`, `"ending"`, `"chance"`.

### Pagination with cursors

```typescript
const allMarkets = [];
let cursor: string | undefined;

do {
  const res = await ctx.markets.list({
    status: "active",
    cursor,
    limit: 50,
  });
  allMarkets.push(...res.markets);
  cursor = res.cursor ?? undefined;
} while (cursor);

console.log(`Fetched ${allMarkets.length} active markets`);
```

### Batch data fetching with Promise.all

```typescript
const { markets } = await ctx.markets.list({ status: "active", limit: 5 });

// Fetch quotes, orderbooks, and price history in parallel
const [quotes, orderbooks, histories] = await Promise.all([
  Promise.all(markets.map((m) => ctx.markets.quotes(m.id))),
  Promise.all(markets.map((m) => ctx.markets.orderbook(m.id))),
  Promise.all(markets.map((m) => ctx.markets.priceHistory(m.id, { timeframe: "1d" }))),
]);

for (let i = 0; i < markets.length; i++) {
  console.log(markets[i].question);
  console.log(`  Yes bid: ${quotes[i].yes.bid}, Yes ask: ${quotes[i].yes.ask}`);
  console.log(`  Book depth: ${orderbooks[i].bids.length} bids, ${orderbooks[i].asks.length} asks`);
  console.log(`  Price points: ${histories[i].prices.length}`);
}
```

---

## 4. Order Lifecycle

### Place an order

```typescript
import type { Hex } from "viem";

const result = await ctx.orders.create({
  marketId: "0xMarketId...",
  outcome: "yes",        // "yes" or "no"
  side: "buy",           // "buy" or "sell"
  priceCents: 45,        // 1-99 (cents, NOT decimals)
  size: 10,              // number of shares
  expirySeconds: 3600,   // optional: auto-expire after 1 hour
});

// Save the nonce -- you need it to cancel later
const nonce: Hex = result.order.nonce;
console.log(`Order placed: ${nonce}, status: ${result.order.status}`);
```

### Check order status

```typescript
// Get a single order by nonce/id
const order = await ctx.orders.get(orderId);
console.log(`Status: ${order.status}`);
// Possible status values: "open" | "filled" | "cancelled" | "expired" | "voided"

// Get my orders for a specific market (first page)
const myOrders = await ctx.orders.mine(marketId);
for (const o of myOrders.orders) {
  console.log(`${o.nonce}: ${o.status} - filled ${o.percentFilled}%`);
}

// Get ALL my orders (auto-paginates)
const allMyOrders = await ctx.orders.allMine(marketId);
console.log(`Total orders: ${allMyOrders.length}`);
```

### Cancel by nonce

```typescript
const cancelResult = await ctx.orders.cancel(nonce);
console.log(`Cancelled: ${cancelResult.success}`);
if (cancelResult.alreadyCancelled) {
  console.log("Order was already cancelled");
}
```

### Cancel and replace (atomic)

```typescript
// Atomically cancel one order and create a new one
const result = await ctx.orders.cancelReplace(oldNonce, {
  marketId: "0xMarketId...",
  outcome: "yes",
  side: "buy",
  priceCents: 50,  // new price
  size: 10,
});

console.log("Cancel success:", result.cancel.success);
console.log("New order nonce:", result.create.order.nonce);
```

### Bulk operations

```typescript
// Bulk create multiple orders
const results = await ctx.orders.bulkCreate([
  { marketId, outcome: "yes", side: "buy", priceCents: 40, size: 5 },
  { marketId, outcome: "yes", side: "buy", priceCents: 35, size: 10 },
  { marketId, outcome: "no", side: "buy", priceCents: 55, size: 5 },
]);
const nonces = results.map((r) => r.order.nonce);

// Bulk cancel multiple orders
const cancelResults = await ctx.orders.bulkCancel(nonces);

// Bulk mixed: create some + cancel some in one call
const mixedResult = await ctx.orders.bulk(
  [{ marketId, outcome: "yes", side: "buy", priceCents: 42, size: 5 }],  // creates
  [oldNonce1, oldNonce2],  // cancel nonces
);
for (const r of mixedResult.results) {
  console.log(`${r.type}: success=${r.success}`);
}
```

---

## 5. Error Handling

### Three error types

```typescript
import {
  ContextApiError,
  ContextSigningError,
  ContextConfigError,
} from "@contextwtf/sdk";

try {
  const result = await ctx.orders.create({
    marketId: "0xMarketId...",
    outcome: "yes",
    side: "buy",
    priceCents: 45,
    size: 10,
  });
} catch (err) {
  if (err instanceof ContextApiError) {
    // HTTP error from the API
    console.error(`API error ${err.status}: ${err.message}`);
    console.error("Response body:", err.body);
  } else if (err instanceof ContextSigningError) {
    // EIP-712 signing failed (bad key, user rejected in wallet)
    console.error(`Signing error: ${err.message}`);
    console.error("Cause:", err.cause);
  } else if (err instanceof ContextConfigError) {
    // Missing signer or misconfigured client
    console.error(`Config error: ${err.message}`);
  } else {
    throw err;
  }
}
```

### Common API error status codes

| Status | Meaning | Typical cause |
|--------|---------|---------------|
| 400 | Bad Request | Invalid order params (price out of range, bad marketId) |
| 401 | Unauthorized | Missing or invalid API key |
| 404 | Not Found | Market or order does not exist |
| 429 | Rate Limited | Too many requests -- back off and retry |

### ContextConfigError triggers

`ContextConfigError` is thrown synchronously when you call a write method on a read-only client:

```typescript
const ctx = new ContextClient(); // no signer

// This throws ContextConfigError immediately, before any network call
await ctx.orders.create({ ... });
// Error: "A signer is required for write operations."

await ctx.account.setup();
// Error: "A signer is required for account operations."
```

### Voided orders

Orders can be accepted by the API but later voided on-chain. Check `order.voidReason`:

| Void Reason | Description |
|-------------|-------------|
| `MISSING_OPERATOR_APPROVAL` | Settlement contract is not approved as operator. Call `setup()`. |
| `UNDER_COLLATERALIZED` | Not enough deposited USDC to cover the order. Call `deposit()`. |
| `UNFILLED_MARKET_ORDER` | Market order had no matching liquidity. Use limit orders or check orderbook. |

```typescript
const order = await ctx.orders.get(orderId);
if (order.status === "voided") {
  console.error(`Order voided: ${order.voidReason}`);
}
```

---

## 6. Polling & Monitoring

### Watch price changes

```typescript
import { ContextClient } from "@contextwtf/sdk";

const ctx = new ContextClient();
const INTERVAL_MS = 10_000;

const { markets } = await ctx.markets.list({ status: "active", limit: 5 });
const previousPrices = new Map<string, number>();

async function poll() {
  for (const m of markets) {
    const book = await ctx.markets.orderbook(m.id);

    if (book.bids.length > 0 && book.asks.length > 0) {
      const mid = (book.bids[0].price + book.asks[0].price) / 2;
      const prev = previousPrices.get(m.id);
      const delta = prev !== undefined ? (mid - prev).toFixed(1) : "--";
      const arrow =
        prev !== undefined ? (mid > prev ? "^" : mid < prev ? "v" : "=") : " ";

      console.log(
        `${arrow} ${m.shortQuestion?.slice(0, 40)} mid=${mid.toFixed(1)} (${delta})`,
      );
      previousPrices.set(m.id, mid);
    }
  }
}

await poll();
const timer = setInterval(poll, INTERVAL_MS);

// Clean shutdown
process.on("SIGINT", () => {
  clearInterval(timer);
  process.exit(0);
});
```

### Monitor order fills

```typescript
async function waitForFill(
  ctx: ContextClient,
  orderId: string,
  intervalMs = 2_000,
  timeoutMs = 60_000,
): Promise<Order> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const order = await ctx.orders.get(orderId);

    if (order.status !== "open") {
      return order; // filled, cancelled, expired, or voided
    }

    console.log(
      `Order ${order.nonce}: ${order.percentFilled}% filled, waiting...`,
    );
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Timed out waiting for order ${orderId} to fill`);
}

// Usage
const result = await ctx.orders.create({ ... });
const filledOrder = await waitForFill(ctx, result.order.nonce);
console.log(`Final status: ${filledOrder.status}`);
```

---

## 7. Gotchas & Pitfalls

1. **Must call `setup()` before first trade.** Without on-chain approvals, orders are accepted by the API but voided with `MISSING_OPERATOR_APPROVAL`. Always check `status().needsApprovals` first.

2. **Prices are cents, not decimals.** Pass `priceCents: 45` for a 45-cent price. The valid range is 1--99. Do not pass `0.45`.

3. **`mintTestUsdc()` is testnet only.** This mints fake USDC on Base Sepolia. It will not work on mainnet.

4. **SDK never reads environment variables.** Pass `apiKey` and `signer` explicitly via `ContextClientOptions`. There is no automatic `process.env` lookup.

5. **`deposit()` and `withdraw()` wait for the transaction receipt.** These calls block until the on-chain transaction is confirmed. Plan for multi-second latency.

6. **Order nonces are `Hex` strings -- save them for cancel.** The nonce returned in `result.order.nonce` is the key you need for `cancel()`, `cancelReplace()`, and `bulkCancel()`.

7. **`listAll()` and `allMine()` auto-paginate.** These methods follow cursors internally and return the complete array. Use `list()` and `mine()` for single-page results with manual cursor control.

8. **Parallel requests are safe.** The SDK is stateless per-call. Use `Promise.all()` freely to fetch multiple markets, orderbooks, or quotes concurrently.

9. **Forward-compatible types with index signatures.** All SDK interfaces include `[key: string]: unknown`, so new API fields will not break existing code. Access new fields with bracket notation: `market["newField"]`.
