# @contextwtf/react Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `@contextwtf/react`, a React hooks library wrapping `@contextwtf/sdk` with wagmi v2, TanStack Query, and gasless-first onboarding.

**Architecture:** Thin Provider creates and memoizes a `ContextClient` from wagmi wallet state. Query hooks wrap SDK reads via `useQuery`. Mutation hooks wrap SDK writes via `useMutation` with automatic cache invalidation. All peer deps — nothing bundled.

**Tech Stack:** React 18+, wagmi v2, @tanstack/react-query v5, viem v2, @contextwtf/sdk, vitest, @testing-library/react

**Design Doc:** `docs/plans/2026-02-26-react-sdk-design.md` (in context-sdk repo)

**Repo:** New repo at `~/Desktop/projects/context-ecosystem/context-react` (separate from context-sdk)

---

### Task 1: Scaffold Repository

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `src/index.ts` (empty placeholder)
- Create: `.gitignore`

**Step 1: Initialize repo**

```bash
mkdir -p ~/Desktop/projects/context-ecosystem/context-react
cd ~/Desktop/projects/context-ecosystem/context-react
git init
```

**Step 2: Create package.json**

```json
{
  "name": "@contextwtf/react",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "peerDependencies": {
    "@contextwtf/sdk": ">=0.3.0",
    "@tanstack/react-query": ">=5.0.0",
    "react": ">=18.0.0",
    "viem": ">=2.0.0",
    "wagmi": ">=2.0.0"
  },
  "devDependencies": {
    "@contextwtf/sdk": "^0.3.4",
    "@tanstack/react-query": "^5.0.0",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^25.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "viem": "^2.23.0",
    "vitest": "^3.0.0",
    "wagmi": "^2.0.0"
  },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: Create tsup.config.ts**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: [
    "react",
    "viem",
    "wagmi",
    "@tanstack/react-query",
    "@contextwtf/sdk",
  ],
});
```

**Step 5: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
```

**Step 6: Create .gitignore**

```
node_modules/
dist/
```

**Step 7: Create empty src/index.ts**

```ts
// @contextwtf/react
```

**Step 8: Install dependencies and verify build**

```bash
bun install
bun run build
bun run typecheck
```

**Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold @contextwtf/react package"
```

---

### Task 2: ContextProvider + useContextClient

**Files:**
- Create: `src/provider.tsx`
- Create: `src/hooks/useClient.ts`
- Create: `tests/provider.test.tsx`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/provider.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContextProvider, useContextClient } from "../src/index.js";

// Mock wagmi hooks
vi.mock("wagmi", () => ({
  useWalletClient: vi.fn(() => ({ data: undefined })),
  useAccount: vi.fn(() => ({ address: undefined })),
}));

// Mock the SDK
vi.mock("@contextwtf/sdk", () => ({
  ContextClient: vi.fn().mockImplementation((opts: any) => ({
    markets: {},
    orders: {},
    portfolio: {},
    questions: {},
    account: {},
    address: null,
    _opts: opts,
  })),
}));

function createWrapper(apiKey = "test-key") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ContextProvider, { apiKey }, children),
    );
  };
}

