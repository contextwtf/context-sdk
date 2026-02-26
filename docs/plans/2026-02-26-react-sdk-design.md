# @contextwtf/react — Design Document

**Date:** 2026-02-26
**Status:** Approved

## Overview

A React hooks library that wraps `@contextwtf/sdk` with wagmi integration, TanStack Query caching, and gasless-first onboarding. Gives frontend developers a reactive, type-safe interface to Context Markets without managing SDK lifecycle, wallet state synchronization, or cache invalidation.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo | Separate from `context-sdk` | Independent release cadence, no bloat for server SDK users |
| Architecture | Thin Provider + direct SDK hooks | Minimal abstraction; hooks call SDK methods directly via TanStack Query |
| Onboarding | Gasless-first with direct tx fallback | Best UX — users just sign, no ETH needed |
| Scope | Full SDK surface | Hooks for all five modules from v1 |
| UI | Hooks only, no components | Maximum flexibility, no styling opinions |
| Data fetching | Bring your own QueryClient | Avoids version conflicts, devs already have TanStack Query |
| wagmi | v2 only | Aligns with viem v2 (core SDK dependency) |
| Chain | Base Sepolia only | Matches core SDK; mainnet added later |
| Format | ESM only | Standard for React libraries |

## Package Structure

```
@contextwtf/react
├── src/
│   ├── provider.tsx          # ContextProvider + internal React context
│   ├── hooks/
│   │   ├── useMarkets.ts     # Markets module hooks
│   │   ├── useOrders.ts      # Orders module hooks
│   │   ├── usePortfolio.ts   # Portfolio module hooks
│   │   ├── useQuestions.ts   # Questions module hooks
│   │   ├── useAccount.ts     # Account setup/deposit/withdraw hooks
│   │   └── useClient.ts      # Escape hatch: raw ContextClient access
│   └── index.ts              # Public exports
├── package.json
└── tsconfig.json
```

### Dependencies

All peer dependencies — nothing bundled:

- `@contextwtf/sdk`
- `react` >= 18
- `@tanstack/react-query` >= 5
- `wagmi` >= 2
- `viem` >= 2

## Provider & Client Lifecycle

`ContextProvider` is the only component. It manages a `ContextClient` instance and keeps it in sync with wagmi wallet state.

```tsx
<WagmiProvider config={wagmiConfig}>
  <QueryClientProvider client={queryClient}>
    <ContextProvider apiKey="ctx_...">
      <App />
    </ContextProvider>
  </QueryClientProvider>
</WagmiProvider>
```

**Internal behavior:**

1. Takes `apiKey` (required) and optional `rpcUrl` as props
2. Watches wagmi's `useWalletClient()` and `useAccount()` for wallet state changes
3. Wallet **disconnected** → creates read-only `ContextClient({ apiKey })` (markets, orderbook, etc. still work)
4. Wallet **connects or switches** → reconstructs `ContextClient` with `{ apiKey, signer: { walletClient } }`, passing wagmi's walletClient straight through
5. Memoized — only rebuilds when `walletClient` identity or `apiKey` actually changes
6. Exposes client via React context

`useContextClient()` provides direct SDK access as an escape hatch.

## Hook API

### Query Hooks

Return TanStack Query's `{ data, isLoading, error, refetch }`. All accept optional query options as the last argument.

```tsx
// Markets
useMarkets(params?)                    // ctx.markets.list()
useMarket(marketId)                    // ctx.markets.get()
useOrderbook(marketId, params?)        // ctx.markets.orderbook()
useQuotes(marketId, params?)           // ctx.markets.quotes()
usePriceHistory(marketId, params?)     // ctx.markets.priceHistory()
useMarketActivity(marketId, params?)   // ctx.markets.activity()
useSimulateTrade(params)               // ctx.markets.simulate()

// Portfolio
usePortfolio(address?)                 // ctx.portfolio.get()
useBalance(address?)                   // ctx.portfolio.balance()
usePositions(address?)                 // ctx.portfolio.positions()
useClaimable(address?)                 // ctx.portfolio.claimable()

// Orders (read)
useOrders(params?)                     // ctx.orders.list()
useOrder(orderId)                      // ctx.orders.get()

// Account (read)
useAccountStatus()                     // ctx.account.status()
```

