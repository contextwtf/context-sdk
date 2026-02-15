# Context SDK Agent Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `skills/` folder with 4 markdown files that teach any AI coding agent how to build complete projects on Context Markets using the @contextwtf/sdk.

**Architecture:** 4 independent markdown files. `SKILL.md` is the entry point (~150 lines) with Claude Code frontmatter. Three supporting files provide depth: `api-reference.md`, `patterns.md`, `examples.md`. All files are self-contained markdown that any agent can consume.

**Tech Stack:** Markdown, YAML frontmatter (for Claude Code compatibility)

---

### Task 1: Create skills/ directory and SKILL.md

**Files:**
- Create: `skills/SKILL.md`

**Step 1: Create the directory**

```bash
mkdir -p skills
```

**Step 2: Write SKILL.md**

Create `skills/SKILL.md` with the following exact content:

````markdown
---
name: context-sdk
description: Build projects on Context Markets prediction market API using the @contextwtf/sdk. Use when building trading bots, dashboards, analytics, or any app involving prediction markets on Base Sepolia.
---

# Context SDK

Context Markets is a prediction market platform on Base Sepolia. The `@contextwtf/sdk` is a TypeScript SDK that wraps the Context Markets API for reading market data, placing/managing orders, tracking portfolios, and managing on-chain wallet operations.

## Install

```bash
npm install @contextwtf/sdk
```

Single dependency: `viem`. Works with Node 18+, Bun, and Deno.

## Initialize

**Read-only (no auth needed):**

```typescript
import { ContextClient } from "@contextwtf/sdk";

const ctx = new ContextClient();
const { markets } = await ctx.markets.list({ status: "active" });
```

**With trading (requires API key + signer):**

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

const ctx = new ContextClient({
  apiKey: process.env.CONTEXT_API_KEY!,
  signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as Hex },
});
```

The SDK accepts three signer formats:
- `{ privateKey: "0x..." }` — for bots and scripts
- `{ account: viemAccount }` — for apps using viem accounts
- `{ walletClient: viemWalletClient }` — for browser apps with wallet connections

## Core Modules

The client exposes 4 modules:

- **`ctx.markets`** — Read-only market data. No auth needed. Search markets, get quotes, orderbooks, price history, oracle signals, and activity feeds.
- **`ctx.orders`** — Place and manage orders. Requires signer for writes (create, cancel, replace). Read operations (list, get) work without signer.
- **`ctx.portfolio`** — Query positions, USDC balances, claimable amounts, and portfolio stats for any address.
- **`ctx.account`** — On-chain wallet operations. Requires signer. Check wallet status, approve contracts, deposit/withdraw USDC, mint/burn complete sets.

## Critical Rules

1. **Prices are in cents (1-99).** 45 = 45 cents = 45% probability. The SDK handles on-chain encoding.
2. **Outcomes are `"yes"` or `"no"`.** The SDK maps these to on-chain indices (yes=1, no=0).
3. **Sides are `"buy"` or `"sell"`.** The SDK maps these to on-chain values (buy=0, sell=1).
4. **Read operations need no auth.** Markets, quotes, orderbooks, oracle — all free and unauthenticated.
5. **Write operations need a signer.** Orders, wallet setup, deposits — these require a private key or wallet client.
6. **You must call `ctx.account.setup()` before the first trade.** This approves the USDC and operator contracts. Skip this and orders will be voided.
7. **Base Sepolia only.** Chain ID 84532. Cannot be changed.
8. **The SDK never reads environment variables.** Always pass `apiKey` and `signer` explicitly.

## Quick Recipes

**List active markets and get quotes:**

```typescript
const ctx = new ContextClient();
const { markets } = await ctx.markets.list({ status: "active", limit: 5 });

for (const m of markets) {
  const quotes = await ctx.markets.quotes(m.id);
  console.log(`${m.question}: YES ${quotes.yes.bid}¢/${quotes.yes.ask}¢`);
}
```

**Place a buy order:**

```typescript
const result = await ctx.orders.create({
  marketId: "0x...",
  outcome: "yes",
  side: "buy",
  priceCents: 45,
  size: 10,
});
console.log(`Order placed: ${result.order.nonce}`);
```

**Full wallet setup flow (required before first trade):**

```typescript
const status = await ctx.account.status();
if (status.needsApprovals) {
  await ctx.account.setup();
}
await ctx.account.mintTestUsdc(1000);   // testnet only
await ctx.account.deposit(1000);
```

## Deeper Reference

- [API Reference](api-reference.md) — Every method signature, parameter type, and return type
- [Patterns](patterns.md) — Common patterns: wallet onboarding, order lifecycle, polling, error handling, gotchas
- [Examples](examples.md) — Complete, copy-paste-ready scripts for common project types
````

**Step 3: Verify the file exists and is well-formed**

```bash
wc -l skills/SKILL.md
cat skills/SKILL.md | head -3
```

Expected: ~100-120 lines, starts with `---`

**Step 4: Commit**

```bash
git add skills/SKILL.md
git commit -m "feat: add Context SDK agent skill entry point"
```

---

### Task 2: Create api-reference.md

**Files:**
- Create: `skills/api-reference.md`

**Step 1: Write api-reference.md**

Create `skills/api-reference.md` with the following exact content:

````markdown
# Context SDK — API Reference

Complete method reference for `@contextwtf/sdk`. Every method, parameter, and return type.

## ContextClient

```typescript
import { ContextClient } from "@contextwtf/sdk";