describe("ContextProvider", () => {
  it("provides a ContextClient via useContextClient", () => {
    const { result } = renderHook(() => useContextClient(), {
      wrapper: createWrapper(),
    });
    expect(result.current).toBeDefined();
    expect(result.current.markets).toBeDefined();
  });

  it("throws when useContextClient is used outside provider", () => {
    expect(() => {
      renderHook(() => useContextClient());
    }).toThrow("useContextClient must be used within a <ContextProvider>");
  });

  it("creates a read-only client when no wallet is connected", () => {
    const { ContextClient } = require("@contextwtf/sdk");
    renderHook(() => useContextClient(), {
      wrapper: createWrapper("my-api-key"),
    });
    expect(ContextClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "my-api-key" }),
    );
  });

  it("passes walletClient as signer when wallet is connected", async () => {
    const { useWalletClient } = require("wagmi");
    const mockWalletClient = { account: { address: "0x123" } };
    useWalletClient.mockReturnValue({ data: mockWalletClient });

    const { ContextClient } = require("@contextwtf/sdk");
    renderHook(() => useContextClient(), {
      wrapper: createWrapper(),
    });
    expect(ContextClient).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: { walletClient: mockWalletClient },
      }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/provider.test.tsx`
Expected: FAIL — modules don't exist yet

**Step 3: Implement provider.tsx**

Create `src/provider.tsx`:

```tsx
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { ContextClient } from "@contextwtf/sdk";
import { useWalletClient, useAccount } from "wagmi";

interface ContextProviderProps {
  apiKey: string;
  rpcUrl?: string;
  baseUrl?: string;
  children: ReactNode;
}

const ContextClientContext = createContext<ContextClient | null>(null);

export function ContextProvider({
  apiKey,
  rpcUrl,
  baseUrl,
  children,
}: ContextProviderProps) {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();

  const client = useMemo(() => {
    return new ContextClient({
      apiKey,
      rpcUrl,
      baseUrl,
      ...(walletClient ? { signer: { walletClient } } : {}),
    });
  }, [apiKey, rpcUrl, baseUrl, walletClient, address]);

  return (
    <ContextClientContext.Provider value={client}>
      {children}
    </ContextClientContext.Provider>
  );
}

export function useContextClient(): ContextClient {
  const client = useContext(ContextClientContext);
  if (!client) {
    throw new Error(
      "useContextClient must be used within a <ContextProvider>",
    );
  }
  return client;
}
```

**Step 4: Implement useClient.ts**

Create `src/hooks/useClient.ts`:

```ts
export { useContextClient } from "../provider.js";
```

**Step 5: Update src/index.ts**

```ts
export { ContextProvider, useContextClient } from "./provider.js";
```

**Step 6: Run test to verify it passes**

Run: `bun run test -- tests/provider.test.tsx`
Expected: PASS

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add ContextProvider and useContextClient"
```

---

### Task 3: Query Key Factory + ContextWalletError

**Files:**
- Create: `src/query-keys.ts`
- Create: `src/errors.ts`
- Create: `tests/query-keys.test.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/query-keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contextKeys } from "../src/query-keys.js";
import { ContextWalletError } from "../src/errors.js";

describe("contextKeys", () => {
  it("generates market list keys", () => {
    expect(contextKeys.markets.list()).toEqual(["context", "markets", "list"]);
    expect(contextKeys.markets.list({ status: "active" })).toEqual([
      "context", "markets", "list", { status: "active" },
    ]);
  });

  it("generates market detail keys", () => {
    expect(contextKeys.markets.get("abc")).toEqual([
      "context", "markets", "get", "abc",
    ]);
  });

  it("generates orderbook keys", () => {
    expect(contextKeys.markets.orderbook("abc")).toEqual([
      "context", "markets", "orderbook", "abc",
    ]);
  });

  it("generates order keys", () => {
    expect(contextKeys.orders.list()).toEqual(["context", "orders", "list"]);
    expect(contextKeys.orders.get("id1")).toEqual([
      "context", "orders", "get", "id1",
    ]);
  });

  it("generates portfolio keys", () => {
    expect(contextKeys.portfolio.get("0x1")).toEqual([
      "context", "portfolio", "get", "0x1",
    ]);
    expect(contextKeys.portfolio.balance()).toEqual([
      "context", "portfolio", "balance",
    ]);
  });

  it("generates account keys", () => {
    expect(contextKeys.account.status()).toEqual([
      "context", "account", "status",
    ]);
  });

  it("supports module-level invalidation", () => {
    expect(contextKeys.markets.all).toEqual(["context", "markets"]);
    expect(contextKeys.orders.all).toEqual(["context", "orders"]);
    expect(contextKeys.portfolio.all).toEqual(["context", "portfolio"]);
  });
});

describe("ContextWalletError", () => {
  it("creates an error with hook name", () => {
    const err = new ContextWalletError("useCreateOrder");
    expect(err.message).toBe(
      "Wallet not connected. Connect a wallet before calling useCreateOrder().",
    );
    expect(err.name).toBe("ContextWalletError");
    expect(err).toBeInstanceOf(Error);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/query-keys.test.ts`
Expected: FAIL

**Step 3: Implement query-keys.ts**

Create `src/query-keys.ts`:

```ts
const PREFIX = "context" as const;

export const contextKeys = {
  markets: {
    all: [PREFIX, "markets"] as const,
    list: (params?: Record<string, unknown>) =>
      params
        ? ([PREFIX, "markets", "list", params] as const)
        : ([PREFIX, "markets", "list"] as const),
    get: (id: string) => [PREFIX, "markets", "get", id] as const,
    orderbook: (id: string, params?: Record<string, unknown>) =>
      params
        ? ([PREFIX, "markets", "orderbook", id, params] as const)
        : ([PREFIX, "markets", "orderbook", id] as const),
    quotes: (id: string) => [PREFIX, "markets", "quotes", id] as const,
    priceHistory: (id: string, params?: Record<string, unknown>) =>
      params
        ? ([PREFIX, "markets", "priceHistory", id, params] as const)
        : ([PREFIX, "markets", "priceHistory", id] as const),
    activity: (id: string, params?: Record<string, unknown>) =>
      params
        ? ([PREFIX, "markets", "activity", id, params] as const)
        : ([PREFIX, "markets", "activity", id] as const),
    simulate: (params: Record<string, unknown>) =>
      [PREFIX, "markets", "simulate", params] as const,
  },
  orders: {
    all: [PREFIX, "orders"] as const,
    list: (params?: Record<string, unknown>) =>
      params
        ? ([PREFIX, "orders", "list", params] as const)
        : ([PREFIX, "orders", "list"] as const),
    get: (id: string) => [PREFIX, "orders", "get", id] as const,
  },
  portfolio: {
    all: [PREFIX, "portfolio"] as const,
    get: (address?: string, params?: Record<string, unknown>) =>
      address
        ? ([PREFIX, "portfolio", "get", address, ...(params ? [params] : [])] as const)
        : ([PREFIX, "portfolio", "get"] as const),
    balance: (address?: string) =>
      address
        ? ([PREFIX, "portfolio", "balance", address] as const)
        : ([PREFIX, "portfolio", "balance"] as const),
    claimable: (address?: string) =>
      address
        ? ([PREFIX, "portfolio", "claimable", address] as const)
        : ([PREFIX, "portfolio", "claimable"] as const),
    stats: (address?: string) =>
      address
        ? ([PREFIX, "portfolio", "stats", address] as const)
        : ([PREFIX, "portfolio", "stats"] as const),
  },
  account: {
    all: [PREFIX, "account"] as const,
    status: () => [PREFIX, "account", "status"] as const,
  },
} as const;
```

**Step 4: Implement errors.ts**

Create `src/errors.ts`:

```ts
export class ContextWalletError extends Error {
  override name = "ContextWalletError";

  constructor(hookName: string) {
    super(
      `Wallet not connected. Connect a wallet before calling ${hookName}().`,
    );
  }
}
```

**Step 5: Update src/index.ts**

```ts
export { ContextProvider, useContextClient } from "./provider.js";
export { contextKeys } from "./query-keys.js";
export { ContextWalletError } from "./errors.js";
```

**Step 6: Run test to verify it passes**

Run: `bun run test -- tests/query-keys.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add query key factory and ContextWalletError"
```

---

### Task 4: Markets Query Hooks

**Files:**
- Create: `src/hooks/useMarkets.ts`
- Create: `tests/hooks/useMarkets.test.tsx`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/hooks/useMarkets.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContextProvider } from "../../src/provider.js";
import {
  useMarkets,
  useMarket,
  useOrderbook,
  useQuotes,
  usePriceHistory,
  useMarketActivity,
  useSimulateTrade,
} from "../../src/hooks/useMarkets.js";

