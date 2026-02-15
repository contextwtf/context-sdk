# API Reference -- @contextwtf/sdk

Complete reference for all public classes, methods, types, and constants exported by the SDK.

---

## ContextClient

The main entry point. Instantiate once and access modules via properties.

```ts
import { ContextClient } from "@contextwtf/sdk";

const ctx = new ContextClient(options?: ContextClientOptions);
```

### ContextClientOptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | `string` | No | Bearer token for authenticated endpoints |
| `baseUrl` | `string` | No | Override API base URL (default: `https://api-testnet.context.markets/v2`) |
| `signer` | `SignerInput` | No | Required for write operations (orders, account) |

### SignerInput (3 formats)

```ts
// Option 1: Raw private key
{ privateKey: "0x..." }

// Option 2: viem Account object
{ account: viemAccount }

// Option 3: viem WalletClient
{ walletClient: viemWalletClient }
```

All three are normalized internally into `{ account, walletClient }` via `resolveSigner()`.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `ctx.address` | `Address \| null` | Signer's on-chain address, or `null` if no signer provided |
| `ctx.markets` | `Markets` | Market data module (read-only) |
| `ctx.orders` | `Orders` | Order placement and management |
| `ctx.portfolio` | `PortfolioModule` | Positions and balances |
| `ctx.account` | `AccountModule` | On-chain wallet operations |

---

## ctx.markets

All methods are read-only. No signer or API key required.

### markets.list

```ts
async list(params?: SearchMarketsParams): Promise<MarketList>
```