const ctx = new ContextClient(options?: ContextClientOptions);
```

### ContextClientOptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | `string` | No | API key for authenticated endpoints (format: `ctx_pk_...`) |
| `baseUrl` | `string` | No | Override API base URL (default: `https://api-testnet.context.markets/v2`) |
| `signer` | `SignerInput` | No | Signer for write operations |

### SignerInput (three formats)

```typescript
// Private key (bots, scripts)
{ privateKey: "0x..." as Hex }

// Viem account
{ account: viemLocalAccount }

// Wallet client (browser wallets)
{ walletClient: viemWalletClient }
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `ctx.address` | `Address \| null` | Trader's on-chain address, or null if no signer |
| `ctx.markets` | `Markets` | Market data module |
| `ctx.orders` | `Orders` | Order management module |
| `ctx.portfolio` | `PortfolioModule` | Portfolio/balance module |
| `ctx.account` | `AccountModule` | Wallet operations module |

---

## ctx.markets

All methods are read-only. No authentication required.

### list

```typescript
ctx.markets.list(params?: SearchMarketsParams): Promise<MarketList>
```

Search and filter markets. Returns `{ markets: Market[], cursor: string | null }`.

**SearchMarketsParams:**

| Param | Type | Description |
|-------|------|-------------|
| `query` | `string` | Text search |
| `status` | `"active" \| "pending" \| "resolved" \| "closed"` | Filter by status |
| `sortBy` | `"new" \| "volume" \| "trending" \| "ending" \| "chance"` | Sort field |
| `sort` | `"asc" \| "desc"` | Sort direction |
| `limit` | `number` | Page size |
| `cursor` | `string` | Pagination cursor from previous response |
| `visibility` | `"visible" \| "hidden" \| "all"` | Visibility filter |
| `resolutionStatus` | `string` | Resolution status filter |
| `creator` | `string` | Filter by creator address |
| `category` | `string` | Filter by category |
| `createdAfter` | `string` | ISO date filter |

### get

```typescript
ctx.markets.get(id: string): Promise<Market>
```

Get a single market by ID.

### quotes

```typescript
ctx.markets.quotes(marketId: string): Promise<Quotes>
```

Get bid/ask/last prices for YES and NO outcomes.

**Quotes shape:**
```typescript
{
  marketId: string;
  yes: { bid: number | null, ask: number | null, last: number | null };
  no:  { bid: number | null, ask: number | null, last: number | null };
  spread: number | null;
  timestamp: string;
}
```

### orderbook

```typescript
ctx.markets.orderbook(marketId: string, params?: GetOrderbookParams): Promise<Orderbook>
```

Get the full bid/ask ladder.

| Param | Type | Description |
|-------|------|-------------|
| `depth` | `number` | Max levels to return |
| `outcomeIndex` | `number` | Filter by outcome (0=NO, 1=YES) |

**Orderbook shape:**
```typescript
{
  marketId: string;
  bids: { price: number, size: number }[];
  asks: { price: number, size: number }[];
  timestamp: string;
}
```

### simulate

```typescript
ctx.markets.simulate(marketId: string, params: SimulateTradeParams): Promise<SimulateResult>
```

Simulate a trade to estimate slippage and fill.

| Param | Type | Description |
|-------|------|-------------|
| `side` | `"yes" \| "no"` | Which outcome to trade |
| `amount` | `number` | Amount to trade |
| `amountType` | `"usd" \| "contracts"` | Whether amount is USD or contracts (default: `"usd"`) |
| `trader` | `string` | Optional trader address for collateral check |

### priceHistory

```typescript
ctx.markets.priceHistory(marketId: string, params?: GetPriceHistoryParams): Promise<PriceHistory>
```

Get historical price data.

| Param | Type | Description |
|-------|------|-------------|
| `timeframe` | `"1h" \| "6h" \| "1d" \| "1w" \| "1M" \| "all"` | Time window |

**PriceHistory shape:**
```typescript
{
  prices: { time: number, price: number }[];
  startTime: number;
  endTime: number;
  interval: number;
}
```

### oracle

```typescript
ctx.markets.oracle(marketId: string): Promise<OracleResponse>
```

Get oracle resolution signals and evidence.

**OracleResponse shape:**
```typescript
{
  oracle: {
    lastCheckedAt: string | null;
    confidenceLevel: string | null;
    evidenceCollected: { postsCount: number, relevantPosts: string[] };
    sourcesMonitored: string[];
    summary: { decision: string, shortSummary: string, expandedSummary: string };
  }
}
```

### oracleQuotes

```typescript
ctx.markets.oracleQuotes(marketId: string): Promise<OracleQuotesResponse>
```

Get oracle probability quotes. Returns `{ quotes: OracleQuote[] }`.

### requestOracleQuote

```typescript
ctx.markets.requestOracleQuote(marketId: string): Promise<OracleQuoteRequestResult>
```

Request a new oracle probability quote.

### activity

```typescript
ctx.markets.activity(marketId: string, params?: GetActivityParams): Promise<ActivityResponse>
```

Get activity feed for a specific market.

| Param | Type | Description |
|-------|------|-------------|
| `cursor` | `string` | Pagination cursor |
| `limit` | `number` | Page size |
| `types` | `string` | Filter by activity type |
| `startTime` | `string` | ISO date filter |
| `endTime` | `string` | ISO date filter |

### globalActivity

```typescript
ctx.markets.globalActivity(params?: GetActivityParams): Promise<ActivityResponse>
```

Get platform-wide activity feed. Same params as `activity`.

---

## ctx.orders

Read operations work without auth. Write operations require a signer.

### list

```typescript
ctx.orders.list(params?: GetOrdersParams): Promise<OrderList>
```

Query orders with filters. Returns `{ orders: Order[], markets?: OrderMarkets, cursor: string | null }`.

| Param | Type | Description |
|-------|------|-------------|
| `trader` | `Address` | Filter by trader address |
| `marketId` | `string` | Filter by market |
| `status` | `"open" \| "filled" \| "cancelled" \| "expired" \| "voided"` | Filter by status |
| `cursor` | `string` | Pagination cursor |
| `limit` | `number` | Page size |

### listAll

```typescript
ctx.orders.listAll(params?: Omit<GetOrdersParams, "cursor">): Promise<Order[]>
```

Auto-paginates through all matching orders. Returns flat array.

### mine

```typescript
ctx.orders.mine(marketId?: string): Promise<OrderList>
```

Get your open orders. Requires signer (uses `ctx.address` automatically).

### allMine

```typescript
ctx.orders.allMine(marketId?: string): Promise<Order[]>
```

Auto-paginate all your orders. Returns flat array.

### get

```typescript
ctx.orders.get(id: string): Promise<Order>
```

Get a single order by ID (nonce).

### recent

```typescript
ctx.orders.recent(params?: GetRecentOrdersParams): Promise<OrderList>
```

Get recent orders within a time window.

| Param | Type | Description |
|-------|------|-------------|
| `trader` | `Address` | Filter by trader |
| `marketId` | `string` | Filter by market |
| `status` | `OrderStatus` | Filter by status |
| `limit` | `number` | Page size |
| `windowSeconds` | `number` | Time window in seconds |

### simulate

```typescript
ctx.orders.simulate(params: OrderSimulateParams): Promise<OrderSimulateResult>
```

Simulate order execution with detailed fill levels and collateral info.

### create (requires signer)

```typescript
ctx.orders.create(req: PlaceOrderRequest): Promise<CreateOrderResult>
```

Place a signed limit order. The SDK handles EIP-712 signing automatically.

**PlaceOrderRequest:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `marketId` | `string` | Yes | Market ID to trade on |
| `outcome` | `"yes" \| "no"` | Yes | Which outcome to trade |
| `side` | `"buy" \| "sell"` | Yes | Buy or sell |
| `priceCents` | `number` | Yes | Price in cents (1-99) |
| `size` | `number` | Yes | Number of contracts |
| `expirySeconds` | `number` | No | Order TTL in seconds (default: 3600 = 1 hour) |

**CreateOrderResult:** `{ success: boolean, order: Order }`

### cancel (requires signer)

```typescript
ctx.orders.cancel(nonce: Hex): Promise<CancelResult>
```

Cancel an order by its nonce. Returns `{ success: boolean, alreadyCancelled?: boolean }`.

### cancelReplace (requires signer)

```typescript
ctx.orders.cancelReplace(cancelNonce: Hex, newOrder: PlaceOrderRequest): Promise<CancelReplaceResult>
```

Atomically cancel one order and place a new one.

### bulkCreate (requires signer)

```typescript
ctx.orders.bulkCreate(orders: PlaceOrderRequest[]): Promise<CreateOrderResult[]>
```

Place multiple orders in a single request.

### bulkCancel (requires signer)

```typescript
ctx.orders.bulkCancel(nonces: Hex[]): Promise<CancelResult[]>
```

Cancel multiple orders in a single request.

### bulk (requires signer)

```typescript
ctx.orders.bulk(creates: PlaceOrderRequest[], cancelNonces: Hex[]): Promise<BulkResult>
```

Mixed bulk operation: create some orders and cancel others in one request.

---

## ctx.portfolio

All methods accept an optional `address` parameter. If omitted, uses the signer's address.

### get

```typescript
ctx.portfolio.get(address?: Address, params?: GetPortfolioParams): Promise<Portfolio>
```

Get positions across markets.

| Param | Type | Description |
|-------|------|-------------|
| `kind` | `"all" \| "active" \| "won" \| "lost" \| "claimable"` | Position filter |
| `marketId` | `string` | Filter by market |
| `cursor` | `string` | Pagination cursor |
| `pageSize` | `number` | Page size |

**Portfolio shape:** `{ portfolio: Position[], marketIds: string[], cursor: string | null }`

### claimable

```typescript
ctx.portfolio.claimable(address?: Address): Promise<ClaimableResponse>
```

Get positions claimable from resolved markets.

### stats

```typescript
ctx.portfolio.stats(address?: Address): Promise<PortfolioStats>
```

Get portfolio value and percent change.

### balance

```typescript
ctx.portfolio.balance(address?: Address): Promise<Balance>
```

Get USDC and outcome token balances.

**Balance shape:**
```typescript
{
  address: Address;
  usdc: { tokenAddress: string, balance: string, settlementBalance: string, walletBalance: string };
  outcomeTokens: { tokenAddress: string, marketId: string, outcomeIndex: number, outcomeName: string, balance: string, settlementBalance: string, walletBalance: string }[];
}
```

### tokenBalance

```typescript
ctx.portfolio.tokenBalance(address: Address, tokenAddress: Address): Promise<TokenBalance>
```

Get balance for a specific token. Returns `{ balance: string, decimals: number, symbol: string }`.

---

## ctx.account

All methods require a signer.

### status

```typescript
ctx.account.status(): Promise<WalletStatus>
```

Check wallet approval status.

**WalletStatus shape:**
```typescript
{
  address: Address;
  ethBalance: bigint;
  usdcAllowance: bigint;
  isOperatorApproved: boolean;
  needsApprovals: boolean;    // true if either approval is missing
}
```

### setup

```typescript
ctx.account.setup(): Promise<WalletSetupResult>
```

Approve USDC spending and operator contracts. Only sends transactions for missing approvals.

Returns `{ usdcApprovalTx: Hex | null, operatorApprovalTx: Hex | null }`.

### mintTestUsdc

```typescript
ctx.account.mintTestUsdc(amount?: number): Promise<unknown>
```

Mint testnet USDC. Default amount: 1000. **Testnet only.**

### deposit

```typescript
ctx.account.deposit(amount: number): Promise<Hex>
```

Deposit USDC into the Holdings contract for trading. Amount is in USDC (not wei). Returns transaction hash. Waits for receipt.

### withdraw

```typescript
ctx.account.withdraw(amount: number): Promise<Hex>
```

Withdraw USDC from Holdings. Returns transaction hash. Waits for receipt.

### mintCompleteSets

```typescript
ctx.account.mintCompleteSets(marketId: string, amount: number): Promise<Hex>
```

Mint YES+NO token pairs from USDC in Holdings.

### burnCompleteSets

```typescript
ctx.account.burnCompleteSets(marketId: string, amount: number, creditInternal?: boolean): Promise<Hex>
```

Burn YES+NO token pairs to recover USDC. `creditInternal` defaults to `true`.

### relayOperatorApproval

```typescript
ctx.account.relayOperatorApproval(req: GaslessOperatorRequest): Promise<GaslessOperatorResult>
```

Submit gasless operator approval via relay.

### relayDeposit

```typescript
ctx.account.relayDeposit(req: GaslessDepositRequest): Promise<GaslessDepositResult>
```

Submit gasless deposit via relay.

---

## Key Types

### Market

```typescript
interface Market {
  id: string;
  question: string;
  shortQuestion: string;
  oracle: string;
  outcomeTokens: string[];
  outcomePrices: OutcomePrice[];
  creator: string;
  volume: string;
  volume24h: string;
  participantCount: number;
  resolutionStatus: "none" | "pending" | "resolved";
  status: "active" | "pending" | "resolved" | "closed";
  createdAt: string;
  deadline: string;
  resolutionCriteria: string;
  resolvedAt: string | null;
  payoutPcts: number[] | null;
  metadata: MarketMetadata;
  outcome: number | null;
  contractAddress: string | null;
}
```

### Order

```typescript
interface Order {
  nonce: Hex;                    // Unique order ID
  marketId: string;
  trader: Address;
  outcomeIndex: number;          // 0=NO, 1=YES
  side: 0 | 1;                  // 0=BUY, 1=SELL
  price: string;
  size: string;
  type: "limit" | "market";
  status: "open" | "filled" | "cancelled" | "expired" | "voided";
  insertedAt: string;
  filledSize: string;
  remainingSize: string;
  percentFilled: number;
  voidReason: "UNFILLED_MARKET_ORDER" | "UNDER_COLLATERALIZED" | "MISSING_OPERATOR_APPROVAL" | null;
}
```

### Error Types

```typescript
// HTTP error (non-OK response)
class ContextApiError extends Error {
  readonly status: number;       // HTTP status code
  readonly body: unknown;        // Response body
}