const mockMarkets = {
  list: vi.fn().mockResolvedValue({ markets: [], cursor: null }),
  get: vi.fn().mockResolvedValue({ id: "m1", question: "Test?" }),
  orderbook: vi.fn().mockResolvedValue({ marketId: "m1", bids: [], asks: [] }),
  quotes: vi.fn().mockResolvedValue({ marketId: "m1", yes: {}, no: {} }),
  priceHistory: vi.fn().mockResolvedValue({ prices: [] }),
  activity: vi.fn().mockResolvedValue({ activity: [] }),
  simulate: vi.fn().mockResolvedValue({ estimatedContracts: 10 }),
};

vi.mock("wagmi", () => ({
  useWalletClient: vi.fn(() => ({ data: undefined })),
  useAccount: vi.fn(() => ({ address: undefined })),
}));

vi.mock("@contextwtf/sdk", () => ({
  ContextClient: vi.fn().mockImplementation(() => ({
    markets: mockMarkets,
    orders: {},
    portfolio: {},
    questions: {},
    account: {},
    address: null,
  })),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ContextProvider, { apiKey: "test" }, children),
    );
  };
}

describe("useMarkets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches market list", async () => {
    const { result } = renderHook(() => useMarkets(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMarkets.list).toHaveBeenCalled();
  });

  it("passes params to list", async () => {
    const params = { status: "active" as const };
    const { result } = renderHook(() => useMarkets(params), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMarkets.list).toHaveBeenCalledWith(params);
  });
});

describe("useMarket", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches a single market", async () => {
    const { result } = renderHook(() => useMarket("m1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMarkets.get).toHaveBeenCalledWith("m1");
  });

  it("does not fetch when id is undefined", () => {
    const { result } = renderHook(() => useMarket(undefined as any), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockMarkets.get).not.toHaveBeenCalled();
  });
});

describe("useOrderbook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches orderbook for a market", async () => {
    const { result } = renderHook(() => useOrderbook("m1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMarkets.orderbook).toHaveBeenCalledWith("m1", undefined);
  });
});

describe("useQuotes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches quotes for a market", async () => {
    const { result } = renderHook(() => useQuotes("m1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMarkets.quotes).toHaveBeenCalledWith("m1");
  });
});

describe("usePriceHistory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches price history", async () => {
    const { result } = renderHook(
      () => usePriceHistory("m1", { timeframe: "1d" }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMarkets.priceHistory).toHaveBeenCalledWith("m1", {
      timeframe: "1d",
    });
  });
});

describe("useMarketActivity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches activity for a market", async () => {
    const { result } = renderHook(() => useMarketActivity("m1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMarkets.activity).toHaveBeenCalledWith("m1", undefined);
  });
});

describe("useSimulateTrade", () => {
  beforeEach(() => vi.clearAllMocks());

  it("simulates a trade", async () => {
    const params = { side: "yes" as const, amount: 100 };
    const { result } = renderHook(
      () => useSimulateTrade("m1", params),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMarkets.simulate).toHaveBeenCalledWith("m1", params);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/hooks/useMarkets.test.tsx`
Expected: FAIL

**Step 3: Implement useMarkets.ts**

Create `src/hooks/useMarkets.ts`:

```ts
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type {
  MarketList,
  Market,
  Orderbook,
  Quotes,
  PriceHistory,
  ActivityResponse,
  SimulateResult,
  SearchMarketsParams,
  GetOrderbookParams,
  GetPriceHistoryParams,
  GetActivityParams,
  SimulateTradeParams,
} from "@contextwtf/sdk";
import { useContextClient } from "../provider.js";
import { contextKeys } from "../query-keys.js";

export function useMarkets(
  params?: SearchMarketsParams,
  options?: Omit<UseQueryOptions<MarketList>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.markets.list(params as Record<string, unknown>),
    queryFn: () => client.markets.list(params),
    ...options,
  });
}

export function useMarket(
  marketId: string,
  options?: Omit<UseQueryOptions<Market>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.markets.get(marketId),
    queryFn: () => client.markets.get(marketId),
    enabled: !!marketId,
    ...options,
  });
}

export function useOrderbook(
  marketId: string,
  params?: GetOrderbookParams,
  options?: Omit<UseQueryOptions<Orderbook>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.markets.orderbook(marketId, params as Record<string, unknown>),
    queryFn: () => client.markets.orderbook(marketId, params),
    enabled: !!marketId,
    ...options,
  });
}

export function useQuotes(
  marketId: string,
  options?: Omit<UseQueryOptions<Quotes>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.markets.quotes(marketId),
    queryFn: () => client.markets.quotes(marketId),
    enabled: !!marketId,
    ...options,
  });
}

