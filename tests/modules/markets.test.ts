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

  it("list() calls GET /markets with params", async () => {
    (http.get as any).mockResolvedValue({ markets: [] });

    await markets.list({ query: "btc", status: "active", limit: 5 });

    expect(http.get).toHaveBeenCalledWith("/markets", {
      search: "btc",
      status: "active",
      limit: 5,
    });
  });

  it("list() works without params", async () => {
    (http.get as any).mockResolvedValue({ markets: [] });

    await markets.list();

    expect(http.get).toHaveBeenCalledWith("/markets", {
      search: undefined,
      status: undefined,
      limit: undefined,
    });
  });

  it("get() calls GET /markets/:id", async () => {
    await markets.get("market-123");
    expect(http.get).toHaveBeenCalledWith("/markets/market-123");
  });

  it("quotes() calls GET /markets/:id/quotes", async () => {
    await markets.quotes("m1");
    expect(http.get).toHaveBeenCalledWith("/markets/m1/quotes");
  });

  it("orderbook() calls GET /markets/:id/orderbook", async () => {
    await markets.orderbook("m1");
    expect(http.get).toHaveBeenCalledWith("/markets/m1/orderbook");
  });

  it("simulate() calls POST /markets/:id/simulate", async () => {
    await markets.simulate("m1", { side: "yes", amount: 100 });

    expect(http.post).toHaveBeenCalledWith("/markets/m1/simulate", {
      side: "yes",
      amount: 100,
      amountType: "usd",
    });
  });

  it("simulate() passes amountType through", async () => {
    await markets.simulate("m1", {
      side: "no",
      amount: 50,
      amountType: "contracts",
    });

    expect(http.post).toHaveBeenCalledWith("/markets/m1/simulate", {
      side: "no",
      amount: 50,
      amountType: "contracts",
    });
  });

  it("priceHistory() calls GET /markets/:id/prices", async () => {
    await markets.priceHistory("m1", { interval: "1h" });
    expect(http.get).toHaveBeenCalledWith("/markets/m1/prices", {
      interval: "1h",
    });
  });

  it("oracle() calls GET /markets/:id/oracle", async () => {
    await markets.oracle("m1");
    expect(http.get).toHaveBeenCalledWith("/markets/m1/oracle");
  });

  it("activity() calls GET /markets/:id/activity", async () => {
    await markets.activity("m1");
    expect(http.get).toHaveBeenCalledWith("/markets/m1/activity");
  });

  it("globalActivity() calls GET /activity", async () => {
    await markets.globalActivity();
    expect(http.get).toHaveBeenCalledWith("/activity");
  });
});
