import type { Account, Address, Hex, WalletClient } from "viem";
import { DEFAULT_EXPIRY_SECONDS } from "../constants.js";
import {
  TIME_IN_FORCE_IOC,
  type ChainConfig,
  type SettlementVersion,
} from "../config.js";
import {
  legacyLimitOrderToSettlementV2Order,
  randomNonce,
  signCancel,
  signSettlementV2Order,
  type OrderMessage,
} from "../signing/eip712.js";
import {
  encodePriceCents,
  encodeSize,
  decodeSize,
  calculateMaxFee,
  estimateSharesForBuyBudget,
} from "./helpers.js";
import type { PlaceOrderRequest, PlaceMarketOrderRequest } from "../types.js";
import { ContextConfigError } from "../errors.js";
import { validateMarketId } from "../validation.js";

export interface SignedOrder {
  type: "limit";
  marketId: Hex;
  trader: Address;
  price: string;
  size: string;
  buyValue?: string;
  outcomeIndex: number;
  side: number;
  nonce: Hex;
  expiry: string;
  maxFee: string;
  timeInForce?: number;
  clientOrderType?: "limit" | "market";
  makerRoleConstraint: number;
  inventoryModeConstraint: number;
  signature: Hex;
}

export class OrderBuilder {
  constructor(
    private readonly walletClient: WalletClient,
    private readonly account: Account,
    private readonly chainConfig: ChainConfig,
  ) {}

  get address(): Address {
    return this.account.address;
  }

  private resolveNonce(nonce?: Hex) {
    return nonce ?? randomNonce();
  }

  private resolveExpiry({
    expiry,
    expirySeconds,
  }: {
    expiry?: string | bigint;
    expirySeconds?: number;
  }) {
    if (typeof expiry === "bigint") return expiry;
    if (typeof expiry === "string") return BigInt(expiry);
    const seconds = expirySeconds ?? DEFAULT_EXPIRY_SECONDS;
    return BigInt(Math.floor(Date.now() / 1000) + seconds);
  }

  private resolveMaxFee({
    maxFee,
    price,
    size,
  }: {
    maxFee?: string | bigint;
    price: bigint;
    size: bigint;
  }) {
    if (typeof maxFee === "bigint") return maxFee;
    if (typeof maxFee === "string") return BigInt(maxFee);
    return calculateMaxFee(price, size);
  }

  private requireSettlementV2(
    settlementVersion: SettlementVersion,
    operation: string,
  ) {
    if (settlementVersion !== 2) {
      throw new ContextConfigError(
        `${operation} only supports SettlementV2 signing.`,
      );
    }
  }

  async buildAndSign(req: PlaceOrderRequest): Promise<SignedOrder> {
    const marketId = validateMarketId(req.marketId);
    const price = encodePriceCents(req.priceCents);
    const size = encodeSize(req.size);
    const maxFee = this.resolveMaxFee({ maxFee: req.maxFee, price, size });
    const nonce = this.resolveNonce(req.nonce);
    const expiry = this.resolveExpiry({
      expiry: req.expiry,
      expirySeconds: req.expirySeconds,
    });
    const settlementVersion =
      req.settlementVersion ?? this.chainConfig.defaultSettlementVersion;
    this.requireSettlementV2(settlementVersion, "Order creation");
    const buyValue =
      req.buyValue !== undefined ? encodeSize(req.buyValue) : undefined;
    const timeInForce = req.timeInForce;
    const clientOrderType = req.clientOrderType;

    const order: OrderMessage = {
      marketId,
      trader: this.address,
      price,
      size,
      outcomeIndex: req.outcome === "yes" ? 1 : 0,
      side: req.side === "buy" ? 0 : 1,
      nonce,
      expiry,
      maxFee,
      makerRoleConstraint: req.makerRoleConstraint ?? 0,
      inventoryModeConstraint: req.inventoryModeConstraint ?? 0,
    };

    const signature = await signSettlementV2Order(
      this.walletClient,
      this.account,
      legacyLimitOrderToSettlementV2Order({
        ...order,
        buyValue,
        timeInForce,
      }),
      this.chainConfig,
    );

    return {
      type: "limit",
      ...order,
      price: order.price.toString(),
      size: order.size.toString(),
      ...(buyValue !== undefined ? { buyValue: buyValue.toString() } : {}),
      expiry: order.expiry.toString(),
      maxFee: order.maxFee.toString(),
      ...(timeInForce !== undefined ? { timeInForce } : {}),
      ...(clientOrderType !== undefined ? { clientOrderType } : {}),
      signature,
    };
  }

  async buildAndSignMarket(
    req: PlaceMarketOrderRequest,
  ): Promise<SignedOrder> {
    const settlementVersion =
      req.settlementVersion ?? this.chainConfig.defaultSettlementVersion;
    this.requireSettlementV2(settlementVersion, "Market order creation");

    let size = req.maxSize;
    let buyBudget: number | undefined;

    if (req.side === "buy") {
      buyBudget = req.buyValue ?? req.maxSize;
      size = decodeSize(
        estimateSharesForBuyBudget(
          encodeSize(buyBudget),
          encodePriceCents(req.maxPriceCents),
        ),
      );
    }

    return this.buildAndSign({
      marketId: req.marketId,
      outcome: req.outcome,
      side: req.side,
      priceCents: req.maxPriceCents,
      size,
      ...(buyBudget !== undefined ? { buyValue: buyBudget } : {}),
      expirySeconds: req.expirySeconds,
      timeInForce: req.timeInForce ?? TIME_IN_FORCE_IOC,
      clientOrderType: req.clientOrderType ?? "market",
      makerRoleConstraint: req.makerRoleConstraint,
      inventoryModeConstraint: req.inventoryModeConstraint,
      settlementVersion,
    });
  }

  async signCancel(
    nonce: Hex,
    settlementVersion: SettlementVersion = this.chainConfig.defaultSettlementVersion,
  ): Promise<Hex> {
    this.requireSettlementV2(settlementVersion, "Order cancellation");
    return signCancel(
      this.walletClient,
      this.account,
      this.address,
      nonce,
      this.chainConfig,
      settlementVersion,
    );
  }
}
