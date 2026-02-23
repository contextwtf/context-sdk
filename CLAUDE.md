# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # Install dependencies
bun run build            # Build ESM + CJS + types via tsup
bun run typecheck        # Type check without emitting
bun run test             # Run all tests (vitest)
bun run test -- tests/modules/markets.test.ts  # Run a single test file
```

## Architecture

This is a TypeScript SDK for the Context Markets prediction market API (Base Sepolia testnet). Single dependency: `viem`.

### Client → Modules → HTTP

`ContextClient` is the public entry point. It composes five modules, each receiving an `HttpClient` instance:

- **`Markets`** — read-only market data (list, get, quotes, orderbook, simulate, priceHistory, oracle, activity)
- **`Questions`** — question submission and market creation (submit, poll status via `submitAndWait`)
- **`Orders`** — order placement and management (requires signer for writes)
- **`PortfolioModule`** — positions and USDC balance by address
- **`AccountModule`** — on-chain wallet operations (approve, deposit, withdraw, mint/burn)

`HttpClient` (`src/http.ts`) is a thin fetch wrapper that prepends `API_BASE`, serializes query params, attaches Bearer auth, and throws `ContextApiError` on non-OK responses.

### Order Signing Pipeline

Write operations follow: `PlaceOrderRequest` → `OrderBuilder.buildAndSign()` → `SignedOrder` → POST to API.

`OrderBuilder` encodes human-friendly values (cents, shares) to on-chain BigInt representations using helpers in `src/order-builder/helpers.ts`, then signs via EIP-712 (`src/signing/eip712.ts`). The EIP-712 domain targets the Settlement contract on Base Sepolia (chain 84532).

Key encoding: prices are cents × 10,000; sizes are shares × 1,000,000; outcomes map "yes"→1, "no"→0; sides map "buy"→0, "sell"→1.

### Endpoint Registry

All API paths are centralized in `src/endpoints.ts` — modules reference these constants rather than hardcoding paths.

### Signer Resolution

`SignerInput` accepts three forms: `{ privateKey }`, `{ account }`, or `{ walletClient }`. The `resolveSigner()` function in `src/signing/eip712.ts` normalizes all three into a `{ account, walletClient }` pair.

## Testing

Tests use vitest with mock `HttpClient` instances — no network calls. Each module test verifies the correct endpoint path and params are passed to the mock. The `order-builder/helpers.test.ts` tests encoding roundtrips.

## Key Conventions

- All SDK types use index signatures (`[key: string]: unknown`) for forward compatibility with API changes
- The SDK never reads environment variables — `apiKey` and `signer` are passed programmatically via `ContextClientOptions`
- Dual-format output: ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + declaration files
