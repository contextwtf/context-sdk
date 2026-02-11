import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orders } from "../../src/modules/orders.js";
import { ContextConfigError } from "../../src/errors.js";
import type { HttpClient } from "../../src/http.js";
import type { OrderBuilder } from "../../src/order-builder/builder.js";
import type { Address, Hex } from "viem";

function createMockHttp(): HttpClient {
  return {
    get: vi.fn().mockResolvedValue([]),
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

    it("list() calls GET /orders with params", async () => {
      await orders.list({ trader: ADDR, marketId: "m1", limit: 10 });

      expect(http.get).toHaveBeenCalledWith("/orders", {
        trader: ADDR,
        marketId: "m1",
        cursor: undefined,
        limit: 10,
      });
    });

    it("list() works without params", async () => {
      await orders.list();

      expect(http.get).toHaveBeenCalledWith("/orders", {
        trader: undefined,
        marketId: undefined,
        cursor: undefined,
        limit: undefined,
      });
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

    it("create() builds, signs, and posts order", async () => {
      const req = {
        marketId: "0xabc",
        outcome: "yes" as const,
        side: "buy" as const,
        priceCents: 25,
        size: 5,
      };

      await orders.create(req);

      expect(builder.buildAndSign).toHaveBeenCalledWith(req);
      expect(http.post).toHaveBeenCalledWith(
        "/orders",
        expect.objectContaining({ type: "limit", signature: "0xsig" }),
      );
    });

    it("cancel() signs and posts cancel", async () => {
      const nonce = "0xnonce123" as Hex;

      await orders.cancel(nonce);

      expect(builder.signCancel).toHaveBeenCalledWith(nonce);
      expect(http.post).toHaveBeenCalledWith("/orders/cancels", {
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
        cursor: undefined,
        limit: undefined,
      });
    });

    it("bulkCreate() signs all orders in parallel", async () => {
      const reqs = [
        { marketId: "0xa", outcome: "yes" as const, side: "buy" as const, priceCents: 25, size: 5 },
        { marketId: "0xb", outcome: "no" as const, side: "sell" as const, priceCents: 75, size: 3 },
      ];

      await orders.bulkCreate(reqs);

      expect(builder.buildAndSign).toHaveBeenCalledTimes(2);
      expect(http.post).toHaveBeenCalledWith(
        "/orders/bulk/create",
        expect.objectContaining({ orders: expect.any(Array) }),
      );
    });

    it("bulkCancel() signs all cancels in parallel", async () => {
      const nonces = ["0xn1" as Hex, "0xn2" as Hex];

      await orders.bulkCancel(nonces);

      expect(builder.signCancel).toHaveBeenCalledTimes(2);
      expect(http.post).toHaveBeenCalledWith(
        "/orders/bulk/cancel",
        expect.objectContaining({ cancels: expect.any(Array) }),
      );
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
