# Context SDK Agent Skill -- Design Document

**Date:** 2026-02-15
**Goal:** Create a universal skill that helps any AI coding agent (Claude Code, Codex, Cursor, etc.) understand and build complete projects on Context Markets using the SDK.

## Format Decision

Universal markdown first. The skill is a set of markdown files that any agent can consume. It also works as a Claude Code skill (with SKILL.md frontmatter) for bonus features like auto-invocation.

## Structure

```
skills/
├── SKILL.md              # Entry point: quickstart + navigation (~150 lines)
├── api-reference.md      # Full SDK method signatures & types (~300 lines)
├── patterns.md           # Common patterns & recipes (~250 lines)
└── examples.md           # Complete working examples (~200 lines)
```

Top-level `skills/` folder in the SDK repo.

## File Details

### SKILL.md (Entry Point)

Frontmatter for Claude Code compatibility:
```yaml
name: context-sdk
description: Build projects on Context Markets prediction market API using the @contextwtf/sdk.
```

Content:
1. **What is this** -- One paragraph: Context Markets is a prediction market on Base Sepolia. The SDK wraps it.
2. **Install & Init** -- `bun add @contextwtf/sdk` + two code blocks (read-only client, trading client with signer)
3. **Core Concepts** -- The 4 modules: `markets` (read data), `orders` (trade), `portfolio` (positions/balance), `account` (wallet ops)
4. **Critical Rules** -- Prices in cents (1-99), outcomes "yes"/"no", sides "buy"/"sell", read ops need no auth, writes need signer, Base Sepolia only, single dep: viem
5. **Quick Recipes** -- 3 minimal snippets: list markets, get quotes, place an order
6. **Navigation** -- Links to supporting files

### api-reference.md

Complete method catalog organized by module. Each method gets:
- Signature with parameter types
- Return type
- One-liner description
- Auth requirement (none / apiKey / signer)

Sections:
1. ContextClient constructor + ContextClientOptions + 3 signer formats
2. ctx.markets -- all methods
3. ctx.orders -- read methods + write methods
4. ctx.portfolio -- all methods
5. ctx.account -- all methods
6. Key Types -- Market, PlaceOrderRequest, Order, Position, Balance, error types
7. Pagination -- cursors, listAll() helpers

### patterns.md

Common patterns across all project types:

1. **Client Setup Patterns** -- Read-only vs trading, signer resolution from env vars, when to use each signer format
2. **Wallet Onboarding Flow** -- status() -> setup() -> mintTestUsdc() -> deposit(). The #1 gotcha.
3. **Market Discovery** -- Search/filter, pagination with cursors, batch-fetching with Promise.all()
4. **Order Lifecycle** -- Place -> monitor -> cancel/replace. Nonces for cancellation. Expiry defaults.
5. **Error Handling** -- ContextApiError, ContextSigningError, ContextConfigError
6. **Polling & Monitoring** -- Watching prices, checking fills, monitoring portfolio
7. **Gotchas & Pitfalls** -- Must setup() first, cents not decimals, testnet only for mint, no env var reading

### examples.md

Complete, copy-paste-ready scripts (~20-40 lines each):

1. **Read-Only Market Scanner** -- List active markets, fetch quotes, print summary
2. **Place a Buy Order** -- Init with signer -> wallet setup -> deposit -> place -> check status
3. **Portfolio Dashboard Data** -- Positions, balance, claimable amounts
4. **Market Monitoring Loop** -- Poll interval, detect price changes, log activity
5. **Bulk Operations** -- Bulk place, cancel, cancel-and-replace
6. **Orderbook Analysis** -- Fetch book, calculate spread, depth at levels

## Scope

- SDK TypeScript API only (no raw HTTP / OpenAPI)
- Covers all project types: trading bots, dashboards, analytics, full-stack apps
- Agent-agnostic: works for Claude Code, Codex, Cursor, Copilot, or any LLM agent

## Non-Goals

- Not a human tutorial (agents learn differently)
- Not an OpenAPI reference (agents use the SDK, not raw HTTP)
- Not a viem/blockchain tutorial (agents can look that up separately)