List and search markets with filtering and pagination.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` | -- | Free-text search |
| `status` | `"active" \| "pending" \| "resolved" \| "closed"` | -- | Filter by market status |
| `sortBy` | `"new" \| "volume" \| "trending" \| "ending" \| "chance"` | -- | Sort field |
| `sort` | `"asc" \| "desc"` | -- | Sort direction |
| `limit` | `number` | -- | Page size |
| `cursor` | `string` | -- | Pagination cursor from previous response |
| `visibility` | `"visible" \| "hidden" \| "all"` | -- | Visibility filter |
| `resolutionStatus` | `string` | -- | Resolution status filter |
| `creator` | `string` | -- | Filter by creator address |
| `category` | `string` | -- | Filter by category |
| `createdAfter` | `string` | -- | ISO timestamp lower bound |

**Returns:**

```ts
{
  markets: Market[];
  cursor: string | null;  // pass to next call for pagination
}
```

### markets.get

```ts
async get(id: string): Promise<Market>
```

Get a single market by ID. Returns the `Market` object directly (unwrapped from `{ market }`).

### markets.quotes

```ts
async quotes(marketId: string): Promise<Quotes>
```

Get current bid/ask/last prices for both outcomes.

**Returns:**

```ts
{
  marketId: string;
  yes: { bid: number | null; ask: number | null; last: number | null };
  no:  { bid: number | null; ask: number | null; last: number | null };
  spread: number | null;
  timestamp: string;
}
```

### markets.orderbook

```ts
async orderbook(marketId: string, params?: GetOrderbookParams): Promise<Orderbook>
```

Get the orderbook for a market.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `depth` | `number` | -- | Number of price levels |
| `outcomeIndex` | `number` | -- | Filter to specific outcome (0 or 1) |

**Returns:**

```ts
{
  marketId: string;
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  timestamp: string;
}
```

### markets.simulate

```ts
async simulate(marketId: string, params: SimulateTradeParams): Promise<SimulateResult>
```

Simulate a trade to estimate fill price and slippage. This is a POST request.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `side` | `"yes" \| "no"` | **required** | Outcome side |
| `amount` | `number` | **required** | Trade amount |
| `amountType` | `"usd" \| "contracts"` | `"usd"` | Unit for amount |
| `trader` | `string` | -- | Trader address (for collateral checks) |

**Returns:**

```ts
{
  marketId: string;
  side: string;
  amount: number;
  amountType: string;
  estimatedContracts: number;
  estimatedAvgPrice: number;
  estimatedSlippage: number;
}
```

### markets.priceHistory

```ts
async priceHistory(marketId: string, params?: GetPriceHistoryParams): Promise<PriceHistory>
```

Get historical price data for a market.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `timeframe` | `"1h" \| "6h" \| "1d" \| "1w" \| "1M" \| "all"` | -- | Time window |

**Returns:**

```ts
{
  prices: { time: number; price: number }[];
  startTime: number;
  endTime: number;
  interval: number;
}
```

### markets.oracle

```ts
async oracle(marketId: string): Promise<OracleResponse>
```

Get oracle resolution data for a market.

**Returns:**

```ts
{
  oracle: {
    lastCheckedAt: string | null;
    confidenceLevel: string | null;
    evidenceCollected: {
      postsCount: number;
      relevantPosts: string[];
    };
    sourcesMonitored: string[];
    summary: {
      decision: string;
      shortSummary: string;
      expandedSummary: string;
    };
  }
}
```

### markets.oracleQuotes

```ts
async oracleQuotes(marketId: string): Promise<OracleQuotesResponse>
```

Get all oracle probability quotes for a market.

**Returns:**

```ts
{
  quotes: {
    id: number;
    status: string;
    probability: number | null;
    confidence: "low" | "medium" | "high" | null;
    reasoning: string | null;
    referenceMarketsCount: number;
    createdAt: string;
    completedAt: string | null;
  }[]
}
```

### markets.requestOracleQuote

```ts
async requestOracleQuote(marketId: string): Promise<OracleQuoteRequestResult>
```

Request a new oracle probability quote. This is a POST request.

**Returns:**

```ts
{
  id: number;
  status: string;
  createdAt: string;
}
```

### markets.activity

```ts
async activity(marketId: string, params?: GetActivityParams): Promise<ActivityResponse>
```

Get activity feed for a specific market.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `cursor` | `string` | -- | Pagination cursor |
| `limit` | `number` | -- | Page size |
| `types` | `string` | -- | Comma-separated activity type filter |
| `startTime` | `string` | -- | ISO timestamp lower bound |
| `endTime` | `string` | -- | ISO timestamp upper bound |

**Returns:**

```ts
{
  marketId: string | null;
  activity: ActivityItem[];
  pagination?: { cursor: string | null; hasMore: boolean };
}
```

### markets.globalActivity

```ts
async globalActivity(params?: GetActivityParams): Promise<ActivityResponse>
```

Get the global activity feed across all markets. Same parameters and return type as `activity`.

---

## ctx.orders

Read methods work without a signer. Write methods (`create`, `cancel`, `cancelReplace`, `bulkCreate`, `bulkCancel`, `bulk`) throw `ContextConfigError` if no signer was provided.

### orders.list

```ts
async list(params?: GetOrdersParams): Promise<OrderList>
```

List orders with filtering and pagination.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `trader` | `Address` | -- | Filter by trader address |
| `marketId` | `string` | -- | Filter by market |
| `status` | `"open" \| "filled" \| "cancelled" \| "expired" \| "voided"` | -- | Filter by status |
| `cursor` | `string` | -- | Pagination cursor |
| `limit` | `number` | -- | Page size |

**Returns:**

```ts
{
  orders: Order[];
  markets?: Record<string, { shortQuestion: string; slug: string }>;
  cursor: string | null;
}
```

### orders.listAll

```ts
async listAll(params?: Omit<GetOrdersParams, "cursor">): Promise<Order[]>
```

Auto-paginate through all orders matching the filter. Returns a flat array. Same params as `list` except `cursor` (handled internally).

### orders.mine

```ts
async mine(marketId?: string): Promise<OrderList>
```

List orders for the connected signer's address. Requires signer. Optionally filter by `marketId`.

### orders.allMine

```ts
async allMine(marketId?: string): Promise<Order[]>
```

Auto-paginate all orders for the connected signer's address. Requires signer.

### orders.get

```ts
async get(id: string): Promise<Order>
```

Get a single order by nonce/ID. Returns the `Order` object directly (unwrapped from `{ order }`).

### orders.recent

```ts
async recent(params?: GetRecentOrdersParams): Promise<OrderList>
```

Get recently placed orders within a time window.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `trader` | `Address` | -- | Filter by trader |
| `marketId` | `string` | -- | Filter by market |
| `status` | `OrderStatus` | -- | Filter by status |
| `limit` | `number` | -- | Max results |
| `windowSeconds` | `number` | -- | Lookback window in seconds |

### orders.simulate

```ts
async simulate(params: OrderSimulateParams): Promise<OrderSimulateResult>
```

Simulate an order against the current orderbook. This is a POST request.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `marketId` | `string` | Yes | Target market |
| `trader` | `string` | Yes | Trader address |
| `maxSize` | `string` | Yes | Maximum fill size (on-chain encoded) |
| `maxPrice` | `string` | Yes | Maximum fill price (on-chain encoded) |
| `outcomeIndex` | `number` | Yes | Outcome (0 or 1) |
| `side` | `"bid" \| "ask"` | Yes | Order side |

**Returns:**

```ts
{
  levels: {
    price: string;
    sizeAvailable: string;
    cumulativeSize: string;
    takerFee: string;
    cumulativeTakerFee: string;
    collateralRequired: string;
    cumulativeCollateral: string;
    makerCount: number;
  }[];
  summary: {
    fillSize: string;
    fillCost: string;
    takerFee: string;
    weightedAvgPrice: string;
    totalLiquidityAvailable: string;
    percentFillable: number;
    slippageBps: number;
  };
  collateral: {
    balance: string;
    outcomeTokenBalance: string;
    requiredForFill: string;
    isSufficient: boolean;
  };
  warnings: string[];
}
```

### orders.create

```ts
async create(req: PlaceOrderRequest): Promise<CreateOrderResult>
```

Place a new order. **Requires signer and API key.**

The SDK handles EIP-712 signing automatically -- pass human-friendly values.

#### PlaceOrderRequest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `marketId` | `string` | Yes | Target market ID |
| `outcome` | `"yes" \| "no"` | Yes | Which outcome to trade |
| `side` | `"buy" \| "sell"` | Yes | Buy or sell |
| `priceCents` | `number` | Yes | Price in cents (1-99) |
| `size` | `number` | Yes | Number of shares (min 0.01) |
| `expirySeconds` | `number` | No | Order TTL in seconds (default: 3600) |

**Returns:**

```ts
{
  success: boolean;
  order: Order;
}
```

### orders.cancel

```ts
async cancel(nonce: Hex): Promise<CancelResult>
```

Cancel an open order by its nonce. **Requires signer.**

**Returns:**

```ts
{
  success: boolean;
  alreadyCancelled?: boolean;
}
```

### orders.cancelReplace

```ts
async cancelReplace(cancelNonce: Hex, newOrder: PlaceOrderRequest): Promise<CancelReplaceResult>
```

Atomically cancel an existing order and place a new one. **Requires signer.**

**Returns:**

```ts
{
  cancel: { success: boolean; trader: string; nonce: string; alreadyCancelled?: boolean };
  create: { success: boolean; order: Order };
}
```

### orders.bulkCreate

```ts
async bulkCreate(orders: PlaceOrderRequest[]): Promise<CreateOrderResult[]>
```

Place multiple orders in a single request. **Requires signer.**

### orders.bulkCancel

```ts
async bulkCancel(nonces: Hex[]): Promise<CancelResult[]>
```

Cancel multiple orders in a single request. **Requires signer.**

### orders.bulk

```ts
async bulk(creates: PlaceOrderRequest[], cancelNonces: Hex[]): Promise<BulkResult>
```

Mixed bulk operation: create and cancel orders in a single request. **Requires signer.**

**Returns:**

```ts
{
  results: Array<
    | { type: "create"; success: boolean; order: Order }
    | { type: "cancel"; success: boolean; trader: string; nonce: string; alreadyCancelled: boolean }
  >;
}
```

---

## ctx.portfolio

Methods that accept an optional `address` parameter will use the signer's address as default when omitted. If no signer is configured and no address is passed, an error is thrown.

### portfolio.get

```ts
async get(address?: Address, params?: GetPortfolioParams): Promise<Portfolio>
```

Get portfolio positions for an address.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `address` | `Address` | signer address | Wallet to query |
| `params.kind` | `"all" \| "active" \| "won" \| "lost" \| "claimable"` | -- | Filter position type |
| `params.marketId` | `string` | -- | Filter by market |
| `params.cursor` | `string` | -- | Pagination cursor |
| `params.pageSize` | `number` | -- | Page size |

**Returns:**

```ts
{
  portfolio: Position[];
  marketIds: string[];
  cursor: string | null;
}
```

**Position shape:**

```ts
{
  tokenAddress: string;
  balance: string;
  settlementBalance: string;
  walletBalance: string;
  outcomeIndex: number;
  outcomeName: string;
  marketId: string;
  netInvestment: string;
  currentValue: string;
  tokensRedeemed: string;
}
```

### portfolio.claimable

```ts
async claimable(address?: Address): Promise<ClaimableResponse>
```

Get claimable (redeemable) positions from resolved markets.

**Returns:**

```ts
{
  positions: ClaimablePosition[];
  markets: ClaimableMarket[];
  totalClaimable: string;
}
```

### portfolio.stats

```ts
async stats(address?: Address): Promise<PortfolioStats>
```

Get portfolio summary statistics.

**Returns:**

```ts
{
  currentPortfolioValue: string;
  currentPortfolioPercentChange: number;
}
```

### portfolio.balance

```ts
async balance(address?: Address): Promise<Balance>
```

Get USDC and outcome token balances.

**Returns:**

```ts
{
  address: Address;
  usdc: {
    tokenAddress: string;
    balance: string;
    settlementBalance: string;
    walletBalance: string;
  };
  outcomeTokens: {
    tokenAddress: string;
    marketId: string;
    outcomeIndex: number;
    outcomeName: string;
    balance: string;
    settlementBalance: string;
    walletBalance: string;
  }[];
}
```

### portfolio.tokenBalance

```ts
async tokenBalance(address: Address, tokenAddress: Address): Promise<TokenBalance>
```

Get balance for a specific token. Both parameters are required (no default address fallback).

**Returns:**

```ts
{
  balance: string;
  decimals: number;
  symbol: string;
}
```

---

## ctx.account

All methods require a signer. On-chain methods (`setup`, `deposit`, `withdraw`, `mintCompleteSets`, `burnCompleteSets`) send transactions on Base Sepolia and wait for confirmation. The `mintTestUsdc` method is an API call (testnet faucet).

### account.status

```ts
async status(): Promise<WalletStatus>
```

Read on-chain approval state. Checks ETH balance, USDC allowance to Holdings, and operator approval for Settlement.

**Returns:**

```ts
{
  address: Address;
  ethBalance: bigint;
  usdcAllowance: bigint;
  isOperatorApproved: boolean;
  needsApprovals: boolean;  // true if usdcAllowance === 0n || !isOperatorApproved
}
```

### account.setup

```ts
async setup(): Promise<WalletSetupResult>
```

One-call wallet setup. Sends up to two transactions:
1. USDC `approve(Holdings, maxUint256)` -- if allowance is zero
2. Holdings `setOperator(Settlement, true)` -- if not already approved

**Returns:**

```ts
{
  usdcApprovalTx: Hex | null;      // tx hash, or null if already approved
  operatorApprovalTx: Hex | null;   // tx hash, or null if already set
}
```

### account.mintTestUsdc

```ts
async mintTestUsdc(amount?: number): Promise<unknown>
```

Mint test USDC via the testnet faucet API. Default amount is 1000.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `amount` | `number` | `1000` | USDC amount to mint |

### account.deposit

```ts
async deposit(amount: number): Promise<Hex>
```

Deposit USDC from wallet into the Holdings contract. Amount is in USDC units (converted to 6 decimals internally). Waits for transaction receipt. Returns the transaction hash.

### account.withdraw

```ts
async withdraw(amount: number): Promise<Hex>
```

Withdraw USDC from Holdings contract back to wallet. Amount is in USDC units. Waits for transaction receipt. Returns the transaction hash.

### account.mintCompleteSets

```ts
async mintCompleteSets(marketId: string, amount: number): Promise<Hex>
```

Mint a complete set of outcome tokens for a market using USDC from Holdings. Amount is in USDC units. Returns the transaction hash.

### account.burnCompleteSets

```ts
async burnCompleteSets(marketId: string, amount: number, creditInternal?: boolean): Promise<Hex>
```

Burn a complete set of outcome tokens back into USDC.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `marketId` | `string` | **required** | Market ID |
| `amount` | `number` | **required** | Amount in USDC units |
| `creditInternal` | `boolean` | `true` | Credit USDC to Holdings (true) or external wallet (false) |

Returns the transaction hash.

### account.relayOperatorApproval

```ts
async relayOperatorApproval(req: GaslessOperatorRequest): Promise<GaslessOperatorResult>
```

Submit a gasless (meta-transaction) operator approval via the relayer API.

**GaslessOperatorRequest:**

| Field | Type | Description |
|-------|------|-------------|
| `user` | `Address` | User address |
| `approved` | `boolean` | Approval state (optional, defaults to true) |
| `nonce` | `string` | Permit nonce |
| `deadline` | `string` | Permit deadline |
| `signature` | `Hex` | EIP-712 signature |

**Returns:**

```ts
{
  success: true;
  txHash: Hex;
  user: Address;
  operator: Address;
  relayer: Address;
}
```

### account.relayDeposit

```ts
async relayDeposit(req: GaslessDepositRequest): Promise<GaslessDepositResult>
```

Submit a gasless deposit-with-permit via the relayer API.

**GaslessDepositRequest:**

| Field | Type | Description |
|-------|------|-------------|
| `user` | `Address` | User address |
| `amount` | `string` | Deposit amount |
| `nonce` | `string` | Permit nonce |
| `deadline` | `string` | Permit deadline |
| `signature` | `Hex` | EIP-712 signature |

**Returns:**

```ts
{
  success: true;
  txHash: Hex;
  user: Address;
  token: Address;
  amount: string;
  relayer: Address;
}
```

---

## Key Types

### Market

```ts
interface Market {
  id: string;
  question: string;
  shortQuestion: string;
  oracle: string;
  outcomeTokens: string[];
  outcomePrices: OutcomePrice[];
  creator: string;
  creatorProfile: { username: string | null; avatarUrl: string | null } | null;
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
  [key: string]: unknown;  // forward-compatibility
}
```

### Order

```ts
interface Order {
  nonce: Hex;
  marketId: string;
  trader: Address;
  outcomeIndex: number;
  side: 0 | 1;                // 0 = buy, 1 = sell
  price: string;
  size: string;
  type: "limit" | "market";
  status: "open" | "filled" | "cancelled" | "expired" | "voided";
  insertedAt: string;
  filledSize: string;
  remainingSize: string;
  percentFilled: number;
  voidedAt: string | null;
  voidReason: "UNFILLED_MARKET_ORDER" | "UNDER_COLLATERALIZED" | "MISSING_OPERATOR_APPROVAL" | null;
  [key: string]: unknown;
}
```

### Error Types

**ContextApiError** -- thrown on non-OK HTTP responses.

```ts
class ContextApiError extends Error {
  readonly status: number;   // HTTP status code
  readonly body: unknown;    // Raw response body
}
```

**ContextSigningError** -- thrown when EIP-712 signing fails.

```ts
class ContextSigningError extends Error {
  // .cause contains the original error
}
```

**ContextConfigError** -- thrown when a required config option is missing (e.g., calling write methods without a signer).

```ts
class ContextConfigError extends Error {}
```

---

## Exported Constants

Contract addresses and chain config for Base Sepolia (chain ID 84532):

```ts
import {
  API_BASE,              // "https://api-testnet.context.markets/v2"
  SETTLEMENT_ADDRESS,    // "0xABfB9e3Dc252D59e4e4A3c3537D96F3F207C9b2c"
  HOLDINGS_ADDRESS,      // "0x769341425095155C0A0620eBC308d4C05980B84a"
  USDC_ADDRESS,          // "0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e"
  PERMIT2_ADDRESS,       // "0x000000000022D473030F116dDEE9F6B43aC78BA3"
  CHAIN_ID,              // 84532
} from "@contextwtf/sdk";
```

## Exported Encoding Utilities

Low-level helpers for on-chain value encoding. Most users will not need these -- the SDK handles encoding internally in `orders.create`.

```ts
import {
  encodePriceCents,    // (priceCents: number) => bigint    -- cents (1-99) to on-chain (x 10,000)
  decodePriceCents,    // (raw: bigint) => number           -- on-chain back to cents
  encodeSize,          // (size: number) => bigint          -- shares (min 0.01) to on-chain (x 1,000,000)
  decodeSize,          // (raw: bigint) => number           -- on-chain back to shares
  calculateMaxFee,     // (price: bigint, size: bigint) => bigint -- 1% of notional, minimum 1n
} from "@contextwtf/sdk";
```
