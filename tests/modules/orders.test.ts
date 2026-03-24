import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orders } from "../../src/modules/orders.js";
import { ContextConfigError } from "../../src/errors.js";
import type { HttpClient } from "../../src/http.js";
import type { OrderBuilder } from "../../src/order-builder/builder.js";
import type { Address, Hex } from "viem";

function createMockHttp(): HttpClient {
  return {
    get: vi.fn().mockResolvedValue({ orders: [], cursor: null }),
    post: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };
}

function createMockBuilder(): OrderBuilder {
  return {
    address: "0x1234567890abcdef1234567890abcdef12345678" as Address,
    buildAndSign: vi.fn().mockResolvedValue({
      type: "limit",
      marketId: "0xabc",
      trader: "0x1234567890abcdef1234567890abcdef12345678",
      price: "250000",
      size: "5000000",
      outcomeIndex: 1,
      side: 0,
      nonce: "0xnonce",
      expiry: "9999999999",
      maxFee: "12500",
      makerRoleConstraint: 0,
      inventoryModeConstraint: 0,
      signature: "0xsig",
    }),
    signCancel: vi.fn().mockResolvedValue("0xcancelsig" as Hex),
  } as unknown as OrderBuilder;
}

const ADDR = "0x1234567890abcdef1234567890abcdef12345678" as Address;

describe("Orders module", () => {
  describe("read operations (no signer)", () => {
    let http: ReturnType<typeof createMockHttp>;
    let orders: Orders;

    beforeEach(() => {
      http = createMockHttp();
      orders = new Orders(http, null, null);
    });

    it("list() calls GET /orders with all params", async () => {
      await orders.list({ trader: ADDR, marketId: "m1", status: "open", limit: 10 });

      expect(http.get).toHaveBeenCalledWith("/orders", {
        trader: ADDR,
        marketId: "m1",
        status: "open",
        cursor: undefined,
        limit: 10,
      });
    });

    it("list() works without params", async () => {
      await orders.list();

      expect(http.get).toHaveBeenCalledWith("/orders", {
        trader: undefined,
        marketId: undefined,
        status: undefined,
        cursor: undefined,
        limit: undefined,
      });
    });

    it("get() calls GET /orders/:id and unwraps", async () => {
      const mockOrder = { nonce: "0xabc", marketId: "m1" };
      (http.get as any).mockResolvedValue({ order: mockOrder });

      const result = await orders.get("order-hash");
      expect(http.get).toHaveBeenCalledWith("/orders/order-hash");
      expect(result).toEqual(mockOrder);
    });

    it("recent() calls GET /orders/recent with params", async () => {
      await orders.recent({
        trader: ADDR,
        marketId: "m1",
        status: "open",
        limit: 5,
        windowSeconds: 300,
      });

      expect(http.get).toHaveBeenCalledWith("/orders/recent", {
        trader: ADDR,
        marketId: "m1",
        status: "open",
        limit: 5,
        windowSeconds: 300,
      });
    });

    it("simulate() calls POST /orders/simulate", async () => {
      const params = {
        marketId: "0xabc",
        trader: ADDR,
        maxSize: "10000000",
        maxPrice: "500000",
        outcomeIndex: 0,
        side: "bid" as const,
      };

      await orders.simulate(params);
      expect(http.post).toHaveBeenCalledWith("/orders/simulate", params);
    });
  });

  describe("write operations (with signer)", () => {
    let http: ReturnType<typeof createMockHttp>;
    let builder: ReturnType<typeof createMockBuilder>;
    let orders: Orders;

    beforeEach(() => {
      http = createMockHttp();
      builder = createMockBuilder();
      orders = new Orders(http, builder, ADDR);
    });

    it("create() builds, signs, and posts order — returns CreateOrderResult", async () => {
      (http.post as any).mockResolvedValue({ success: true, order: { nonce: "0xabc" } });

      const req = {
        marketId: "0xabc",
        outcome: "yes" as const,
        side: "buy" as const,
        priceCents: 25,
        size: 5,
      };

      const result = await orders.create(req);

      expect(builder.buildAndSign).toHaveBeenCalledWith(req);
      expect(http.post).toHaveBeenCalledWith(
        "/orders",
        expect.objectContaining({ type: "limit", signature: "0xsig" }),
      );
      expect(result.success).toBe(true);
    });

    it("cancel() signs and posts cancel", async () => {
      const nonce = "0xnonce123" as Hex;

      await orders.cancel(nonce);

      expect(builder.signCancel).toHaveBeenCalledWith(nonce);
      expect(http.post).toHaveBeenCalledWith("/orders/cancel", {
        trader: ADDR,
        nonce,
        signature: "0xcancelsig",
      });
    });

    it("mine() calls list with trader address", async () => {
      await orders.mine("m1");

      expect(http.get).toHaveBeenCalledWith("/orders", {
        trader: ADDR,
        marketId: "m1",
        status: undefined,
        cursor: undefined,
        limit: undefined,
      });
    });

    it("bulkCreate() signs all and returns results with errors", async () => {
      (http.post as any).mockResolvedValue({
        results: [{ success: true, order: {} }],
        errors: [{ index: 1, message: "failed" }],
      });

      const reqs = [
        { marketId: "0xa", outcome: "yes" as const, side: "buy" as const, priceCents: 25, size: 5 },
      ];

      const result = await orders.bulkCreate(reqs);

      expect(builder.buildAndSign).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(
        "/orders/bulk/create",
        expect.objectContaining({ orders: expect.any(Array) }),
      );
      expect(result).toEqual({
        results: [{ success: true, order: {} }],
        errors: [{ index: 1, message: "failed" }],
      });
    });

    it("bulkCancel() signs all and returns results with errors", async () => {
      (http.post as any).mockResolvedValue({
        results: [{ success: true }],
        errors: [{ nonce: "0xn2", message: "failed" }],
      });

      const nonces = ["0xn1" as Hex];
      const result = await orders.bulkCancel(nonces);

      expect(builder.signCancel).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(
        "/orders/bulk/cancel",
        expect.objectContaining({ cancels: expect.any(Array) }),
      );
      expect(result).toEqual({
        results: [{ success: true }],
        errors: [{ nonce: "0xn2", message: "failed" }],
      });
    });
  });

  describe("write operations without signer throw", () => {
    let orders: Orders;

    beforeEach(() => {
      const http = createMockHttp();
      orders = new Orders(http, null, null);
    });

    it("create() throws ContextConfigError", async () => {
      await expect(
        orders.create({
          marketId: "0xa",
          outcome: "yes",
          side: "buy",
          priceCents: 25,
          size: 5,
        }),
      ).rejects.toThrow(ContextConfigError);
    });

    it("cancel() throws ContextConfigError", async () => {
      await expect(orders.cancel("0xnonce" as Hex)).rejects.toThrow(
        ContextConfigError,
      );
    });

    it("mine() throws ContextConfigError", async () => {
      await expect(orders.mine()).rejects.toThrow(ContextConfigError);
    });
  });
});
