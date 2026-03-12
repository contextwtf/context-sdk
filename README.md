<p align="center">
  <img src="https://mainnet.contextcdn.com/ced823d63df9dff0390d9ad0a4e1ad3905dd199a6c50758c18a5c92a203adbd7" alt="Context" width="100%" />
</p>

<h1 align="center">Context SDK</h1>
<p align="center">TypeScript SDK for trading on <a href="https://context.markets">Context Markets</a> — an AI-powered prediction market platform on Base.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/context-markets"><img src="https://img.shields.io/npm/v/context-markets" alt="npm" /></a>
  <a href="https://github.com/contextwtf/context-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" /></a>
  <a href="https://discord.gg/RVmzZsAyM4"><img src="https://img.shields.io/badge/Discord-Join-7289da" alt="Discord" /></a>
</p>

## Install

```bash
npm install context-markets
# or
yarn add context-markets
# or
pnpm add context-markets
```

## Quick Start

### Read Market Data (no auth)

```ts
import { ContextClient } from "context-markets";

const ctx = new ContextClient();

// Search and list markets
const { markets } = await ctx.markets.list({ query: "elections", status: "active" });

// Get market details
const market = await ctx.markets.get(markets[0].id);

// Get quotes, orderbook, oracle
const quotes = await ctx.markets.quotes(market.id);
const book = await ctx.markets.orderbook(market.id);
const oracle = await ctx.markets.oracle(market.id);

// Simulate a trade before placing
const sim = await ctx.markets.simulate(market.id, {
  side: "yes",
  amount: 10,
  amountType: "usd",
});
```

### Place an Order (requires signer)

```ts
import { ContextClient } from "context-markets";

const ctx = new ContextClient({
  apiKey: process.env.CONTEXT_API_KEY!,
  signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as `0x${string}` },
});

// Place a limit order: buy 10 YES contracts at 45¢
const result = await ctx.orders.create({
  marketId: "0x...",
  outcome: "yes",
  side: "buy",
  priceCents: 45,
  size: 10,
});

// Cancel it
await ctx.orders.cancel(result.order.nonce);
```

### Wallet Setup & Deposits

```ts
// Check wallet status
const status = await ctx.account.status();
console.log(status.needsApprovals); // true if approvals needed

// One-call setup: approves USDC + operator
await ctx.account.setup();

// Deposit USDC into Holdings contract
await ctx.account.deposit(100); // 100 USDC

// Or use gasless (no ETH needed):
await ctx.account.gaslessSetup();
await ctx.account.gaslessDeposit(100);
```

### Create a Market from a Question

```ts
// Submit a question and wait for AI processing
const submission = await ctx.questions.submitAndWait(
  "Will BTC close above $100k by Dec 31, 2026?"
);

// Create the on-chain market
const { marketId } = await ctx.markets.create(submission.questions[0].id);
```

