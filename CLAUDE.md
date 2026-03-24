# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # Install dependencies
bun run build            # Build ESM + CJS + types via tsup
bun run typecheck        # Type check without emitting
bun run test             # Run unit tests (vitest)
bun run test -- tests/modules/markets.test.ts  # Run a single test file
bun run generate         # Regenerate types + endpoints from OpenAPI spec
bun run generate:check   # Regenerate and verify no drift (for CI)
```

### API Validation Tests

The `tests/api-validation.test.ts` file hits a live API. It needs env vars:

```bash
CONTEXT_API_KEY=ctx_pk_... CONTEXT_BASE_URL=http://localhost:3001/public/v2 bun run test -- tests/api-validation.test.ts
```

Unit tests (all other test files) use mocked HTTP — no network calls needed.

## Architecture

TypeScript SDK for the Context Markets prediction market API. Single runtime dependency: `viem`.

### Client → Modules → HTTP

`ContextClient` (`src/client.ts`) is the public entry point. It composes five modules, each receiving an `HttpClient` instance:

- **`Markets`** (`src/modules/markets.ts`) — read-only market data (list, get, quotes, orderbook, simulate, priceHistory, oracle, oracleQuotes, latestOracleQuote, activity, create, globalActivity)
- **`Questions`** (`src/modules/questions.ts`) — question submission and market creation (submit, getSubmission, submitAndWait, agentSubmit, agentSubmitAndWait)
- **`Orders`** (`src/modules/orders.ts`) — order placement and management (requires signer for writes: create, createMarket, cancel, cancelReplace, bulkCreate, bulkCancel, bulk; reads: list, listAll, mine, allMine, get, recent, simulate)
- **`PortfolioModule`** (`src/modules/portfolio.ts`) — positions and USDC balance by address (get, positions, claimable, stats, balance, tokenBalance, settlementBalance)
- **`AccountModule`** (`src/modules/account.ts`) — on-chain wallet operations (status, setup, mintTestUsdc, deposit, withdraw, mintCompleteSets, burnCompleteSets, gaslessSetup, gaslessDeposit, relayOperatorApproval, relayDeposit)

`HttpClient` (`src/http.ts`) is a thin fetch wrapper that prepends `API_BASE`, serializes query params, attaches Bearer auth, and throws `ContextApiError` on non-OK responses.

### OpenAPI Code Generation

Types and endpoints are auto-generated from the OpenAPI spec:

- **`scripts/generate-api.ts`** — fetches the spec, generates `src/generated/api-types.ts` (TypeScript types from schemas) and `src/generated/endpoints.ts` (ENDPOINTS constant from paths)
- **`src/generated/api-types.ts`** — raw types from `openapi-typescript`. DO NOT EDIT manually.
- **`src/generated/endpoints.ts`** — ENDPOINTS constant grouped by path prefix. DO NOT EDIT manually.
- **`src/types.ts`** — re-exports API types as `components["schemas"]["..."]` aliases, plus SDK-only types (PlaceOrderRequest, SignerInput, etc.)
- **`src/endpoints.ts`** — re-export shim from `./generated/endpoints.js`

To regenerate: `bun run generate` (uses production spec URL) or `bun scripts/generate-api.ts http://localhost:3001/public/v2/openapi.json` (local).

### Type Strategy

API response types in `src/types.ts` are aliases to generated schemas:
```typescript
export type Market = components["schemas"]["Market"];
export type OrderList = components["schemas"]["OrderList"];
```

SDK-only types (not from the API) stay handwritten in `src/types.ts`:
- Client config: `ContextClientOptions`, `SignerInput`
- Order builder inputs: `PlaceOrderRequest`, `PlaceMarketOrderRequest`
- On-chain enums: `InventoryMode`, `MakerRoleConstraint`
- Query params: `SearchMarketsParams`, `GetOrdersParams`, etc.
- Wallet types: `WalletStatus`, `WalletSetupResult`
- SDK-composed: `FullOrderbook`

### Order Signing Pipeline

Write operations follow: `PlaceOrderRequest` → `OrderBuilder.buildAndSign()` → `SignedOrder` → POST to API.

`OrderBuilder` (`src/order-builder/builder.ts`) encodes human-friendly values (cents, shares) to on-chain BigInt representations using helpers in `src/order-builder/helpers.ts`, then signs via EIP-712 (`src/signing/eip712.ts`). The EIP-712 domain targets the Settlement contract on Base Sepolia (chain 84532).

Key encoding: prices are cents × 10,000; sizes are shares × 1,000,000; outcomes map "yes"→1, "no"→0; sides map "buy"→0, "sell"→1.

### Signer Resolution

`SignerInput` accepts three forms: `{ privateKey }`, `{ account }`, or `{ walletClient }`. The `resolveSigner()` function in `src/signing/eip712.ts` normalizes all three into a `{ account, walletClient }` pair.

## Testing

Unit tests use vitest with mock `HttpClient` instances — no network calls. Each module test verifies the correct endpoint path and params are passed to the mock. The `order-builder/helpers.test.ts` tests encoding roundtrips.

API validation tests (`tests/api-validation.test.ts`) hit a live API and verify response shapes match SDK types. These require `CONTEXT_API_KEY` and optionally `CONTEXT_BASE_URL`.

## Key Conventions

- API response types are generated from the OpenAPI spec — run `bun run generate` after spec changes
- SDK-only types (client config, order inputs, query params) are handwritten in `src/types.ts`
- The SDK never reads environment variables — `apiKey`, `baseUrl`, and `signer` are passed programmatically via `ContextClientOptions`
- Dual-format output: ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + declaration files
- Endpoint registry is auto-generated and re-exported — don't edit `src/generated/` files directly

## Coding Standards

- **No `as any`** — use proper SDK types from `src/types.ts` or generated types. If the type doesn't fit, fix the type.
- **No `Math.random()` for security-related values** — use `crypto.getRandomValues()` for nonces, keys, or any value that must be unpredictable.
- **Never expose private keys** — not in return values, error messages, logs, or serialized output.
- **Use SDK error types** — throw `ContextApiError` for API failures, `ContextConfigError` for missing config/invalid input, `ContextSigningError` for signing failures. Never throw plain `Error`.
- **Validate hex inputs at the boundary** — marketId, nonces, addresses. Don't cast strings to `Hex` or `` `0x${string}` `` without verifying format.
- **Bulk operations must surface errors** — never discard the `errors` array from bulk API responses.
- **Run `bun run typecheck` before committing** — the build must pass with strict TypeScript checks.
- **Keep docs in sync** — when changing method signatures or types, update `skills/`, `README.md`, and `docs/`. Package name is `context-markets`.