export function usePriceHistory(
  marketId: string,
  params?: GetPriceHistoryParams,
  options?: Omit<UseQueryOptions<PriceHistory>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.markets.priceHistory(marketId, params as Record<string, unknown>),
    queryFn: () => client.markets.priceHistory(marketId, params),
    enabled: !!marketId,
    ...options,
  });
}

export function useMarketActivity(
  marketId: string,
  params?: GetActivityParams,
  options?: Omit<UseQueryOptions<ActivityResponse>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.markets.activity(marketId, params as Record<string, unknown>),
    queryFn: () => client.markets.activity(marketId, params),
    enabled: !!marketId,
    ...options,
  });
}

export function useSimulateTrade(
  marketId: string,
  params: SimulateTradeParams,
  options?: Omit<UseQueryOptions<SimulateResult>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.markets.simulate({ marketId, ...params }),
    queryFn: () => client.markets.simulate(marketId, params),
    enabled: !!marketId,
    ...options,
  });
}
```

**Step 4: Update src/index.ts**

Add:
```ts
export {
  useMarkets,
  useMarket,
  useOrderbook,
  useQuotes,
  usePriceHistory,
  useMarketActivity,
  useSimulateTrade,
} from "./hooks/useMarkets.js";
```

**Step 5: Run test to verify it passes**

Run: `bun run test -- tests/hooks/useMarkets.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add markets query hooks"
```

---

### Task 5: Portfolio Query Hooks

**Files:**
- Create: `src/hooks/usePortfolio.ts`
- Create: `tests/hooks/usePortfolio.test.tsx`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/hooks/usePortfolio.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContextProvider } from "../../src/provider.js";
import {
  usePortfolio,
  useBalance,
  useClaimable,
  usePortfolioStats,
} from "../../src/hooks/usePortfolio.js";

const mockPortfolio = {
  get: vi.fn().mockResolvedValue({ portfolio: [], marketIds: [], cursor: null }),
  balance: vi.fn().mockResolvedValue({ address: "0x1", usdc: {} }),
  claimable: vi.fn().mockResolvedValue({ positions: [], totalClaimable: "0" }),
  stats: vi.fn().mockResolvedValue({ currentPortfolioValue: "100" }),
};

vi.mock("wagmi", () => ({
  useWalletClient: vi.fn(() => ({ data: undefined })),
  useAccount: vi.fn(() => ({ address: undefined })),
}));

vi.mock("@contextwtf/sdk", () => ({
  ContextClient: vi.fn().mockImplementation(() => ({
    markets: {},
    orders: {},
    portfolio: mockPortfolio,
    questions: {},
    account: {},
    address: null,
  })),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ContextProvider, { apiKey: "test" }, children),
    );
  };
}

describe("usePortfolio", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches portfolio", async () => {
    const { result } = renderHook(() => usePortfolio("0x1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPortfolio.get).toHaveBeenCalledWith("0x1", undefined);
  });
});

describe("useBalance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches balance", async () => {
    const { result } = renderHook(() => useBalance("0x1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPortfolio.balance).toHaveBeenCalledWith("0x1");
  });
});

describe("useClaimable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches claimable positions", async () => {
    const { result } = renderHook(() => useClaimable("0x1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPortfolio.claimable).toHaveBeenCalledWith("0x1");
  });
});

describe("usePortfolioStats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches portfolio stats", async () => {
    const { result } = renderHook(() => usePortfolioStats("0x1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPortfolio.stats).toHaveBeenCalledWith("0x1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/hooks/usePortfolio.test.tsx`
Expected: FAIL

**Step 3: Implement usePortfolio.ts**

Create `src/hooks/usePortfolio.ts`:

```ts
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type {
  Portfolio,
  Balance,
  ClaimableResponse,
  PortfolioStats,
  GetPortfolioParams,
} from "@contextwtf/sdk";
import type { Address } from "viem";
import { useContextClient } from "../provider.js";
import { contextKeys } from "../query-keys.js";

export function usePortfolio(
  address?: Address,
  params?: GetPortfolioParams,
  options?: Omit<UseQueryOptions<Portfolio>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.portfolio.get(address, params as Record<string, unknown>),
    queryFn: () => client.portfolio.get(address, params),
    ...options,
  });
}

export function useBalance(
  address?: Address,
  options?: Omit<UseQueryOptions<Balance>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.portfolio.balance(address),
    queryFn: () => client.portfolio.balance(address),
    ...options,
  });
}

export function useClaimable(
  address?: Address,
  options?: Omit<UseQueryOptions<ClaimableResponse>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.portfolio.claimable(address),
    queryFn: () => client.portfolio.claimable(address),
    ...options,
  });
}

export function usePortfolioStats(
  address?: Address,
  options?: Omit<UseQueryOptions<PortfolioStats>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.portfolio.stats(address),
    queryFn: () => client.portfolio.stats(address),
    ...options,
  });
}
```

**Step 4: Update src/index.ts**

Add:
```ts
export {
  usePortfolio,
  useBalance,
  useClaimable,
  usePortfolioStats,
} from "./hooks/usePortfolio.js";
```

**Step 5: Run test to verify it passes**

Run: `bun run test -- tests/hooks/usePortfolio.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add portfolio query hooks"
```

---

### Task 6: Orders Query Hooks

**Files:**
- Create: `src/hooks/useOrders.ts` (query part)
- Create: `tests/hooks/useOrders.test.tsx`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/hooks/useOrders.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContextProvider } from "../../src/provider.js";
import { useOrders, useOrder } from "../../src/hooks/useOrders.js";