**Query key convention:** `['context', module, method, ...args]`

### Mutation Hooks

Return TanStack Query's `{ mutate, mutateAsync, isPending, error, data }`.

```tsx
// Orders (write)
useCreateOrder()                       // ctx.orders.create()
useCreateMarketOrder()                 // ctx.orders.createMarket()
useCancelOrder()                       // ctx.orders.cancel()
useCancelReplace()                     // ctx.orders.cancelReplace()

// Account (write) — gasless-first
useAccountSetup()                      // gaslessSetup() → fallback setup()
useDeposit()                           // gaslessDeposit() → fallback deposit()
useWithdraw()                          // direct tx (no gasless variant)

// Questions
useSubmitQuestion()                    // ctx.questions.submit()
useCreateMarket()                      // ctx.markets.create()
```

## Gasless Fallback Pattern

`useAccountSetup` and `useDeposit` try gasless first, fall back to direct transactions:

```
try gasless → if fails → try direct tx → if fails → throw
```

Handled internally — devs don't think about it.

## Error Handling

Three categories, all surfaced through TanStack's `error` field:

1. **`ContextApiError`** — API returned non-OK. From core SDK, passed through as-is.
2. **`ContextSigningError`** — User rejected signature or signing failed. From core SDK, passed through.
3. **`ContextWalletError`** — New, React SDK only. Mutation called without connected wallet.

## Cache Invalidation

After mutations succeed, related queries auto-invalidate:

| Mutation | Invalidates |
|---|---|
| `useAccountSetup` | `accountStatus` |
| `useDeposit` | `accountStatus`, `balance` |
| `useWithdraw` | `accountStatus`, `balance` |
| `useCreateOrder` / `useCreateMarketOrder` | `orders`, `orderbook`, `balance` |
| `useCancelOrder` / `useCancelReplace` | `orders`, `orderbook` |
| `useCreateMarket` | `markets` |

**No retries on mutations** — prevents accidental double-signing. Query hooks use TanStack's default retry (3 attempts).

## Full Integration Example

### App Setup

```tsx
import { WagmiProvider } from 'wagmi'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { ContextProvider } from '@contextwtf/react'

const queryClient = new QueryClient()

function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ContextProvider apiKey="ctx_...">
          <TradingPage />
        </ContextProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
```

### Onboarding

```tsx
function OnboardingPanel() {
  const { data: status } = useAccountStatus()
  const { mutateAsync: setup, isPending: settingUp } = useAccountSetup()
  const { mutateAsync: deposit, isPending: depositing } = useDeposit()

  if (!status) return <Spinner />

  if (status.needsApprovals) {
    return <button onClick={() => setup()} disabled={settingUp}>
      {settingUp ? 'Approving...' : 'Approve Account'}
    </button>
  }

  return <button onClick={() => deposit(100)} disabled={depositing}>
    {depositing ? 'Depositing...' : 'Deposit 100 USDC'}
  </button>
}
```

### Trading

```tsx
function TradePanel({ marketId }: { marketId: string }) {
  const { data: orderbook } = useOrderbook(marketId)
  const { data: balance } = useBalance()
  const { mutateAsync: createOrder, isPending, error } = useCreateOrder()

  const handleBuy = async () => {
    await createOrder({
      marketId,
      outcome: 'yes',
      side: 'buy',
      priceCents: 45,
      size: 100,
    })
  }

  return (
    <div>
      <p>Balance: {balance?.usdc.settlementBalance}</p>
      <p>Best ask: {orderbook?.asks[0]?.price}</p>
      <button onClick={handleBuy} disabled={isPending}>
        {isPending ? 'Signing...' : 'Buy 100 shares @ 45¢'}
      </button>
      {error && <p>{error.message}</p>}
    </div>
  )
}
```