// Signing failure
class ContextSigningError extends Error {
  // cause property may contain underlying error
}

// Missing signer or config
class ContextConfigError extends Error {}
```

### Exported Constants

```typescript
import {
  API_BASE,             // "https://api-testnet.context.markets/v2"
  SETTLEMENT_ADDRESS,   // Settlement contract address
  HOLDINGS_ADDRESS,     // Holdings contract address
  USDC_ADDRESS,         // USDC token address
  PERMIT2_ADDRESS,      // Permit2 contract address
  CHAIN_ID,             // 84532 (Base Sepolia)
} from "@contextwtf/sdk";
```
````

**Step 2: Verify**

```bash
wc -l skills/api-reference.md
```

Expected: ~350-400 lines

**Step 3: Commit**

```bash
git add skills/api-reference.md
git commit -m "feat: add SDK API reference for agent skill"
```

---

### Task 3: Create patterns.md

**Files:**
- Create: `skills/patterns.md`

**Step 1: Write patterns.md**

Create `skills/patterns.md` with the following exact content:

````markdown
# Context SDK — Common Patterns

Patterns and recipes for building on Context Markets. Read this to avoid the most common mistakes.

## Client Setup

### Read-Only Client

No auth needed. Use for dashboards, analytics, market browsing.

```typescript
import { ContextClient } from "@contextwtf/sdk";

