import type { Account, Address, Hex, WalletClient } from "viem";
import { DEFAULT_EXPIRY_SECONDS } from "../constants.js";
import {
  randomNonce,
  signOrder,
  signMarketOrderIntent,
  signCancel,
  type OrderMessage,
  type MarketOrderIntentMessage,
} from "../signing/eip712.js";
import { encodePriceCents, encodeSize, calculateMaxFee } from "./helpers.js";
import type { PlaceOrderRequest, PlaceMarketOrderRequest } from "../types.js";

export interface SignedOrder {
  type: "limit";
  marketId: Hex;
  trader: Address;
  price: string;
  size: string;
  outcomeIndex: number;
  side: number;
  nonce: Hex;
  expiry: string;
  maxFee: string;
  makerRoleConstraint: number;
  inventoryModeConstraint: number;
  signature: Hex;
}

export interface SignedMarketOrder {
  type: "market";
  marketId: Hex;
  trader: Address;
  maxPrice: string;
  maxSize: string;
  outcomeIndex: number;
  side: number;
  nonce: Hex;
  expiry: string;
  maxFee: string;
  signature: Hex;
}

export class OrderBuilder {
  constructor(
    private readonly walletClient: WalletClient,
    private readonly account: Account,
  ) {}

  get address(): Address {
    return this.account.address;
  }

  async buildAndSign(req: PlaceOrderRequest): Promise<SignedOrder> {
    const price = encodePriceCents(req.priceCents);
    const size = encodeSize(req.size);
    const maxFee = calculateMaxFee(price, size);
    const nonce = randomNonce();
    const expirySeconds = req.expirySeconds ?? DEFAULT_EXPIRY_SECONDS;
    const expiry = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);

    const order: OrderMessage = {
      marketId: req.marketId as Hex,
      trader: this.address,
      price,
      size,
      outcomeIndex: req.outcome === "yes" ? 1 : 0,
      side: req.side === "buy" ? 0 : 1,
      nonce,
      expiry,
      maxFee,
      makerRoleConstraint: 0,
      inventoryModeConstraint: 0,
    };

    const signature = await signOrder(this.walletClient, this.account, order);

    return {
      type: "limit",
      ...order,
      price: order.price.toString(),
      size: order.size.toString(),
      expiry: order.expiry.toString(),
      maxFee: order.maxFee.toString(),
      signature,
    };
  }

  async buildAndSignMarket(req: PlaceMarketOrderRequest): Promise<SignedMarketOrder> {
    const maxPrice = encodePriceCents(req.maxPriceCents);
    const maxSize = encodeSize(req.maxSize);
    const maxFee = calculateMaxFee(maxPrice, maxSize);
    const nonce = randomNonce();
    const expirySeconds = req.expirySeconds ?? DEFAULT_EXPIRY_SECONDS;
    const expiry = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);

    const intent: MarketOrderIntentMessage = {
      marketId: req.marketId as Hex,
      trader: this.address,
      maxPrice,
      maxSize,
      outcomeIndex: req.outcome === "yes" ? 1 : 0,
      side: req.side === "buy" ? 0 : 1,
      nonce,
      expiry,
      maxFee,
    };

    const signature = await signMarketOrderIntent(
      this.walletClient,
      this.account,
      intent,
    );

    return {
      type: "market",
      ...intent,
      maxPrice: intent.maxPrice.toString(),
      maxSize: intent.maxSize.toString(),
      expiry: intent.expiry.toString(),
      maxFee: intent.maxFee.toString(),
      signature,
    };
  }

  async signCancel(nonce: Hex): Promise<Hex> {
    return signCancel(
      this.walletClient,
      this.account,
      this.address,
      nonce,
    );
  }
}
