import { describe, it, expect, vi, beforeEach } from "vitest";
import { PortfolioModule } from "../../src/modules/portfolio.js";
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
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${ADDR}`);
    });

    it("get() uses explicit address when provided", async () => {
      const other = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
      await portfolio.get(other);
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${other}`);
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
  });

  describe("without default address (no signer)", () => {
    let portfolio: PortfolioModule;

    beforeEach(() => {
      const http = createMockHttp();
      portfolio = new PortfolioModule(http, null);
    });

    it("get() throws when no address provided and no default", async () => {
      await expect(portfolio.get()).rejects.toThrow("Address required");
    });

    it("balance() throws when no address provided and no default", async () => {
      await expect(portfolio.balance()).rejects.toThrow("Address required");
    });

    it("get() works with explicit address even without signer", async () => {
      const http = createMockHttp();
      const p = new PortfolioModule(http, null);
      await p.get(ADDR);
      expect(http.get).toHaveBeenCalledWith(`/portfolio/${ADDR}`);
    });
  });
});