const ctx = new ContextClient();
// ctx.address is null
// ctx.markets.* and ctx.portfolio.get(someAddress) work
// ctx.orders.create() will throw ContextConfigError
```

### Trading Client

Requires API key and signer. Use for bots, trading apps.

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

const ctx = new ContextClient({
  apiKey: process.env.CONTEXT_API_KEY!,
  signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as Hex },
});
// ctx.address is the derived wallet address
// All methods work
```

### Signer Formats

Use `privateKey` for server-side bots. Use `walletClient` for browser apps with MetaMask/WalletConnect. Use `account` if you already have a viem LocalAccount.

```typescript
// Server-side bot
{ privateKey: "0x..." as Hex }

// Browser app with viem wallet client
{ walletClient: myWalletClient }

// Existing viem account
{ account: privateKeyToAccount("0x...") }
```

## Wallet Onboarding (CRITICAL)

This is the #1 source of errors. You MUST complete wallet setup before placing any orders, or they will be voided with `MISSING_OPERATOR_APPROVAL` or `UNDER_COLLATERALIZED`.

### Required Sequence

```typescript
// 1. Check if wallet needs setup
const status = await ctx.account.status();

// 2. Approve contracts if needed (one-time)
if (status.needsApprovals) {
  const result = await ctx.account.setup();
  // result.usdcApprovalTx — approves USDC spending
  // result.operatorApprovalTx — approves Settlement operator
}

// 3. Get testnet USDC (testnet only)
await ctx.account.mintTestUsdc(1000);

// 4. Deposit USDC into Holdings for trading
await ctx.account.deposit(1000);

// 5. NOW you can place orders
await ctx.orders.create({ ... });
```

