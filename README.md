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
```

## Quick Start

```ts
import { ContextClient } from "context-markets";

const ctx = new ContextClient();

// Browse markets
const { markets } = await ctx.markets.list({ query: "elections", status: "active" });

// Get quotes
const quotes = await ctx.markets.quotes(markets[0].id);
```

```ts
// With a signer for trading
const ctx = new ContextClient({
  apiKey: process.env.CONTEXT_API_KEY!,
  signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as `0x${string}` },
});

// Place a limit order
await ctx.orders.create({
  marketId: "0x...",
  outcome: "yes",
  side: "buy",
  priceCents: 45,
  size: 10,
});
```

Need an API key? Visit [context.markets](https://context.markets) or join our [Discord](https://discord.gg/RVmzZsAyM4).

## Documentation

- **[Quickstart Guide](https://docs.context.markets/agents/typescript-sdk)** — setup, authentication, and first trade
- **[API Reference](https://docs.context.markets/agents/typescript-sdk/api-reference)** — full method signatures for all modules
- **[Best Practices](https://docs.context.markets/agents/typescript-sdk/best-practices)** — patterns, error handling, and tips
- **[Examples](./examples/)** — runnable scripts for common workflows

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