Need an API key? Visit [context.markets](https://context.markets) or reach out on Discord.

## API Reference

### `ctx.markets`

| Method | Description |
|--------|-------------|
| `list(params?)` | Search/filter markets |
| `get(id)` | Get market details |
| `quotes(marketId)` | Get bid/ask/last per outcome |
| `orderbook(marketId, params?)` | Get bid/ask ladder |
| `fullOrderbook(marketId)` | Combined yes + no orderbooks |
| `simulate(marketId, params)` | Simulate a trade (slippage, avg price) |
| `priceHistory(marketId, params?)` | Price time-series data |
| `oracle(marketId)` | Oracle resolution summary |
| `oracleQuotes(marketId)` | List oracle quotes |
| `requestOracleQuote(marketId)` | Request a new oracle quote |
| `activity(marketId, params?)` | Market event feed |
| `globalActivity(params?)` | Platform-wide activity feed |
| `create(questionId)` | Create on-chain market from question |

### `ctx.questions`

| Method | Description |
|--------|-------------|
| `submit(question)` | Submit a question for AI processing |
| `getSubmission(submissionId)` | Poll submission status |
| `submitAndWait(question, options?)` | Submit and poll until complete (default ~90s timeout) |

### `ctx.orders` (requires signer for writes)

| Method | Auth | Description |
|--------|------|-------------|
| `list(params?)` | — | Query orders with filters |
| `listAll(params?)` | — | Paginate through all matching orders |
| `mine(marketId?)` | signer | Your orders (shorthand for list with your address) |
| `allMine(marketId?)` | signer | Paginate all your orders |
| `get(id)` | — | Get single order by ID |
| `recent(params?)` | — | Recent orders within time window |
| `simulate(params)` | — | Simulate order fill (levels, fees, collateral) |
| `create(req)` | signer | Place a signed limit order |
| `createMarket(req)` | signer | Place a signed market order |
| `cancel(nonce)` | signer | Cancel by nonce |
| `cancelReplace(cancelNonce, newOrder)` | signer | Atomic cancel + new order |
| `bulkCreate(orders)` | signer | Place multiple orders |
| `bulkCancel(nonces)` | signer | Cancel multiple orders |
| `bulk(creates, cancelNonces)` | signer | Mixed creates + cancels in one call |

### `ctx.portfolio`

| Method | Description |
|--------|-------------|
| `get(address?, params?)` | Positions across markets (defaults to signer) |
| `claimable(address?)` | Positions eligible for claim after resolution |
| `stats(address?)` | Portfolio value, P&L, prediction count |
| `balance(address?)` | USDC + outcome token balances |
| `tokenBalance(address, tokenAddress)` | Single token balance |

### `ctx.account` (requires signer)

| Method | Description |
|--------|-------------|
| `status()` | Check ETH balance, USDC allowance, operator approval |
| `setup()` | Approve USDC + operator in one call |
| `mintTestUsdc(amount?)` | Mint testnet USDC (default: 1000) |
| `deposit(amount)` | Deposit USDC into Holdings |
| `withdraw(amount)` | Withdraw USDC from Holdings |
| `mintCompleteSets(marketId, amount)` | Mint YES+NO token pairs |
| `burnCompleteSets(marketId, amount)` | Burn pairs to recover USDC |
| `gaslessSetup()` | Approve operator via signature relay (no ETH needed) |
| `gaslessDeposit(amount)` | Deposit via Permit2 signature relay (no ETH needed) |

## Pricing

Prices are in **cents** (1-99). Sizes are in **contracts**. The SDK handles on-chain encoding internally.

```
45¢ = 45% probability = 0.45 USDC per contract
```

The SDK maps `outcome: "yes"` / `outcome: "no"` to the correct on-chain `outcomeIndex` for you.

## Signer Options

The SDK accepts three signer formats:

```ts
// Private key (most common for scripts/bots)
new ContextClient({ signer: { privateKey: "0x..." } })

// Viem Account object
new ContextClient({ signer: { account: viemAccount } })

// Viem WalletClient (for browser wallets)
new ContextClient({ signer: { walletClient: viemWalletClient } })
```

## Configuration

```ts
new ContextClient({
  apiKey: "ctx_pk_...",           // Required for authenticated endpoints
  baseUrl: "https://...",         // Override API base URL
  rpcUrl: "https://...",          // Override RPC URL for on-chain reads
  signer: { privateKey: "0x..." } // Required for order signing & wallet ops
})
```

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

## Code Generation

Types and endpoints are auto-generated from the [OpenAPI spec](https://api-testnet.context.markets/v2/openapi.json):

```bash
bun run generate                # Regenerate from production spec
bun scripts/generate-api.ts URL # Regenerate from a custom spec URL
bun run generate:check          # Regenerate + verify no drift (CI)
```

Generated files live in `src/generated/` and are committed to git. SDK types in `src/types.ts` are aliases to the generated schemas, so they stay in sync automatically.

## Network

Currently targeting **Base Sepolia** (chain ID 84532) testnet.

| Contract | Address |
|----------|---------|
| USDC | `0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e` |
| Holdings | `0x0a6D61723E8AE8e34734A84075a1b58aB3eEca6a` |
| Settlement | `0xD91935a82Af48ff79a68134d9Eab8fc9e5d3504D` |

## Development

```bash
bun install          # Install dependencies
bun run build        # Build ESM + CJS + types
bun run typecheck    # Type check
bun run test         # Run unit tests
bun run generate     # Regenerate from OpenAPI spec
```

Requires Node 18+.

## Documentation

For the full quickstart guide, API reference, and developer docs, visit **[docs.context.markets](https://docs.context.markets/agents/typescript-sdk)**.

## Ecosystem

| Package | Description |
|---------|-------------|
| **[context-markets](https://github.com/contextwtf/context-sdk)** | TypeScript SDK for trading |
| **[@contextwtf/react](https://github.com/contextwtf/context-react)** | React hooks for market data and trading |
| **[@contextwtf/mcp](https://github.com/contextwtf/context-mcp)** | MCP server for AI agents |
| **[@contextwtf/cli](https://github.com/contextwtf/context-cli)** | CLI for trading from the terminal |
| **[context-skills](https://github.com/contextwtf/context-skills)** | AI agent skill files |
| **[context-plugin](https://github.com/contextwtf/context-plugin)** | Claude Code plugin |

## License

MIT — see [LICENSE](./LICENSE) for details.
