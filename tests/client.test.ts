import { describe, it, expect } from "vitest";
import { ContextClient } from "../src/client.js";
import { MAINNET_CONFIG, TESTNET_CONFIG } from "../src/config.js";
import { Markets } from "../src/modules/markets.js";
import { Questions } from "../src/modules/questions.js";
import { Orders } from "../src/modules/orders.js";
import { PortfolioModule } from "../src/modules/portfolio.js";
import { AccountModule } from "../src/modules/account.js";
import { MigrationModule } from "../src/modules/migration.js";

describe("ContextClient", () => {
  it("constructs with no options (read-only)", () => {
    const ctx = new ContextClient();

    expect(ctx.markets).toBeInstanceOf(Markets);
    expect(ctx.questions).toBeInstanceOf(Questions);
    expect(ctx.orders).toBeInstanceOf(Orders);
    expect(ctx.portfolio).toBeInstanceOf(PortfolioModule);
    expect(ctx.account).toBeInstanceOf(AccountModule);
    expect(ctx.migration).toBeInstanceOf(MigrationModule);
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
    expect(ctx.questions).toBeInstanceOf(Questions);
    expect(ctx.orders).toBeInstanceOf(Orders);
  });

  it("exposes all module namespaces", () => {
    const ctx = new ContextClient();

    expect(ctx).toHaveProperty("markets");
    expect(ctx).toHaveProperty("questions");
    expect(ctx).toHaveProperty("orders");
    expect(ctx).toHaveProperty("portfolio");
    expect(ctx).toHaveProperty("account");
    expect(ctx).toHaveProperty("migration");
  });

  it("defaults both chain presets to the migrated signing path", () => {
    expect(MAINNET_CONFIG.defaultSettlementVersion).toBe(2);
    expect(TESTNET_CONFIG.defaultSettlementVersion).toBe(2);

    const ctx = new ContextClient();
    expect(ctx.chainConfig.defaultSettlementVersion).toBe(2);
  });
});
