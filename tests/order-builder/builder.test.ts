import { describe, it, expect, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { OrderBuilder } from "../../src/order-builder/builder.js";
import {
  MAINNET_CONFIG,
  TESTNET_CONFIG,
  TIME_IN_FORCE_IOC,
} from "../../src/config.js";
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

  it("signs limit orders against SettlementV2 by default", async () => {
    const walletClient = {
      signTypedData: vi.fn().mockResolvedValue("0xsig"),
    } as any;
    const builder = new OrderBuilder(walletClient, account, MAINNET_CONFIG);

    await builder.buildAndSign({
      marketId:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      outcome: "yes",
      side: "buy",
      priceCents: 42,
      size: 5,
      buyValue: 3,
      timeInForce: TIME_IN_FORCE_IOC,
    });

    expect(walletClient.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: expect.objectContaining({
          version: "2",
          verifyingContract: MAINNET_CONFIG.settlementV2,
        }),
        primaryType: "Order",
      }),
    );
  });

  it("signs cancels against the requested settlement version", async () => {
    const walletClient = {
      signTypedData: vi.fn().mockResolvedValue("0xcancel"),
    } as any;
    const builder = new OrderBuilder(walletClient, account, MAINNET_CONFIG);

    await builder.signCancel(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
      2,
    );

    expect(walletClient.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: expect.objectContaining({
          version: "2",
          verifyingContract: MAINNET_CONFIG.settlementV2,
        }),
      }),
    );
  });

  it("rejects explicit legacy order signing", async () => {
    const walletClient = {
      signTypedData: vi.fn().mockResolvedValue("0xsig"),
    } as any;
    const builder = new OrderBuilder(walletClient, account, MAINNET_CONFIG);

    await expect(
      builder.buildAndSign({
        marketId:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        outcome: "yes",
        side: "buy",
        priceCents: 42,
        size: 5,
        settlementVersion: 1,
      }),
    ).rejects.toThrow(ContextConfigError);
  });

  it("rejects explicit legacy cancel signing", async () => {
    const walletClient = {
      signTypedData: vi.fn().mockResolvedValue("0xcancel"),
    } as any;
    const builder = new OrderBuilder(walletClient, account, MAINNET_CONFIG);

    await expect(
      builder.signCancel(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
        1,
      ),
    ).rejects.toThrow(ContextConfigError);
  });

  it("uses an IOC limit payload for v2 market-style orders", async () => {
    const walletClient = {
      signTypedData: vi.fn().mockResolvedValue("0xsig"),
    } as any;
    const builder = new OrderBuilder(walletClient, account, TESTNET_CONFIG);

    const signed = await builder.buildAndSignMarket({
      marketId:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      outcome: "no",
      side: "sell",
      maxPriceCents: 70,
      maxSize: 3,
    });

    expect(signed).toEqual(
      expect.objectContaining({
        type: "limit",
        clientOrderType: "market",
        timeInForce: TIME_IN_FORCE_IOC,
      }),
    );
  });

  it("treats v2 buy market maxSize as a pre-fee collateral budget", async () => {
    const walletClient = {
      signTypedData: vi.fn().mockResolvedValue("0xsig"),
    } as any;
    const builder = new OrderBuilder(walletClient, account, TESTNET_CONFIG);

    const signed = await builder.buildAndSignMarket({
      marketId:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      outcome: "yes",
      side: "buy",
      maxPriceCents: 50,
      maxSize: 1,
      settlementVersion: 2,
    });

    expect(signed).toEqual(
      expect.objectContaining({
        type: "limit",
        clientOrderType: "market",
        timeInForce: TIME_IN_FORCE_IOC,
        // maxSize/$1 is the pre-fee budget; maxFee is still added on top by
        // the shared SettlementV2 signing contract when producing maxCollateralIn.
        buyValue: "1000000",
        size: "2000000",
      }),
    );
  });
});
