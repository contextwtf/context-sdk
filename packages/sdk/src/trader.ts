import {
  type Account,
  type Address,
  type Hex,
  type WalletClient,
  createPublicClient,
  http,
  maxUint256,
} from "viem";
import { baseSepolia } from "viem/chains";
import { ContextClient } from "./client.js";
import {
  SETTLEMENT_ADDRESS,
  HOLDINGS_ADDRESS,
  USDC_ADDRESS,
  ERC20_ABI,
  HOLDINGS_ABI,
} from "./constants.js";
import { ContextConfigError } from "./errors.js";
import { encodePriceCents, encodeSize, calculateMaxFee } from "./encoding.js";
import {
  resolveSigner,
  randomNonce,
  signOrder,
  signCancel,
  type OrderMessage,
} from "./signing.js";
import type {
  ContextTraderOptions,
  PlaceOrderRequest,
  Order,
  CancelResult,
  CancelReplaceResult,
  Portfolio,
  Balance,
  WalletStatus,
  WalletSetupResult,
} from "./types.js";

/**
 * Trading client for Context Markets.
 * Extends ContextClient with signing + order management.
 */
export class ContextTrader extends ContextClient {
  private readonly account: Account;
  private readonly walletClient: WalletClient;

  constructor(options: ContextTraderOptions) {
    super({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });

    if (!options.signer) {
      throw new ContextConfigError("signer is required for ContextTrader");
    }

    const resolved = resolveSigner(options.signer);
    this.account = resolved.account;
    this.walletClient = resolved.walletClient;
  }

  /** The trader's on-chain address. */
  get address(): Address {
    return this.account.address;
  }

  // ─── Order Placement ───

  async placeOrder(req: PlaceOrderRequest): Promise<Order> {
    const price = encodePriceCents(req.priceCents);
    const size = encodeSize(req.size);
    const maxFee = calculateMaxFee(price, size);
    const nonce = randomNonce();
    const expirySeconds = req.expirySeconds ?? 3600;
    const expiry = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);

    const order: OrderMessage = {
      marketId: req.marketId as Hex,
      trader: this.address,
      price,
      size,
      outcomeIndex: req.outcome === "yes" ? 0 : 1,
      side: req.side === "buy" ? 0 : 1,
      nonce,
      expiry,
      maxFee,
      makerRoleConstraint: 0,
      inventoryModeConstraint: 0,
    };

    const signature = await signOrder(
      this.walletClient,
      this.account,
      order,
    );