const mockOrders = {
  list: vi.fn().mockResolvedValue({ orders: [], cursor: null }),
  get: vi.fn().mockResolvedValue({ nonce: "0x1", marketId: "m1" }),
};

vi.mock("wagmi", () => ({
  useWalletClient: vi.fn(() => ({ data: undefined })),
  useAccount: vi.fn(() => ({ address: undefined })),
}));

vi.mock("@contextwtf/sdk", () => ({
  ContextClient: vi.fn().mockImplementation(() => ({
    markets: {},
    orders: mockOrders,
    portfolio: {},
    questions: {},
    account: {},
    address: null,
  })),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ContextProvider, { apiKey: "test" }, children),
    );
  };
}

describe("useOrders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches order list", async () => {
    const { result } = renderHook(() => useOrders(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockOrders.list).toHaveBeenCalled();
  });

  it("passes params", async () => {
    const params = { marketId: "m1" };
    const { result } = renderHook(() => useOrders(params), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockOrders.list).toHaveBeenCalledWith(params);
  });
});

describe("useOrder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches a single order", async () => {
    const { result } = renderHook(() => useOrder("o1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockOrders.get).toHaveBeenCalledWith("o1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/hooks/useOrders.test.tsx`
Expected: FAIL

**Step 3: Implement useOrders.ts**

Create `src/hooks/useOrders.ts`:

```ts
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { OrderList, Order, GetOrdersParams } from "@contextwtf/sdk";
import { useContextClient } from "../provider.js";
import { contextKeys } from "../query-keys.js";

export function useOrders(
  params?: GetOrdersParams,
  options?: Omit<UseQueryOptions<OrderList>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.orders.list(params as Record<string, unknown>),
    queryFn: () => client.orders.list(params),
    ...options,
  });
}

export function useOrder(
  orderId: string,
  options?: Omit<UseQueryOptions<Order>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.orders.get(orderId),
    queryFn: () => client.orders.get(orderId),
    enabled: !!orderId,
    ...options,
  });
}
```

**Step 4: Update src/index.ts**

Add:
```ts
export { useOrders, useOrder } from "./hooks/useOrders.js";
```

**Step 5: Run test to verify it passes**

Run: `bun run test -- tests/hooks/useOrders.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add orders query hooks"
```

---

### Task 7: Account Query Hook

**Files:**
- Create: `src/hooks/useAccount.ts` (query part initially)
- Create: `tests/hooks/useAccount.test.tsx`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/hooks/useAccount.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContextProvider } from "../../src/provider.js";
import { useAccountStatus } from "../../src/hooks/useAccount.js";

const mockAccount = {
  status: vi.fn().mockResolvedValue({
    address: "0x1",
    ethBalance: 0n,
    usdcAllowance: 0n,
    isOperatorApproved: false,
    needsApprovals: true,
  }),
};

vi.mock("wagmi", () => ({
  useWalletClient: vi.fn(() => ({ data: undefined })),
  useAccount: vi.fn(() => ({ address: undefined })),
}));

vi.mock("@contextwtf/sdk", () => ({
  ContextClient: vi.fn().mockImplementation(() => ({
    markets: {},
    orders: {},
    portfolio: {},
    questions: {},
    account: mockAccount,
    address: null,
  })),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ContextProvider, { apiKey: "test" }, children),
    );
  };
}

describe("useAccountStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches account status", async () => {
    const { result } = renderHook(() => useAccountStatus(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockAccount.status).toHaveBeenCalled();
    expect(result.current.data?.needsApprovals).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/hooks/useAccount.test.tsx`
Expected: FAIL

**Step 3: Implement useAccount.ts (query part)**

Create `src/hooks/useAccount.ts`:

```ts
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { WalletStatus } from "@contextwtf/sdk";
import { useContextClient } from "../provider.js";
import { contextKeys } from "../query-keys.js";

export function useAccountStatus(
  options?: Omit<UseQueryOptions<WalletStatus>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.account.status(),
    queryFn: () => client.account.status(),
    ...options,
  });
}
```

**Step 4: Update src/index.ts**

Add:
```ts
export { useAccountStatus } from "./hooks/useAccount.js";
```

**Step 5: Run test to verify it passes**

Run: `bun run test -- tests/hooks/useAccount.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add useAccountStatus query hook"
```

---

### Task 8: Order Mutation Hooks

**Files:**
- Create: `src/hooks/useOrderMutations.ts`
- Create: `tests/hooks/useOrderMutations.test.tsx`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/hooks/useOrderMutations.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContextProvider } from "../../src/provider.js";
import {
  useCreateOrder,
  useCreateMarketOrder,
  useCancelOrder,
  useCancelReplace,
} from "../../src/hooks/useOrderMutations.js";

const mockOrders = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn().mockResolvedValue({ success: true, order: { nonce: "0x1" } }),
  createMarket: vi.fn().mockResolvedValue({ success: true, order: { nonce: "0x2" } }),
  cancel: vi.fn().mockResolvedValue({ success: true }),
  cancelReplace: vi.fn().mockResolvedValue({
    cancel: { success: true },
    create: { success: true, order: { nonce: "0x3" } },
  }),
};

vi.mock("wagmi", () => ({
  useWalletClient: vi.fn(() => ({
    data: { account: { address: "0x123" } },
  })),
  useAccount: vi.fn(() => ({ address: "0x123" })),
}));

vi.mock("@contextwtf/sdk", () => ({
  ContextClient: vi.fn().mockImplementation(() => ({
    markets: {},
    orders: mockOrders,
    portfolio: {},
    questions: {},
    account: {},
    address: "0x123",
  })),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ContextProvider, { apiKey: "test" }, children),
    );
  };
}

