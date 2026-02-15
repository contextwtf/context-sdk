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