    return this.http.post<Order>("/orders", {
      type: "limit",
      ...order,
      price: order.price.toString(),
      size: order.size.toString(),
      expiry: order.expiry.toString(),
      maxFee: order.maxFee.toString(),
      signature,
    });
  }

  // ─── Order Cancellation ───

  async cancelOrder(nonce: Hex): Promise<CancelResult> {
    const signature = await signCancel(
      this.walletClient,
      this.account,
      this.address,
      nonce,
    );

    return this.http.post<CancelResult>("/orders/cancels", {
      trader: this.address,
      nonce,
      signature,
    });
  }

  // ─── Cancel + Replace (atomic) ───

  async cancelReplace(
    cancelNonce: Hex,
    newOrder: PlaceOrderRequest,
  ): Promise<CancelReplaceResult> {
    // Sign cancel
    const cancelSig = await signCancel(
      this.walletClient,
      this.account,
      this.address,
      cancelNonce,
    );

    // Build + sign new order
    const price = encodePriceCents(newOrder.priceCents);
    const size = encodeSize(newOrder.size);
    const maxFee = calculateMaxFee(price, size);
    const nonce = randomNonce();
    const expirySeconds = newOrder.expirySeconds ?? 3600;
    const expiry = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);

    const order: OrderMessage = {
      marketId: newOrder.marketId as Hex,
      trader: this.address,
      price,
      size,
      outcomeIndex: newOrder.outcome === "yes" ? 0 : 1,
      side: newOrder.side === "buy" ? 0 : 1,
      nonce,
      expiry,
      maxFee,
      makerRoleConstraint: 0,
      inventoryModeConstraint: 0,
    };

    const orderSig = await signOrder(
      this.walletClient,
      this.account,
      order,
    );

    return this.http.post<CancelReplaceResult>("/orders/cancel-replace", {
      cancel: {
        trader: this.address,
        nonce: cancelNonce,
        signature: cancelSig,
      },
      create: {
        type: "limit",
        ...order,
        price: order.price.toString(),
        size: order.size.toString(),
        expiry: order.expiry.toString(),
        maxFee: order.maxFee.toString(),
        signature: orderSig,
      },
    });
  }

  // ─── Bulk Operations ───

  async bulkCreateOrders(
    orders: PlaceOrderRequest[],
  ): Promise<Order[]> {
    const signed = await Promise.all(
      orders.map(async (req) => {
        const price = encodePriceCents(req.priceCents);
        const size = encodeSize(req.size);
        const maxFee = calculateMaxFee(price, size);
        const nonce = randomNonce();
        const expirySeconds = req.expirySeconds ?? 3600;
        const expiry = BigInt(
          Math.floor(Date.now() / 1000) + expirySeconds,
        );

        const order: OrderMessage = {
          marketId: req.marketId as Hex,
          trader: this.address,
          price,
          size,
          outcomeIndex: req.outcome === "yes" ? 0 : 1,
          side: req.side === "buy" ? 0 : 1,
          nonce,
          expiry,
          maxFee,
          makerRoleConstraint: 0,
          inventoryModeConstraint: 0,
        };

        const signature = await signOrder(
          this.walletClient,
          this.account,
          order,
        );

        return {
          type: "limit" as const,
          ...order,
          price: order.price.toString(),
          size: order.size.toString(),
          expiry: order.expiry.toString(),
          maxFee: order.maxFee.toString(),
          signature,
        };
      }),
    );

    return this.http.post<Order[]>("/orders/bulk/create", {
      orders: signed,
    });
  }

  async bulkCancelOrders(nonces: Hex[]): Promise<CancelResult[]> {
    const cancels = await Promise.all(
      nonces.map(async (nonce) => {
        const signature = await signCancel(
          this.walletClient,
          this.account,
          this.address,
          nonce,
        );
        return { trader: this.address, nonce, signature };
      }),
    );

    return this.http.post<CancelResult[]>("/orders/bulk/cancel", {
      cancels,
    });
  }

  // ─── Convenience: "My" Methods ───

  async getMyOrders(marketId?: string): Promise<Order[]> {
    return this.getOrders({
      trader: this.address,
      marketId,
    });
  }

  async getMyPortfolio(): Promise<Portfolio> {
    return this.getPortfolio(this.address);
  }

  async getMyBalance(): Promise<Balance> {
    return this.getBalance(this.address);
  }

  // ─── Wallet Setup ───

  async checkSetup(): Promise<WalletStatus> {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });

    const [ethBalance, usdcAllowance, isOperatorApproved] =
      await Promise.all([
        publicClient.getBalance({ address: this.address }),
        publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [this.address, HOLDINGS_ADDRESS],
        }),
        publicClient.readContract({
          address: HOLDINGS_ADDRESS,
          abi: HOLDINGS_ABI,
          functionName: "isApprovedForAll",
          args: [this.address, SETTLEMENT_ADDRESS],
        }),
      ]);

    return {
      address: this.address,
      ethBalance,
      usdcAllowance,
      isOperatorApproved,
      needsApprovals:
        usdcAllowance === 0n || !isOperatorApproved,
    };
  }

  async setupWallet(): Promise<WalletSetupResult> {
    const status = await this.checkSetup();
    let usdcApprovalTx: Hex | null = null;
    let operatorApprovalTx: Hex | null = null;

    if (status.usdcAllowance === 0n) {
      usdcApprovalTx = await this.walletClient.writeContract({
        account: this.account,
        chain: baseSepolia,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [HOLDINGS_ADDRESS, maxUint256],
      });
    }

    if (!status.isOperatorApproved) {
      operatorApprovalTx = await this.walletClient.writeContract({
        account: this.account,
        chain: baseSepolia,
        address: HOLDINGS_ADDRESS,
        abi: HOLDINGS_ABI,
        functionName: "setApprovalForAll",
        args: [SETTLEMENT_ADDRESS, true],
      });
    }

    return { usdcApprovalTx, operatorApprovalTx };
  }

  async mintTestUsdc(amount: number = 1000): Promise<unknown> {
    return this.http.post("/balance/mint-test-usdc", {
      address: this.address,
      amount: amount.toString(),
    });
  }
}