describe("useCreateOrder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls orders.create with the request", async () => {
    const { result } = renderHook(() => useCreateOrder(), {
      wrapper: createWrapper(),
    });
    const req = {
      marketId: "m1",
      outcome: "yes" as const,
      side: "buy" as const,
      priceCents: 45,
      size: 100,
    };
    await act(() => result.current.mutateAsync(req));
    expect(mockOrders.create).toHaveBeenCalledWith(req);
  });
});

describe("useCreateMarketOrder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls orders.createMarket", async () => {
    const { result } = renderHook(() => useCreateMarketOrder(), {
      wrapper: createWrapper(),
    });
    const req = {
      marketId: "m1",
      outcome: "yes" as const,
      side: "buy" as const,
      maxPriceCents: 50,
      maxSize: 100,
    };
    await act(() => result.current.mutateAsync(req));
    expect(mockOrders.createMarket).toHaveBeenCalledWith(req);
  });
});

describe("useCancelOrder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls orders.cancel with nonce", async () => {
    const { result } = renderHook(() => useCancelOrder(), {
      wrapper: createWrapper(),
    });
    await act(() => result.current.mutateAsync("0xabc" as any));
    expect(mockOrders.cancel).toHaveBeenCalledWith("0xabc");
  });
});

describe("useCancelReplace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls orders.cancelReplace", async () => {
    const { result } = renderHook(() => useCancelReplace(), {
      wrapper: createWrapper(),
    });
    const args = {
      cancelNonce: "0xabc" as `0x${string}`,
      newOrder: {
        marketId: "m1",
        outcome: "yes" as const,
        side: "buy" as const,
        priceCents: 50,
        size: 100,
      },
    };
    await act(() => result.current.mutateAsync(args));
    expect(mockOrders.cancelReplace).toHaveBeenCalledWith(
      "0xabc",
      args.newOrder,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/hooks/useOrderMutations.test.tsx`
Expected: FAIL

**Step 3: Implement useOrderMutations.ts**

Create `src/hooks/useOrderMutations.ts`:

```ts
import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import type {
  PlaceOrderRequest,
  PlaceMarketOrderRequest,
  CreateOrderResult,
  CancelResult,
  CancelReplaceResult,
} from "@contextwtf/sdk";
import type { Hex } from "viem";
import { useContextClient } from "../provider.js";
import { contextKeys } from "../query-keys.js";

export function useCreateOrder(
  options?: Omit<
    UseMutationOptions<CreateOrderResult, Error, PlaceOrderRequest>,
    "mutationFn"
  >,
) {
  const client = useContextClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: PlaceOrderRequest) => client.orders.create(req),
    retry: false,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: contextKeys.orders.all });
      queryClient.invalidateQueries({
        queryKey: contextKeys.markets.orderbook(args[1].marketId),
      });
      queryClient.invalidateQueries({ queryKey: contextKeys.portfolio.all });
      options?.onSuccess?.(...args);
    },
    ...options,
    // Ensure onSuccess isn't overwritten by spread
  });
}

export function useCreateMarketOrder(
  options?: Omit<
    UseMutationOptions<CreateOrderResult, Error, PlaceMarketOrderRequest>,
    "mutationFn"
  >,
) {
  const client = useContextClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: PlaceMarketOrderRequest) =>
      client.orders.createMarket(req),
    retry: false,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: contextKeys.orders.all });
      queryClient.invalidateQueries({
        queryKey: contextKeys.markets.orderbook(args[1].marketId),
      });
      queryClient.invalidateQueries({ queryKey: contextKeys.portfolio.all });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
}

export function useCancelOrder(
  options?: Omit<
    UseMutationOptions<CancelResult, Error, Hex>,
    "mutationFn"
  >,
) {
  const client = useContextClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (nonce: Hex) => client.orders.cancel(nonce),
    retry: false,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: contextKeys.orders.all });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
}