### Checking If Ready

```typescript
const status = await ctx.account.status();
if (status.needsApprovals) {
  // Must call setup() before trading
}
// status.ethBalance — need ETH for gas
// status.usdcAllowance — 0n means needs approval
// status.isOperatorApproved — false means needs approval
```

## Market Discovery

### Search with Filters

```typescript
// Active markets about elections
const { markets } = await ctx.markets.list({
  query: "elections",
  status: "active",
  sortBy: "volume",
  limit: 10,
});
```

### Pagination with Cursors

```typescript
let cursor: string | undefined;
const allMarkets = [];

do {
  const result = await ctx.markets.list({ status: "active", cursor });
  allMarkets.push(...result.markets);
  cursor = result.cursor ?? undefined;
} while (cursor);
```

### Batch Data Fetching

Fetch multiple data points in parallel for each market:

```typescript
const { markets } = await ctx.markets.list({ status: "active", limit: 10 });

const enriched = await Promise.all(
  markets.map(async (m) => {
    const [quotes, book, oracle] = await Promise.all([
      ctx.markets.quotes(m.id),
      ctx.markets.orderbook(m.id),
      ctx.markets.oracle(m.id),
    ]);
    return { market: m, quotes, book, oracle: oracle.oracle };
  }),
);
```

## Order Lifecycle

### Place an Order

```typescript
const result = await ctx.orders.create({
  marketId: market.id,
  outcome: "yes",       // "yes" or "no"
  side: "buy",          // "buy" or "sell"
  priceCents: 45,       // 1-99 cents
  size: 10,             // number of contracts
  expirySeconds: 3600,  // optional, defaults to 1 hour
});

const nonce = result.order.nonce;  // save this for cancel/replace
```

