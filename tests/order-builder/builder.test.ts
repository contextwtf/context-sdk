import { describe, it, expect, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { OrderBuilder } from "../../src/order-builder/builder.js";
import { MAINNET_CONFIG } from "../../src/config.js";
import { ContextConfigError } from "../../src/errors.js";

const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

describe("OrderBuilder", () => {
  it("rejects invalid marketId for limit orders before signing", async () => {
    const walletClient = {
      signTypedData: vi.fn(),
    } as any;
    const builder = new OrderBuilder(walletClient, account, MAINNET_CONFIG);

    await expect(
      builder.buildAndSign({
        marketId: "invalid-market-id",
        outcome: "yes",
        side: "buy",
        priceCents: 42,
        size: 5,
      }),
    ).rejects.toThrow(ContextConfigError);

    expect(walletClient.signTypedData).not.toHaveBeenCalled();
  });

  it("rejects invalid marketId for market orders before signing", async () => {
    const walletClient = {
      signTypedData: vi.fn(),
    } as any;
    const builder = new OrderBuilder(walletClient, account, MAINNET_CONFIG);

    await expect(
      builder.buildAndSignMarket({
        marketId: "0x1234",
        outcome: "no",
        side: "sell",
        maxPriceCents: 70,
        maxSize: 3,
      }),
    ).rejects.toThrow(ContextConfigError);

    expect(walletClient.signTypedData).not.toHaveBeenCalled();
  });
});
