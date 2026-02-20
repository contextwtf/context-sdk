# Context SDK

[![npm](https://img.shields.io/npm/v/@contextwtf/sdk)](https://www.npmjs.com/package/@contextwtf/sdk)

TypeScript SDK for trading on [Context Markets](https://context.markets) — an AI-powered prediction market platform on Base.

For the full quickstart guide, API reference, and developer docs, visit [docs.context.markets](https://docs.context.markets).

## Install

```bash
npm install @contextwtf/sdk
```

## Quick Start

### Read Market Data (no auth)

```ts
import { ContextClient } from "@contextwtf/sdk";

const ctx = new ContextClient();

const { markets } = await ctx.markets.list({ query: "elections", status: "active" });
const book = await ctx.markets.orderbook(markets[0].id);
const oracle = await ctx.markets.oracle(markets[0].id);
```

### Place an Order

```ts
import { ContextClient } from "@contextwtf/sdk";

const ctx = new ContextClient({
  apiKey: process.env.CONTEXT_API_KEY!,
  signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as `0x${string}` },
});

await ctx.orders.create({
  marketId: "0x...",
  outcome: "yes",
  side: "buy",
  priceCents: 45,   // 45¢
  size: 10,          // 10 contracts
});
```

Need an API key? Visit [context.markets](https://context.markets) or reach out on Discord.

## API Reference

### `ctx.markets`

| Method | Description |
|--------|-------------|
| `list(params?)` | Search/filter markets |
| `get(id)` | Get market details |
| `quotes(marketId)` | Get bid/ask/last per outcome |
| `orderbook(marketId)` | Get bid/ask ladder |
| `simulate(marketId, params)` | Simulate trade for slippage |
| `priceHistory(marketId, params?)` | OHLCV candle data |
| `oracle(marketId)` | Get oracle resolution status |
| `activity(marketId)` | Market event feed |
| `globalActivity()` | Platform-wide activity |

### `ctx.orders` (requires signer)

| Method | Description |
|--------|-------------|
| `list(params?)` | Query orders with filters |
| `listAll(params?)` | Paginate through all orders |
| `mine(marketId?)` | Your open orders |
| `allMine(marketId?)` | Paginate all your orders |
| `create(req)` | Place a signed limit order |
| `cancel(nonce)` | Cancel by nonce |
| `cancelReplace(cancelNonce, newOrder)` | Atomic cancel + replace |
| `bulkCreate(orders)` | Place multiple orders |
| `bulkCancel(nonces)` | Cancel multiple orders |

### `ctx.portfolio`

| Method | Description |
|--------|-------------|
| `get(address?)` | Positions across markets (defaults to signer) |
| `balance(address?)` | USDC balance (defaults to signer) |

### `ctx.account` (requires signer)

| Method | Description |
|--------|-------------|
| `status()` | Check wallet approval status |
| `setup()` | Approve contracts for trading |
| `mintTestUsdc(amount?)` | Mint testnet USDC |
| `deposit(amount)` | Deposit USDC into Holdings |
| `withdraw(amount)` | Withdraw USDC from Holdings |
| `mintCompleteSets(marketId, amount)` | Mint YES+NO token pairs |
| `burnCompleteSets(marketId, amount)` | Burn pairs to recover USDC |

## Pricing

Prices are in **cents** (1-99). Sizes are in **contracts**. The SDK handles on-chain encoding internally.

```
45¢ = 45% probability = 0.45 USDC per contract
```

The SDK also handles outcome index mapping — pass `outcome: "yes"` or `outcome: "no"` and it converts to the correct on-chain `outcomeIndex` for you.

## Examples

```bash
npx tsx examples/basic-read.ts
CONTEXT_API_KEY=... CONTEXT_PRIVATE_KEY=0x... npx tsx examples/place-order.ts
```

| Example | Description |
|---------|-------------|
| `basic-read.ts` | Search markets, read quotes/orderbook/oracle (no auth) |
| `place-order.ts` | Place, query, and cancel orders |
| `setup-trader-wallet.ts` | Check + auto-approve wallet for trading |
| `deposit-usdc.ts` | Deposit USDC into Holdings contract |
| `audit-book.ts` | Audit all active orderbooks and open orders |
| `watch-markets.ts` | Poll and watch price changes on active markets |
| `batch-markets.ts` | Fetch quotes, orderbooks, and oracle data in parallel |

## Network

Currently targeting **Base Sepolia** (chain ID 84532) testnet.

| Contract | Address |
|----------|---------|
| USDC | `0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e` |
| Holdings | `0x2C65541078F04B56975F31153D8465edD40eC4cF` |
| Settlement | `0x67b8f94DcaF32800Fa0cD476FBD8c1D1EB2d5209` |

## Development

```bash
bun install          # Install dependencies
bun run build        # Build ESM + CJS + types
bun run typecheck    # Type check
bun run test         # Run tests
```

Requires Node 18+.
