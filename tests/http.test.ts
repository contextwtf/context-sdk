import { describe, it, expect, vi } from "vitest";
import { createHttpClient } from "../src/http.js";
import { ContextApiError } from "../src/errors.js";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("createHttpClient", () => {
  it("makes GET requests with correct URL", async () => {
    const fetch = mockFetch(200, { ok: true });
    const http = createHttpClient({ baseUrl: "https://api.test", fetch });

    await http.get("/markets");

    expect(fetch).toHaveBeenCalledWith("https://api.test/markets", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("appends query params to GET requests", async () => {
    const fetch = mockFetch(200, []);
    const http = createHttpClient({ baseUrl: "https://api.test", fetch });

    await http.get("/markets", { status: "active", limit: 5 });

    const url = fetch.mock.calls[0][0];
    expect(url).toBe("https://api.test/markets?status=active&limit=5");
  });

  it("skips undefined query params", async () => {
    const fetch = mockFetch(200, []);
    const http = createHttpClient({ baseUrl: "https://api.test", fetch });

    await http.get("/markets", { status: "active", query: undefined });

    const url = fetch.mock.calls[0][0];
    expect(url).toBe("https://api.test/markets?status=active");
  });

  it("makes POST requests with JSON body", async () => {
    const fetch = mockFetch(200, { id: "1" });
    const http = createHttpClient({ baseUrl: "https://api.test", fetch });

    await http.post("/orders", { marketId: "abc" });

    expect(fetch).toHaveBeenCalledWith("https://api.test/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId: "abc" }),
    });
  });

  it("makes DELETE requests", async () => {
    const fetch = mockFetch(200, { success: true });
    const http = createHttpClient({ baseUrl: "https://api.test", fetch });

    await http.delete("/orders/123");

    expect(fetch).toHaveBeenCalledWith("https://api.test/orders/123", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("includes Authorization header when apiKey is provided", async () => {
    const fetch = mockFetch(200, {});
    const http = createHttpClient({
      baseUrl: "https://api.test",
      apiKey: "ctx_pk_test",
      fetch,
    });

    await http.get("/markets");

    const headers = fetch.mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBe("Bearer ctx_pk_test");
  });

  it("omits Authorization header when no apiKey", async () => {
    const fetch = mockFetch(200, {});
    const http = createHttpClient({ baseUrl: "https://api.test", fetch });

    await http.get("/markets");

    const headers = fetch.mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("throws ContextApiError on non-OK response", async () => {
    const fetch = mockFetch(404, { message: "Not found" });
    const http = createHttpClient({ baseUrl: "https://api.test", fetch });

    await expect(http.get("/markets/xyz")).rejects.toThrow(ContextApiError);
    await expect(http.get("/markets/xyz")).rejects.toMatchObject({
      status: 404,
      message: "Not found",
    });
  });

  it("uses default base URL from config", async () => {
    const fetch = mockFetch(200, {});
    const http = createHttpClient({ fetch });

    await http.get("/test");

    const url = fetch.mock.calls[0][0];
    expect(url).toBe("https://api.context.markets/v2/test");
  });
});
