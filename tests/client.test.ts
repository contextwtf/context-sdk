import { describe, it, expect } from "vitest";
import { ContextClient } from "../src/client.js";
import { Markets } from "../src/modules/markets.js";
import { Orders } from "../src/modules/orders.js";
import { PortfolioModule } from "../src/modules/portfolio.js";
import { AccountModule } from "../src/modules/account.js";

describe("ContextClient", () => {
  it("constructs with no options (read-only)", () => {
    const ctx = new ContextClient();

    expect(ctx.markets).toBeInstanceOf(Markets);
    expect(ctx.orders).toBeInstanceOf(Orders);
    expect(ctx.portfolio).toBeInstanceOf(PortfolioModule);
    expect(ctx.account).toBeInstanceOf(AccountModule);
    expect(ctx.address).toBeNull();
  });

  it("constructs with signer and resolves address", () => {
    const ctx = new ContextClient({
      apiKey: "test-key",
      signer: {
        privateKey:
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      },
    });

    expect(ctx.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(ctx.markets).toBeInstanceOf(Markets);
    expect(ctx.orders).toBeInstanceOf(Orders);
  });

  it("exposes all four module namespaces", () => {
    const ctx = new ContextClient();

    expect(ctx).toHaveProperty("markets");
    expect(ctx).toHaveProperty("orders");
    expect(ctx).toHaveProperty("portfolio");
    expect(ctx).toHaveProperty("account");
  });
});
