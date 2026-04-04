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

// Get quotes, orderbook, oracle
const quotes = await ctx.markets.quotes(markets[0].id);
const book = await ctx.markets.orderbook(markets[0].id);
const oracle = await ctx.markets.oracle(markets[0].id);

// Simulate a trade before placing
const sim = await ctx.markets.simulate(markets[0].id, {
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
// One-call setup: approves USDC + operator
await ctx.account.setup();

// Deposit USDC into Holdings contract
await ctx.account.deposit(100); // 100 USDC

// Or use gasless (no ETH needed):
await ctx.account.gaslessSetup();
```

### Create a Market

```ts
const submission = await ctx.questions.submitAndWait(
  "Will BTC close above $100k by Dec 31, 2026?"
);
const { marketId } = await ctx.markets.create(submission.questions[0].id);
```

Need an API key? Visit [context.markets](https://context.markets) or join our [Discord](https://discord.gg/RVmzZsAyM4).

## Configuration

```ts
new ContextClient({
  apiKey: "ctx_pk_...",           // Required for authenticated endpoints
  baseUrl: "https://...",         // Override API base URL
  rpcUrl: "https://...",          // Override RPC URL for on-chain reads
  signer: { privateKey: "0x..." } // Required for order signing & wallet ops
})
```

The SDK accepts three signer formats: a private key string, a viem `Account` object, or a viem `WalletClient` (for browser wallets).

Prices are in **cents** (1–99). Sizes are in **contracts**. The SDK maps `"yes"` / `"no"` to the correct on-chain outcome index automatically.

## Documentation

- **[Quickstart Guide](https://docs.context.markets/agents/typescript-sdk)** — setup, authentication, and first trade
- **[API Reference](https://docs.context.markets/agents/typescript-sdk/api-reference)** — full method signatures for all modules
- **[Best Practices](https://docs.context.markets/agents/typescript-sdk/best-practices)** — patterns, error handling, and tips
- **[Examples](./examples/)** — runnable scripts for common workflows

## Ecosystem

| Package | Description |
|---------|-------------|
| **[context-markets](https://github.com/contextwtf/context-sdk)** | TypeScript SDK for trading |
| **[context-markets-react](https://github.com/contextwtf/context-react)** | React hooks for market data and trading |
| **[context-markets-mcp](https://github.com/contextwtf/context-mcp)** | MCP server for AI agents |
| **[context-markets-cli](https://github.com/contextwtf/context-cli)** | CLI for trading from the terminal |
| **[context-skills](https://github.com/contextwtf/context-skills)** | AI agent skill files |
| **[context-plugin](https://github.com/contextwtf/context-plugin)** | Claude Code plugin |

## License

MIT — see [LICENSE](./LICENSE) for details.