### Check Order Status

```typescript
// Get a specific order
const order = await ctx.orders.get(nonce);
console.log(order.status);        // "open" | "filled" | "cancelled" | "expired" | "voided"
console.log(order.percentFilled); // 0-100

// List your open orders
const myOrders = await ctx.orders.mine(market.id);

// Auto-paginate all your orders
const allMyOrders = await ctx.orders.allMine();
```

### Cancel an Order

```typescript
const result = await ctx.orders.cancel(nonce);
// result.success — true if cancelled
// result.alreadyCancelled — true if was already cancelled
```

### Cancel and Replace (Atomic)

```typescript
const result = await ctx.orders.cancelReplace(oldNonce, {
  marketId: market.id,
  outcome: "yes",
  side: "buy",
  priceCents: 50,  // new price
  size: 10,
});
// result.cancel — cancel result
// result.create — new order result
```

### Bulk Operations

```typescript
// Place multiple orders
const results = await ctx.orders.bulkCreate([
  { marketId: id, outcome: "yes", side: "buy", priceCents: 40, size: 5 },
  { marketId: id, outcome: "yes", side: "buy", priceCents: 35, size: 5 },
]);

// Cancel multiple orders
await ctx.orders.bulkCancel([nonce1, nonce2, nonce3]);

// Mixed: create some + cancel some
const result = await ctx.orders.bulk(
  [{ marketId: id, outcome: "no", side: "buy", priceCents: 55, size: 10 }],
  [oldNonce1, oldNonce2],
);
```

## Error Handling

### Three Error Types

```typescript
import { ContextApiError, ContextSigningError, ContextConfigError } from "@contextwtf/sdk";

try {
  await ctx.orders.create({ ... });
} catch (e) {
  if (e instanceof ContextConfigError) {
    // Missing signer. Initialize client with a signer.
  } else if (e instanceof ContextSigningError) {
    // EIP-712 signing failed. Check private key format.
  } else if (e instanceof ContextApiError) {
    // API returned an error
    console.log(e.status);  // HTTP status code
    console.log(e.body);    // Response body with details
  }
}
```

### Common API Errors

| Status | Cause |
|--------|-------|
| 400 | Invalid request (bad marketId, price out of range, etc.) |
| 401 | Invalid or missing API key |
| 404 | Market or order not found |
| 429 | Rate limited |

### Voided Orders

Orders can be voided after placement. Check `order.voidReason`:

| Reason | Fix |
|--------|-----|
| `MISSING_OPERATOR_APPROVAL` | Call `ctx.account.setup()` first |
| `UNDER_COLLATERALIZED` | Deposit more USDC with `ctx.account.deposit()` |
| `UNFILLED_MARKET_ORDER` | Normal for market orders that can't fill |

## Polling & Monitoring

### Watch Price Changes

```typescript
const previousPrices = new Map<string, number>();

async function poll() {
  const { markets } = await ctx.markets.list({ status: "active", limit: 10 });

  for (const m of markets) {
    const book = await ctx.markets.orderbook(m.id);
    if (book.bids.length > 0 && book.asks.length > 0) {
      const mid = (book.bids[0].price + book.asks[0].price) / 2;
      const prev = previousPrices.get(m.id);
      if (prev !== undefined && mid !== prev) {
        console.log(`${m.shortQuestion}: ${prev}¢ -> ${mid}¢`);
      }
      previousPrices.set(m.id, mid);
    }
  }
}

setInterval(poll, 10_000);
```

### Monitor Order Fills

```typescript
async function waitForFill(nonce: Hex, intervalMs = 5000): Promise<Order> {
  while (true) {
    const order = await ctx.orders.get(nonce);
    if (order.status !== "open") return order;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

## Gotchas & Pitfalls

1. **Must call `setup()` before first trade.** Otherwise orders are voided. Check `status.needsApprovals`.
2. **Prices are cents, not decimals.** Pass `45`, not `0.45`. Range is 1-99.
3. **`mintTestUsdc()` is testnet only.** It calls the API; it's not an on-chain faucet.
4. **The SDK never reads env vars.** Always pass `apiKey` and `signer` explicitly in `ContextClientOptions`.
5. **`deposit()` and `withdraw()` wait for receipt.** These are blocking — they wait for the on-chain transaction to confirm before returning.
6. **Order nonces are `Hex` strings.** Save the nonce from `create()` result to cancel later.
7. **`listAll()` and `allMine()` auto-paginate.** Use these instead of manual cursor loops when you need all results.
8. **Parallel requests are safe.** You can fetch multiple markets/quotes/orderbooks concurrently with `Promise.all()`.
9. **Forward-compatible types.** All SDK types include `[key: string]: unknown` index signatures. The API may return additional fields not in the type definitions.
````

**Step 2: Verify**

```bash
wc -l skills/patterns.md
```

Expected: ~250 lines

**Step 3: Commit**

```bash
git add skills/patterns.md
git commit -m "feat: add SDK patterns guide for agent skill"
```

---

### Task 4: Create examples.md

**Files:**
- Create: `skills/examples.md`

**Step 1: Write examples.md**

Create `skills/examples.md` with the following exact content:

````markdown
# Context SDK — Complete Examples

Copy-paste-ready scripts for common project types. Each example is self-contained.

## 1. Read-Only Market Scanner

No auth needed. Lists active markets with quotes.

```typescript
import { ContextClient } from "@contextwtf/sdk";