export function useCancelReplace(
  options?: Omit<
    UseMutationOptions<
      CancelReplaceResult,
      Error,
      { cancelNonce: Hex; newOrder: PlaceOrderRequest }
    >,
    "mutationFn"
  >,
) {
  const client = useContextClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cancelNonce, newOrder }) =>
      client.orders.cancelReplace(cancelNonce, newOrder),
    retry: false,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: contextKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: contextKeys.portfolio.all });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
}
```

**Step 4: Update src/index.ts**

Add:
```ts
export {
  useCreateOrder,
  useCreateMarketOrder,
  useCancelOrder,
  useCancelReplace,
} from "./hooks/useOrderMutations.js";
```

**Step 5: Run test to verify it passes**

Run: `bun run test -- tests/hooks/useOrderMutations.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add order mutation hooks with cache invalidation"
```

---

### Task 9: Account Mutation Hooks (Gasless-First)

**Files:**
- Modify: `src/hooks/useAccount.ts`
- Create: `tests/hooks/useAccountMutations.test.tsx`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/hooks/useAccountMutations.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContextProvider } from "../../src/provider.js";
import {
  useAccountSetup,
  useDeposit,
  useWithdraw,
} from "../../src/hooks/useAccount.js";

const mockAccount = {
  status: vi.fn(),
  gaslessSetup: vi.fn(),
  setup: vi.fn(),
  gaslessDeposit: vi.fn(),
  deposit: vi.fn(),
  withdraw: vi.fn().mockResolvedValue("0xtxhash"),
};

vi.mock("wagmi", () => ({
  useWalletClient: vi.fn(() => ({
    data: { account: { address: "0x123" } },
  })),
  useAccount: vi.fn(() => ({ address: "0x123" })),
}));

vi.mock("@contextwtf/sdk", () => ({
  ContextClient: vi.fn().mockImplementation(() => ({
    markets: {},
    orders: {},
    portfolio: {},
    questions: {},
    account: mockAccount,
    address: "0x123",
  })),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ContextProvider, { apiKey: "test" }, children),
    );
  };
}

describe("useAccountSetup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tries gasless first, succeeds", async () => {
    mockAccount.gaslessSetup.mockResolvedValue({ success: true, txHash: "0x1" });
    const { result } = renderHook(() => useAccountSetup(), {
      wrapper: createWrapper(),
    });
    await act(() => result.current.mutateAsync());
    expect(mockAccount.gaslessSetup).toHaveBeenCalled();
    expect(mockAccount.setup).not.toHaveBeenCalled();
  });

  it("falls back to direct tx when gasless fails", async () => {
    mockAccount.gaslessSetup.mockRejectedValue(new Error("relay down"));
    mockAccount.setup.mockResolvedValue({
      usdcApprovalTx: "0x1",
      operatorApprovalTx: "0x2",
    });
    const { result } = renderHook(() => useAccountSetup(), {
      wrapper: createWrapper(),
    });
    await act(() => result.current.mutateAsync());
    expect(mockAccount.gaslessSetup).toHaveBeenCalled();
    expect(mockAccount.setup).toHaveBeenCalled();
  });
});

describe("useDeposit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tries gasless first, succeeds", async () => {
    mockAccount.gaslessDeposit.mockResolvedValue({ success: true, txHash: "0x1" });
    const { result } = renderHook(() => useDeposit(), {
      wrapper: createWrapper(),
    });
    await act(() => result.current.mutateAsync(100));
    expect(mockAccount.gaslessDeposit).toHaveBeenCalledWith(100);
    expect(mockAccount.deposit).not.toHaveBeenCalled();
  });

  it("falls back to direct tx when gasless fails", async () => {
    mockAccount.gaslessDeposit.mockRejectedValue(new Error("relay down"));
    mockAccount.deposit.mockResolvedValue("0xtxhash");
    const { result } = renderHook(() => useDeposit(), {
      wrapper: createWrapper(),
    });
    await act(() => result.current.mutateAsync(100));
    expect(mockAccount.gaslessDeposit).toHaveBeenCalledWith(100);
    expect(mockAccount.deposit).toHaveBeenCalledWith(100);
  });
});

describe("useWithdraw", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls withdraw directly (no gasless variant)", async () => {
    const { result } = renderHook(() => useWithdraw(), {
      wrapper: createWrapper(),
    });
    await act(() => result.current.mutateAsync(50));
    expect(mockAccount.withdraw).toHaveBeenCalledWith(50);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/hooks/useAccountMutations.test.tsx`
Expected: FAIL

**Step 3: Add mutations to useAccount.ts**

Append to `src/hooks/useAccount.ts`:

```ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import type {
  WalletStatus,
  WalletSetupResult,
  GaslessOperatorResult,
  GaslessDepositResult,
} from "@contextwtf/sdk";
import type { Hex } from "viem";
import { useContextClient } from "../provider.js";
import { contextKeys } from "../query-keys.js";

export function useAccountStatus(
  options?: Omit<UseQueryOptions<WalletStatus>, "queryKey" | "queryFn">,
) {
  const client = useContextClient();
  return useQuery({
    queryKey: contextKeys.account.status(),
    queryFn: () => client.account.status(),
    ...options,
  });
}

export function useAccountSetup(
  options?: Omit<
    UseMutationOptions<GaslessOperatorResult | WalletSetupResult, Error, void>,
    "mutationFn"
  >,
) {
  const client = useContextClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        return await client.account.gaslessSetup();
      } catch {
        return await client.account.setup();
      }
    },
    retry: false,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: contextKeys.account.all });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
}

export function useDeposit(
  options?: Omit<
    UseMutationOptions<GaslessDepositResult | Hex, Error, number>,
    "mutationFn"
  >,
) {
  const client = useContextClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (amount: number) => {
      try {
        return await client.account.gaslessDeposit(amount);
      } catch {
        return await client.account.deposit(amount);
      }
    },
    retry: false,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: contextKeys.account.all });
      queryClient.invalidateQueries({ queryKey: contextKeys.portfolio.all });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
}

export function useWithdraw(
  options?: Omit<
    UseMutationOptions<Hex, Error, number>,
    "mutationFn"
  >,
) {
  const client = useContextClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (amount: number) => client.account.withdraw(amount),
    retry: false,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: contextKeys.account.all });
      queryClient.invalidateQueries({ queryKey: contextKeys.portfolio.all });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
}
```

Note: This is the **full replacement** of the file — the `useAccountStatus` from Task 7 is included here alongside the new mutations.

**Step 4: Update src/index.ts**

Replace the useAccount export with:
```ts
export {
  useAccountStatus,
  useAccountSetup,
  useDeposit,
  useWithdraw,
} from "./hooks/useAccount.js";
```

**Step 5: Run test to verify it passes**

Run: `bun run test -- tests/hooks/useAccountMutations.test.tsx`
Expected: PASS

**Step 6: Run all tests**

