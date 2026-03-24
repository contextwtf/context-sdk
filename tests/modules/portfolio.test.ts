import { describe, it, expect, vi, beforeEach } from "vitest";
import { PortfolioModule } from "../../src/modules/portfolio.js";
import { ContextConfigError } from "../../src/errors.js";
import type { HttpClient } from "../../src/http.js";
import type { Address } from "viem";

function createMockHttp(): HttpClient {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };
}

const ADDR = "0x1234567890abcdef1234567890abcdef12345678" as Address;

describe("PortfolioModule", () => {
  describe("with default address (signer configured)", () => {
    let http: ReturnType<typeof createMockHttp>;
    let portfolio: PortfolioModule;

    beforeEach(() => {
      http = createMockHttp();
      portfolio = new PortfolioModule(http, ADDR);
    });

    it("get() uses default address when none provided", async () => {
      await portfolio.get();
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${ADDR}`, {
        kind: undefined,
        marketId: undefined,
        cursor: undefined,
        pageSize: undefined,
      });
    });

    it("get() uses explicit address when provided", async () => {
      const other = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
      await portfolio.get(other);
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${other}`, {
        kind: undefined,
        marketId: undefined,
        cursor: undefined,
        pageSize: undefined,
      });
    });

    it("get() passes params through", async () => {
      await portfolio.get(undefined, {
        kind: "active",
        marketId: "m1",
        cursor: "abc",
        pageSize: 10,
      });
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${ADDR}`, {
        kind: "active",
        marketId: "m1",
        cursor: "abc",
        pageSize: 10,
      });
    });

    it("claimable() uses default address", async () => {
      await portfolio.claimable();
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${ADDR}/claimable`);
    });

    it("claimable() uses explicit address", async () => {
      const other = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
      await portfolio.claimable(other);
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${other}/claimable`);
    });

    it("stats() uses default address", async () => {
      await portfolio.stats();
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${ADDR}/stats`);
    });

    it("stats() uses explicit address", async () => {
      const other = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
      await portfolio.stats(other);
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${other}/stats`);
    });

    it("balance() uses default address when none provided", async () => {
      await portfolio.balance();
      expect(http.get).toHaveBeenCalledWith(`/balance/${ADDR}`);
    });

    it("balance() uses explicit address when provided", async () => {
      const other = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
      await portfolio.balance(other);
      expect(http.get).toHaveBeenCalledWith(`/balance/${other}`);
    });

    it("tokenBalance() calls GET /balance with address and tokenAddress", async () => {
      const token = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
      await portfolio.tokenBalance(ADDR, token);
      expect(http.get).toHaveBeenCalledWith("/balance", {
        address: ADDR,
        tokenAddress: token,
      });
    });
  });

  describe("without default address (no signer)", () => {
    let portfolio: PortfolioModule;

    beforeEach(() => {
      const http = createMockHttp();
      portfolio = new PortfolioModule(http, null);
    });

    it("get() throws when no address provided and no default", async () => {
      await expect(portfolio.get()).rejects.toThrow(ContextConfigError);
    });

    it("balance() throws when no address provided and no default", async () => {
      await expect(portfolio.balance()).rejects.toThrow(ContextConfigError);
    });

    it("claimable() throws when no address provided and no default", async () => {
      await expect(portfolio.claimable()).rejects.toThrow(ContextConfigError);
    });

    it("stats() throws when no address provided and no default", async () => {
      await expect(portfolio.stats()).rejects.toThrow(ContextConfigError);
    });

    it("get() works with explicit address even without signer", async () => {
      const http = createMockHttp();
      const p = new PortfolioModule(http, null);
      await p.get(ADDR);
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${ADDR}`, {
        kind: undefined,
        marketId: undefined,
        cursor: undefined,
        pageSize: undefined,
      });
    });
  });
});