async function main() {
  const ctx = new ContextClient();

  const { markets } = await ctx.markets.list({ status: "active", limit: 10 });

  for (const m of markets) {
    const quotes = await ctx.markets.quotes(m.id);
    const yesPrice = quotes.yes.last ?? quotes.yes.bid ?? "—";
    const noPrice = quotes.no.last ?? quotes.no.bid ?? "—";

    console.log(`${m.question}`);
    console.log(`  YES: ${yesPrice}¢  NO: ${noPrice}¢  Spread: ${quotes.spread ?? "—"}¢`);
    console.log(`  Volume: $${m.volume}  Participants: ${m.participantCount}`);
    console.log();
  }
}

main().catch(console.error);
```

## 2. Place a Buy Order (Full Flow)

Complete trading flow: init, wallet setup, deposit, place, check, cancel.

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

async function main() {
  const ctx = new ContextClient({
    apiKey: process.env.CONTEXT_API_KEY!,
    signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as Hex },
  });

  console.log(`Wallet: ${ctx.address}`);

  // Ensure wallet is ready
  const status = await ctx.account.status();
  if (status.needsApprovals) {
    console.log("Setting up wallet...");
    await ctx.account.setup();
  }

  // Ensure we have USDC
  const balance = await ctx.portfolio.balance();
  if (BigInt(balance.usdc.settlementBalance) === 0n) {
    console.log("Minting and depositing test USDC...");
    await ctx.account.mintTestUsdc(1000);
    await ctx.account.deposit(1000);
  }

  // Find a market
  const { markets } = await ctx.markets.list({ status: "active", limit: 1 });
  if (markets.length === 0) throw new Error("No active markets");

  const market = markets[0];
  console.log(`Trading: ${market.question}`);

  // Place order
  const result = await ctx.orders.create({
    marketId: market.id,
    outcome: "yes",
    side: "buy",
    priceCents: 25,
    size: 5,
  });
  console.log(`Order placed: ${result.order.nonce}`);
  console.log(`Status: ${result.order.status}`);

  // Check our orders
  const myOrders = await ctx.orders.mine(market.id);
  console.log(`Open orders: ${myOrders.orders.length}`);

  // Cancel
  const cancel = await ctx.orders.cancel(result.order.nonce);
  console.log(`Cancelled: ${cancel.success}`);
}

main().catch(console.error);
```

## 3. Portfolio Dashboard Data

Fetches all data needed for a portfolio view.

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

async function main() {
  const ctx = new ContextClient({
    apiKey: process.env.CONTEXT_API_KEY!,
    signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as Hex },
  });

  // Fetch portfolio, balance, and claimable in parallel
  const [portfolio, balance, claimable, stats] = await Promise.all([
    ctx.portfolio.get(),
    ctx.portfolio.balance(),
    ctx.portfolio.claimable(),
    ctx.portfolio.stats(),
  ]);

  // Portfolio value
  console.log(`Portfolio value: $${stats.currentPortfolioValue}`);
  console.log(`Change: ${stats.currentPortfolioPercentChange}%`);

  // USDC balance
  console.log(`\nUSDC:`);
  console.log(`  Wallet: ${balance.usdc.walletBalance}`);
  console.log(`  Settlement: ${balance.usdc.settlementBalance}`);

  // Active positions
  console.log(`\nPositions: ${portfolio.portfolio.length}`);
  for (const pos of portfolio.portfolio) {
    console.log(`  ${pos.outcomeName} in ${pos.marketId.slice(0, 8)}...`);
    console.log(`    Balance: ${pos.balance}  Value: $${pos.currentValue}`);
  }

  // Claimable from resolved markets
  if (claimable.positions.length > 0) {
    console.log(`\nClaimable: $${claimable.totalClaimable}`);
    for (const pos of claimable.positions) {
      console.log(`  ${pos.outcomeName}: $${pos.claimableAmount}`);
    }
  }
}

main().catch(console.error);
```

## 4. Market Monitoring Loop

Polls markets and detects price changes.

```typescript
import { ContextClient } from "@contextwtf/sdk";