Run: `bun run test`
Expected: All pass

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add account mutation hooks with gasless-first fallback"
```

---

### Task 10: Question Mutation Hooks

**Files:**
- Create: `src/hooks/useQuestions.ts`
- Create: `tests/hooks/useQuestions.test.tsx`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Create `tests/hooks/useQuestions.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContextProvider } from "../../src/provider.js";
import {
  useSubmitQuestion,
  useCreateMarket,
} from "../../src/hooks/useQuestions.js";

const mockQuestions = {
  submit: vi.fn().mockResolvedValue({ submissionId: "s1", status: "pending" }),
};

const mockMarkets = {
  create: vi.fn().mockResolvedValue({ marketId: "m1", txHash: "0x1" }),
};

vi.mock("wagmi", () => ({
  useWalletClient: vi.fn(() => ({ data: undefined })),
  useAccount: vi.fn(() => ({ address: undefined })),
}));

vi.mock("@contextwtf/sdk", () => ({
  ContextClient: vi.fn().mockImplementation(() => ({
    markets: mockMarkets,
    orders: {},
    portfolio: {},
    questions: mockQuestions,
    account: {},
    address: null,
  })),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ContextProvider, { apiKey: "test" }, children),
    );
  };
}

describe("useSubmitQuestion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits a question", async () => {
    const { result } = renderHook(() => useSubmitQuestion(), {
      wrapper: createWrapper(),
    });
    await act(() => result.current.mutateAsync("Will it rain?"));
    expect(mockQuestions.submit).toHaveBeenCalledWith("Will it rain?");
  });
});

describe("useCreateMarket", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a market from a question ID", async () => {
    const { result } = renderHook(() => useCreateMarket(), {
      wrapper: createWrapper(),
    });
    await act(() => result.current.mutateAsync("q1"));
    expect(mockMarkets.create).toHaveBeenCalledWith("q1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/hooks/useQuestions.test.tsx`
Expected: FAIL

**Step 3: Implement useQuestions.ts**

Create `src/hooks/useQuestions.ts`:

```ts
import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import type {
  SubmitQuestionResult,
  CreateMarketResult,
} from "@contextwtf/sdk";
import { useContextClient } from "../provider.js";
import { contextKeys } from "../query-keys.js";

export function useSubmitQuestion(
  options?: Omit<
    UseMutationOptions<SubmitQuestionResult, Error, string>,
    "mutationFn"
  >,
) {
  const client = useContextClient();
  return useMutation({
    mutationFn: (question: string) => client.questions.submit(question),
    retry: false,
    ...options,
  });
}

export function useCreateMarket(
  options?: Omit<
    UseMutationOptions<CreateMarketResult, Error, string>,
    "mutationFn"
  >,
) {
  const client = useContextClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (questionId: string) => client.markets.create(questionId),
    retry: false,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: contextKeys.markets.all });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
}
```

**Step 4: Update src/index.ts**

Add:
```ts
export {
  useSubmitQuestion,
  useCreateMarket,
} from "./hooks/useQuestions.js";
```

**Step 5: Run test to verify it passes**

Run: `bun run test -- tests/hooks/useQuestions.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add question and market creation mutation hooks"
```

---

### Task 11: Final Index Exports + Build Verification

**Files:**
- Modify: `src/index.ts` (final version)

**Step 1: Write final src/index.ts**

```ts
// Provider
export { ContextProvider, useContextClient } from "./provider.js";

// Query key factory
export { contextKeys } from "./query-keys.js";

// Errors
export { ContextWalletError } from "./errors.js";

// Market hooks
export {
  useMarkets,
  useMarket,
  useOrderbook,
  useQuotes,
  usePriceHistory,
  useMarketActivity,
  useSimulateTrade,
} from "./hooks/useMarkets.js";

// Portfolio hooks
export {
  usePortfolio,
  useBalance,
  useClaimable,
  usePortfolioStats,
} from "./hooks/usePortfolio.js";

// Order hooks
export { useOrders, useOrder } from "./hooks/useOrders.js";

// Order mutation hooks
export {
  useCreateOrder,
  useCreateMarketOrder,
  useCancelOrder,
  useCancelReplace,
} from "./hooks/useOrderMutations.js";

// Account hooks
export {
  useAccountStatus,
  useAccountSetup,
  useDeposit,
  useWithdraw,
} from "./hooks/useAccount.js";

// Question hooks
export { useSubmitQuestion, useCreateMarket } from "./hooks/useQuestions.js";
```

**Step 2: Run all tests**

Run: `bun run test`
Expected: All pass

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Run build**

Run: `bun run build`
Expected: Produces `dist/index.js` and `dist/index.d.ts`

**Step 5: Verify exports**

Run: `ls -la dist/`
Expected: `index.js`, `index.d.ts` present

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: finalize public API exports and verify build"
```

---

## Summary

| Task | What | Files |
|---|---|---|
| 1 | Scaffold repo | package.json, tsconfig, tsup, vitest, .gitignore |
| 2 | Provider + useContextClient | provider.tsx, hooks/useClient.ts |
| 3 | Query keys + ContextWalletError | query-keys.ts, errors.ts |
| 4 | Markets query hooks | hooks/useMarkets.ts |
| 5 | Portfolio query hooks | hooks/usePortfolio.ts |
| 6 | Orders query hooks | hooks/useOrders.ts |
| 7 | Account status query hook | hooks/useAccount.ts |
| 8 | Order mutation hooks | hooks/useOrderMutations.ts |
| 9 | Account mutations (gasless-first) | hooks/useAccount.ts (extend) |
| 10 | Question mutation hooks | hooks/useQuestions.ts |
| 11 | Final exports + build | index.ts, build verification |
