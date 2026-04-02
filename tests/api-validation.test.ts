/**
 * Live API validation tests.
 *
 * These hit the real testnet API and verify that every response shape
 * matches what the SDK types expect.
 *
 * Run:  bun run test -- tests/api-validation.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ContextClient } from "../src/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load .env.local ───
function loadEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, "../.env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local is optional for read-only tests
  }
}

loadEnv();

const API_KEY = process.env.CONTEXT_API_KEY;
const PRIVATE_KEY = process.env.CONTEXT_PRIVATE_KEY as `0x${string}` | undefined;

// ─── Helpers ───

function expectKeys(obj: unknown, keys: string[], label: string) {
  expect(obj, `${label} should be defined`).toBeDefined();
  expect(typeof obj, `${label} should be an object`).toBe("object");
  for (const key of keys) {
    expect(obj, `${label} missing key: ${key}`).toHaveProperty(key);
  }
}

function expectArrayOf(arr: unknown, label: string) {
  expect(Array.isArray(arr), `${label} should be an array, got ${typeof arr}`).toBe(true);
  return arr as unknown[];
}

// ─── Tests ───

describe("API Validation: Read-only endpoints (no auth)", () => {
  const ctx = new ContextClient({ baseUrl: process.env.CONTEXT_BASE_URL });
  let marketId: string;

  describe("ctx.markets", () => {
    it("list() → MarketList { markets, cursor }", async () => {
      const result = await ctx.markets.list();
      expectKeys(result, ["markets"], "MarketList");
      const markets = expectArrayOf(result.markets, "markets");
      expect(markets.length).toBeGreaterThan(0);

      const m = markets[0] as any;
      expectKeys(m, ["id", "question"], "Market");
      expect(typeof m.id).toBe("string");
      expect(typeof m.question).toBe("string");

      marketId = m.id;
    });

    it("list({ query, status, limit }) → filtered MarketList", async () => {
      const result = await ctx.markets.list({ status: "active", limit: 2 });
      expectKeys(result, ["markets"], "MarketList");
      expect(result.markets.length).toBeLessThanOrEqual(2);
    });

    it("list({ sortBy, sort }) → sorted MarketList", async () => {
      const result = await ctx.markets.list({ sortBy: "volume", sort: "desc", limit: 3 });
      expectKeys(result, ["markets"], "MarketList");
    });

    it("list({ category }) → category-filtered MarketList", async () => {
      const result = await ctx.markets.list({ category: "sports", limit: 3 });
      expectKeys(result, ["markets"], "MarketList");
    });

    it("get(id) → Market (unwrapped from { market })", async () => {
      const m = await ctx.markets.get(marketId);
      expectKeys(m, ["id", "question"], "Market");
      expect(m.id).toBe(marketId);
    });

    it("orderbook(id) → Orderbook { bids, asks }", async () => {
      const ob = await ctx.markets.orderbook(marketId);
      expectKeys(ob, ["bids", "asks"], "Orderbook");
      expectArrayOf(ob.bids, "bids");
      expectArrayOf(ob.asks, "asks");

      if (ob.bids.length > 0) {
        expectKeys(ob.bids[0], ["price", "size"], "OrderbookLevel");
        expect(typeof ob.bids[0].price).toBe("number");
        expect(typeof ob.bids[0].size).toBe("number");
      }
    });

    it("orderbook(id, { depth }) → Orderbook with limited depth", async () => {
      const ob = await ctx.markets.orderbook(marketId, { depth: 3 });
      expectKeys(ob, ["bids", "asks"], "Orderbook");
      expect(ob.bids.length).toBeLessThanOrEqual(3);
      expect(ob.asks.length).toBeLessThanOrEqual(3);
    });

    it("orderbook(id, { outcomeIndex }) → Orderbook for specific outcome", async () => {
      const ob = await ctx.markets.orderbook(marketId, { outcomeIndex: 0 });
      expectKeys(ob, ["bids", "asks"], "Orderbook");
    });

    it("simulate(id, params) → SimulateResult", async () => {
      if (!API_KEY) {
        console.warn("Skipping market simulate test: CONTEXT_API_KEY not set");
        return;
      }

      const authedCtx = new ContextClient({
        apiKey: API_KEY,
        baseUrl: process.env.CONTEXT_BASE_URL,
      });

      const sim = await authedCtx.markets.simulate(marketId, {
        side: "yes",
        amount: 10,
        amountType: "usd",
      });
      expectKeys(
        sim,
        ["marketId", "side", "amount", "amountType", "estimatedContracts", "estimatedAvgPrice", "estimatedSlippage"],
        "SimulateResult",
      );
      expect(typeof sim.estimatedAvgPrice).toBe("number");
      expect(typeof sim.estimatedContracts).toBe("number");
      expect(typeof sim.estimatedSlippage).toBe("number");
    });

    it("simulate(id, { amountType: 'contracts' }) → SimulateResult", async () => {
      if (!API_KEY) {
        console.warn("Skipping market simulate test: CONTEXT_API_KEY not set");
        return;
      }

      const authedCtx = new ContextClient({
        apiKey: API_KEY,
        baseUrl: process.env.CONTEXT_BASE_URL,
      });

      const sim = await authedCtx.markets.simulate(marketId, {
        side: "no",
        amount: 5,
        amountType: "contracts",
      });
      expectKeys(sim, ["estimatedContracts", "estimatedAvgPrice"], "SimulateResult");
    });

    it("priceHistory(id) → PriceHistory { prices, startTime, endTime, interval }", async () => {
      const ph = await ctx.markets.priceHistory(marketId);
      expectKeys(ph, ["prices", "startTime", "endTime", "interval"], "PriceHistory");
      expectArrayOf(ph.prices, "prices");

      if (ph.prices.length > 0) {
        expectKeys(ph.prices[0], ["time", "price"], "PricePoint");
        expect(typeof ph.prices[0].time).toBe("number");
        expect(typeof ph.prices[0].price).toBe("number");
      }
    });

    it("priceHistory(id, { timeframe: '1h' }) → PriceHistory", async () => {
      const ph = await ctx.markets.priceHistory(marketId, { timeframe: "1h" });
      expectKeys(ph, ["prices", "startTime", "endTime", "interval"], "PriceHistory");
    });

    it("priceHistory(id, { interval: '1d' }) → deprecated interval falls back to timeframe", async () => {
      const ph = await ctx.markets.priceHistory(marketId, { interval: "1d" });
      expectKeys(ph, ["prices", "startTime", "endTime", "interval"], "PriceHistory");
    });

    it("oracle(id) → OracleResponse { oracle }", async () => {
      const result = await ctx.markets.oracle(marketId);
      expectKeys(result, ["oracle"], "OracleResponse");
      // oracle can be null if no oracle has run yet
      if (result.oracle !== null) {
        expect(typeof result.oracle).toBe("object");
        expectKeys(result.oracle, ["lastCheckedAt"], "OracleData");
      }
    });

    it("activity(id) → ActivityResponse with pagination", async () => {
      const result = await ctx.markets.activity(marketId);
      expect(result).toHaveProperty("activity");
      expectArrayOf(result.activity, "ActivityItem[]");

      if (result.activity.length > 0) {
        expectKeys(result.activity[0], ["type", "timestamp"], "ActivityItem");
        expect(typeof result.activity[0].type).toBe("string");
        expect(typeof result.activity[0].timestamp).toBe("string");
      }

      if (result.pagination) {
        expect(typeof result.pagination.hasMore).toBe("boolean");
      }
    });

    it("activity(id, { limit }) → limited ActivityResponse", async () => {
      const result = await ctx.markets.activity(marketId, { limit: 2 });
      expectArrayOf(result.activity, "ActivityItem[]");
      expect(result.activity.length).toBeLessThanOrEqual(2);
    });

    it("activity(id, { types }) → filtered ActivityResponse", async () => {
      const result = await ctx.markets.activity(marketId, { types: "trade" });
      expectArrayOf(result.activity, "ActivityItem[]");
    });

    it("globalActivity() → ActivityResponse with pagination", async () => {
      const result = await ctx.markets.globalActivity();
      expect(result).toHaveProperty("activity");
      expectArrayOf(result.activity, "ActivityItem[]");

      if (result.activity.length > 0) {
        expectKeys(result.activity[0], ["type", "timestamp"], "ActivityItem");
      }

      if (result.pagination) {
        expect(typeof result.pagination.hasMore).toBe("boolean");
      }
    });

    it("globalActivity({ limit, types }) → filtered ActivityResponse", async () => {
      const result = await ctx.markets.globalActivity({ limit: 3 });
      expectArrayOf(result.activity, "ActivityItem[]");
      expect(result.activity.length).toBeLessThanOrEqual(3);
    });
  });
});

describe("API Validation: Authenticated endpoints", () => {
  let ctx: ContextClient;
  let marketId: string;

  beforeAll(async () => {
    if (!API_KEY || !PRIVATE_KEY) {
      console.warn("Skipping auth tests: CONTEXT_API_KEY / CONTEXT_PRIVATE_KEY not set");
      return;
    }
    ctx = new ContextClient({
      apiKey: API_KEY,
      baseUrl: process.env.CONTEXT_BASE_URL,
      signer: { privateKey: PRIVATE_KEY },
    });

    // Grab a marketId for order queries
    const { markets } = await ctx.markets.list({ status: "active", limit: 1 });
    marketId = markets[0]?.id;
  });

  // ─── Portfolio ───

  describe("ctx.portfolio", () => {
    it("get() → Portfolio { portfolio, marketIds }", async () => {
      if (!ctx) return;
      const p = await ctx.portfolio.get();
      expectKeys(p, ["portfolio"], "Portfolio");
      expectArrayOf(p.portfolio, "portfolio positions");

      if (p.portfolio.length > 0) {
        const pos = p.portfolio[0];
        expectKeys(pos, ["tokenAddress", "balance", "outcomeIndex", "marketId"], "Position");
      }
    });

    it("get(address) → Portfolio for explicit address", async () => {
      if (!ctx) return;
      const p = await ctx.portfolio.get(ctx.address!);
      expectKeys(p, ["portfolio"], "Portfolio");
    });

    it("get(address, { kind: 'active' }) → filtered Portfolio", async () => {
      if (!ctx) return;
      const p = await ctx.portfolio.get(undefined, { kind: "active" });
      expectKeys(p, ["portfolio"], "Portfolio");
    });

    it("claimable() → ClaimableResponse { positions, totalClaimable }", async () => {
      if (!ctx) return;
      const c = await ctx.portfolio.claimable();
      expectKeys(c, ["positions", "totalClaimable"], "ClaimableResponse");
      expectArrayOf(c.positions, "claimable positions");
    });

    it("stats() → PortfolioStats { currentPortfolioValue }", async () => {
      if (!ctx) return;
      const s = await ctx.portfolio.stats();
      expectKeys(s, ["currentPortfolioValue"], "PortfolioStats");
    });

    it("balance() → Balance { address, usdc }", async () => {
      if (!ctx) return;
      const b = await ctx.portfolio.balance();
      expectKeys(b, ["address", "usdc"], "Balance");
      expect(typeof b.address).toBe("string");
      expectKeys(b.usdc, ["tokenAddress", "balance", "settlementBalance", "walletBalance"], "UsdcBalance");
    });

    it("balance(address) → Balance for explicit address", async () => {
      if (!ctx) return;
      const b = await ctx.portfolio.balance(ctx.address!);
      expectKeys(b, ["address", "usdc"], "Balance");
    });
  });

  // ─── Orders (read) ───

  describe("ctx.orders (read)", () => {
    it("list({ trader }) → OrderList { orders, cursor }", async () => {
      if (!ctx) return;
      const result = await ctx.orders.list({ trader: ctx.address! });
      expectKeys(result, ["orders"], "OrderList");
      expectArrayOf(result.orders, "orders");

      if (result.orders.length > 0) {
        const o = result.orders[0];
        expectKeys(o, ["nonce", "marketId", "trader", "outcomeIndex", "side", "price", "size"], "Order");
        expect(typeof o.nonce).toBe("string");
        expect(typeof o.marketId).toBe("string");
        expect(typeof o.trader).toBe("string");
        expect(typeof o.outcomeIndex).toBe("number");
        expect(typeof o.side).toBe("number");
        expect(typeof o.price).toBe("string");
        expect(typeof o.size).toBe("string");
      }
    });

    it("list({ marketId }) → OrderList", async () => {
      if (!ctx) return;
      const result = await ctx.orders.list({ marketId });
      expectKeys(result, ["orders"], "OrderList");
      expectArrayOf(result.orders, "orders");
    });

    it("list({ status }) → filtered OrderList", async () => {
      if (!ctx) return;
      const result = await ctx.orders.list({ trader: ctx.address!, status: "open" });
      expectKeys(result, ["orders"], "OrderList");
      expectArrayOf(result.orders, "orders");
    });

    it("mine() → OrderList for signer address", async () => {
      if (!ctx) return;
      const result = await ctx.orders.mine();
      expectKeys(result, ["orders"], "OrderList");
      expectArrayOf(result.orders, "orders");

      for (const o of result.orders) {
        expect(o.trader.toLowerCase()).toBe(ctx.address!.toLowerCase());
      }
    });

    it("mine(marketId) → OrderList filtered by market", async () => {
      if (!ctx) return;
      const result = await ctx.orders.mine(marketId);
      expectKeys(result, ["orders"], "OrderList");
    });

    it("recent({ trader }) → OrderList", async () => {
      if (!ctx) return;
      const result = await ctx.orders.recent({ trader: ctx.address!, limit: 5 });
      expectKeys(result, ["orders"], "OrderList");
      expectArrayOf(result.orders, "orders");
    });

    it("get(orderId) → Order (unwrapped) — if orders exist", async () => {
      if (!ctx) return;
      const list = await ctx.orders.mine();
      if (list.orders.length === 0) return; // skip if no orders

      try {
        const order = await ctx.orders.get(list.orders[0].nonce);
        expectKeys(order, ["nonce", "marketId", "trader"], "Order");
      } catch (err: any) {
        // Some orders may not be retrievable by nonce if they're old/cancelled
        if (err.status === 404) return;
        throw err;
      }
    });

    it("simulate() → OrderSimulateResult", async () => {
      if (!ctx) return;
      const result = await ctx.orders.simulate({
        marketId,
        trader: ctx.address!,
        maxSize: "10000000",
        maxPrice: "500000",
        outcomeIndex: 0,
        side: "bid",
      });
      expectKeys(result, ["levels", "summary", "collateral", "warnings"], "OrderSimulateResult");
      expectArrayOf(result.levels, "levels");
      expectKeys(result.summary, ["fillSize", "fillCost"], "summary");
      expectKeys(result.collateral, ["balance", "isSufficient"], "collateral");
    });
  });

  // ─── Account ───

  describe("ctx.account", () => {
    it("mintTestUsdc() → responds without error (may hit rate limit)", async () => {
      if (!ctx) return;
      try {
        const result = await ctx.account.mintTestUsdc(1);
        expect(result).toBeDefined();
      } catch (err: any) {
        // Daily mint limit is expected if tests have already run today
        expect(err.message).toContain("mint limit");
      }
    });
  });
});