async function main() {
  const ctx = new ContextClient();
  const POLL_INTERVAL = 10_000;

  const { markets } = await ctx.markets.list({ status: "active", limit: 5 });
  if (markets.length === 0) return;

  console.log(`Monitoring ${markets.length} markets...\n`);
  const prices = new Map<string, number>();

  async function poll() {
    for (const m of markets) {
      const book = await ctx.markets.orderbook(m.id);

      if (book.bids.length > 0 && book.asks.length > 0) {
        const mid = (book.bids[0].price + book.asks[0].price) / 2;
        const prev = prices.get(m.id);
        const delta = prev !== undefined ? (mid - prev).toFixed(1) : "new";
        const arrow = prev !== undefined
          ? mid > prev ? "^" : mid < prev ? "v" : "="
          : " ";

        console.log(`${arrow} ${m.shortQuestion?.slice(0, 40).padEnd(40)} mid=${mid.toFixed(1)}¢ (${delta})`);
        prices.set(m.id, mid);
      }
    }
    console.log();
  }

  await poll();
  setInterval(poll, POLL_INTERVAL);
}

main().catch(console.error);
```

## 5. Bulk Operations

Place multiple orders, then cancel them all.

```typescript
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

async function main() {
  const ctx = new ContextClient({
    apiKey: process.env.CONTEXT_API_KEY!,
    signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as Hex },
  });

  const { markets } = await ctx.markets.list({ status: "active", limit: 1 });
  if (markets.length === 0) throw new Error("No active markets");

  const marketId = markets[0].id;

  // Place a ladder of buy orders at different prices
  const orders = [30, 35, 40, 45].map((priceCents) => ({
    marketId,
    outcome: "yes" as const,
    side: "buy" as const,
    priceCents,
    size: 5,
  }));

  console.log(`Placing ${orders.length} orders...`);
  const results = await ctx.orders.bulkCreate(orders);

  for (const r of results) {
    console.log(`  ${r.order.nonce}: ${r.success ? "placed" : "failed"}`);
  }

  // Cancel all of them
  const nonces = results.map((r) => r.order.nonce);
  console.log(`\nCancelling ${nonces.length} orders...`);
  const cancels = await ctx.orders.bulkCancel(nonces);

  for (const c of cancels) {
    console.log(`  ${c.success ? "cancelled" : "failed"}`);
  }
}

main().catch(console.error);
```

## 6. Orderbook Analysis

Fetch and analyze orderbook depth, spread, and liquidity.

```typescript
import { ContextClient } from "@contextwtf/sdk";

async function main() {
  const ctx = new ContextClient();

  const { markets } = await ctx.markets.list({ status: "active", limit: 5 });

  for (const m of markets) {
    const book = await ctx.markets.orderbook(m.id);

    console.log(`=== ${m.shortQuestion || m.question} ===`);

    if (book.bids.length === 0 || book.asks.length === 0) {
      console.log("  No liquidity\n");
      continue;
    }

    // Spread
    const bestBid = book.bids[0].price;
    const bestAsk = book.asks[0].price;
    const spread = bestAsk - bestBid;
    const mid = (bestBid + bestAsk) / 2;

    console.log(`  Best bid: ${bestBid}¢  Best ask: ${bestAsk}¢`);
    console.log(`  Spread: ${spread.toFixed(1)}¢  Mid: ${mid.toFixed(1)}¢`);

    // Depth
    const bidDepth = book.bids.reduce((sum, l) => sum + l.size, 0);
    const askDepth = book.asks.reduce((sum, l) => sum + l.size, 0);
    console.log(`  Bid depth: ${bidDepth} contracts (${book.bids.length} levels)`);
    console.log(`  Ask depth: ${askDepth} contracts (${book.asks.length} levels)`);

    // Crossed book check
    if (bestBid >= bestAsk) {
      console.log("  *** CROSSED BOOK ***");
    }

    console.log();
  }
}

main().catch(console.error);
```
````

**Step 2: Verify**

```bash
wc -l skills/examples.md
```

Expected: ~230 lines

**Step 3: Commit**

```bash
git add skills/examples.md
git commit -m "feat: add SDK examples for agent skill"
```

---

### Task 5: Final commit and verify

**Step 1: Verify all files exist**

```bash
ls -la skills/
```

Expected output should show 4 files: `SKILL.md`, `api-reference.md`, `patterns.md`, `examples.md`

**Step 2: Verify total line counts**

```bash
wc -l skills/*.md
```

Expected: ~900-1000 total lines across all files

**Step 3: Squash into a single commit (optional)**

If preferred, squash the 4 commits into one:

```bash
git add skills/
git commit -m "feat: add Context SDK agent skill for AI coding assistants

Adds skills/ folder with 4 markdown files that teach any AI agent how to
build projects on Context Markets using @contextwtf/sdk:

- SKILL.md: entry point with quickstart and critical rules
- api-reference.md: complete method signatures and types
- patterns.md: wallet onboarding, order lifecycle, error handling, gotchas
- examples.md: 6 copy-paste-ready scripts"
```
