import { describe, it, expect, vi, beforeEach } from "vitest";
import { Markets } from "../../src/modules/markets.js";
import type { HttpClient } from "../../src/http.js";

function createMockHttp(): HttpClient {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };
}

describe("Markets module", () => {
  let http: ReturnType<typeof createMockHttp>;
  let markets: Markets;

  beforeEach(() => {
    http = createMockHttp();
    markets = new Markets(http);
  });

  it("list() calls GET /markets with all params", async () => {
    (http.get as any).mockResolvedValue({ markets: [] });

    await markets.list({
      query: "btc",
      status: "active",
      sortBy: "volume",
      sort: "desc",
      limit: 5,
      cursor: "abc",
      resolutionStatus: "none",
      creator: "0x123",
      category: "sports",
      createdAfter: "123",
    });

    expect(http.get).toHaveBeenCalledWith("/markets", {
      search: "btc",
      status: "active",
      sortBy: "volume",
      sort: "desc",
      limit: 5,
      cursor: "abc",
      visibility: undefined,
      resolutionStatus: "none",
      creator: "0x123",
      category: "sports",
      createdAfter: "123",
    });
  });

  it("list() works without params", async () => {
    (http.get as any).mockResolvedValue({ markets: [] });
    await markets.list();

    expect(http.get).toHaveBeenCalledWith("/markets", {
      search: undefined,
      status: undefined,
      sortBy: undefined,
      sort: undefined,
      limit: undefined,
      cursor: undefined,
      visibility: undefined,
      resolutionStatus: undefined,
      creator: undefined,
      category: undefined,
      createdAfter: undefined,
    });
  });

  it("search() calls GET /markets/search with params", async () => {
    const mockResult = { markets: [], hasMore: false };
    (http.get as any).mockResolvedValue(mockResult);

    const result = await markets.search({ q: "bitcoin", limit: 10, offset: 5 });

    expect(http.get).toHaveBeenCalledWith("/markets/search", {
      q: "bitcoin",
      limit: 10,
      offset: 5,
    });
    expect(result).toEqual(mockResult);
  });

  it("search() works with only required q param", async () => {
    (http.get as any).mockResolvedValue({ markets: [], hasMore: false });

    await markets.search({ q: "eth" });

    expect(http.get).toHaveBeenCalledWith("/markets/search", {
      q: "eth",
      limit: undefined,
      offset: undefined,
    });
  });

  it("get() calls GET /markets/:id and unwraps { market }", async () => {
    const mockMarket = { id: "market-123", question: "Will X?" };
    (http.get as any).mockResolvedValue({ market: mockMarket });

    const result = await markets.get("market-123");

    expect(http.get).toHaveBeenCalledWith("/markets/market-123");
    expect(result).toEqual(mockMarket);
  });

  it("orderbook() calls GET /markets/:id/orderbook with params", async () => {
    await markets.orderbook("m1", { depth: 5, outcomeIndex: 1 });
    expect(http.get).toHaveBeenCalledWith("/markets/m1/orderbook", {
      depth: 5,
      outcomeIndex: 1,
    });
  });

  it("orderbook() works without params", async () => {
    await markets.orderbook("m1");
    expect(http.get).toHaveBeenCalledWith("/markets/m1/orderbook", {
      depth: undefined,
      outcomeIndex: undefined,
    });
  });

  it("simulate() calls POST /markets/:id/simulate", async () => {
    await markets.simulate("m1", { side: "yes", amount: 100 });

    expect(http.post).toHaveBeenCalledWith("/markets/m1/simulate", {
      side: "yes",
      amount: 100,
      amountType: "usd",
    });
  });

  it("simulate() passes amountType and trader through", async () => {
    await markets.simulate("m1", {
      side: "no",
      amount: 50,
      amountType: "contracts",
      trader: "0xabc",
    });

    expect(http.post).toHaveBeenCalledWith("/markets/m1/simulate", {
      side: "no",
      amount: 50,
      amountType: "contracts",
      trader: "0xabc",
    });
  });

  it("priceHistory() uses timeframe param", async () => {
    (http.get as any).mockResolvedValue({ prices: [], startTime: 0, endTime: 0, interval: 60 });

    await markets.priceHistory("m1", { timeframe: "1h" });
    expect(http.get).toHaveBeenCalledWith("/markets/m1/prices", {
      timeframe: "1h",
    });
  });

  it("priceHistory() falls back from deprecated interval to timeframe", async () => {
    (http.get as any).mockResolvedValue({ prices: [], startTime: 0, endTime: 0, interval: 60 });

    await markets.priceHistory("m1", { interval: "1d" });
    expect(http.get).toHaveBeenCalledWith("/markets/m1/prices", {
      timeframe: "1d",
    });
  });

  it("oracle() calls GET /markets/:id/oracle", async () => {
    await markets.oracle("m1");
    expect(http.get).toHaveBeenCalledWith("/markets/m1/oracle");
  });

  it("activity() calls GET /markets/:id/activity with params and returns full response", async () => {
    const mockResponse = {
      marketId: "m1",
      activity: [{ type: "trade", timestamp: "2026-01-01T00:00:00Z" }],
      pagination: { cursor: "abc|123", hasMore: true },
    };
    (http.get as any).mockResolvedValue(mockResponse);

    const result = await markets.activity("m1", {
      limit: 5,
      types: "trade",
    });

    expect(http.get).toHaveBeenCalledWith("/markets/m1/activity", {
      cursor: undefined,
      limit: 5,
      types: "trade",
      startTime: undefined,
      endTime: undefined,
    });
    expect(result).toEqual(mockResponse);
    expect(result.pagination?.cursor).toBe("abc|123");
  });

  it("globalActivity() calls GET /activity with params and returns full response", async () => {
    const mockResponse = {
      marketId: null,
      activity: [{ type: "trade", timestamp: "2026-01-01T00:00:00Z" }],
      pagination: { cursor: null, hasMore: false },
    };
    (http.get as any).mockResolvedValue(mockResponse);

    const result = await markets.globalActivity({ limit: 3, types: "oracle_update" });

    expect(http.get).toHaveBeenCalledWith("/activity", {
      cursor: undefined,
      limit: 3,
      types: "oracle_update",
      startTime: undefined,
      endTime: undefined,
    });
    expect(result).toEqual(mockResponse);
    expect(result.activity).toHaveLength(1);
  });
});
