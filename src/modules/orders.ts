import type { Address, Hex } from "viem";
import type { HttpClient } from "../http.js";
import { ENDPOINTS } from "../endpoints.js";
import type { OrderBuilder } from "../order-builder/builder.js";
import { ContextConfigError } from "../errors.js";
import type {
  PlaceOrderRequest,
  PlaceMarketOrderRequest,
  Order,
  OrderList,
  CreateOrderResult,
  CancelResult,
  CancelReplaceResult,
  BulkCreateResult,
  BulkCancelResult,
  BulkResult,
  GetOrdersParams,
  GetRecentOrdersParams,
  OrderSimulateParams,
  OrderSimulateResult,
} from "../types.js";

export class Orders {
  constructor(
    private readonly http: HttpClient,
    private readonly builder: OrderBuilder | null,
    private readonly address: Address | null,
  ) {}

  private requireSigner(): OrderBuilder {
    if (!this.builder) {
      throw new ContextConfigError(
        "A signer is required for write operations. Pass a signer to ContextClient.",
      );
    }
    return this.builder;
  }

  private requireAddress(): Address {
    if (!this.address) {
      throw new ContextConfigError(
        "A signer is required for this operation. Pass a signer to ContextClient.",
      );
    }
    return this.address;
  }

  // ─── Read ───

  async list(params?: GetOrdersParams): Promise<OrderList> {
    return this.http.get<OrderList>(ENDPOINTS.orders.list, {
      trader: params?.trader,
      marketId: params?.marketId,
      status: params?.status,
      cursor: params?.cursor,
      limit: params?.limit,
    });
  }

  async listAll(
    params?: Omit<GetOrdersParams, "cursor">,
  ): Promise<Order[]> {
    const allOrders: Order[] = [];
    let cursor: string | undefined;

    do {
      const res = await this.http.get<OrderList>(ENDPOINTS.orders.list, {
        trader: params?.trader,
        marketId: params?.marketId,
        status: params?.status,
        cursor,
      });

      const orders = res.orders ?? [];
      allOrders.push(...orders);
      cursor = res.cursor ?? undefined;

      if (orders.length === 0) break;
    } while (cursor);

    return allOrders;
  }

  async mine(marketId?: string): Promise<OrderList> {
    return this.list({
      trader: this.requireAddress(),
      marketId,
    });
  }

  async allMine(marketId?: string): Promise<Order[]> {
    return this.listAll({
      trader: this.requireAddress(),
      marketId,
    });
  }

  async get(id: string): Promise<Order> {
    const res = await this.http.get<{ order: Order }>(
      ENDPOINTS.orders.get(id),
    );
    return res.order;
  }

  async recent(params?: GetRecentOrdersParams): Promise<OrderList> {
    return this.http.get<OrderList>(ENDPOINTS.orders.recent, {
      trader: params?.trader,
      marketId: params?.marketId,
      status: params?.status,
      limit: params?.limit,
      windowSeconds: params?.windowSeconds,
    });
  }

  async simulate(params: OrderSimulateParams): Promise<OrderSimulateResult> {
    return this.http.post<OrderSimulateResult>(
      ENDPOINTS.orders.simulate,
      params,
    );
  }

  // ─── Write ───

  async create(req: PlaceOrderRequest): Promise<CreateOrderResult> {
    const builder = this.requireSigner();
    const signed = await builder.buildAndSign(req);
    return this.http.post<CreateOrderResult>(ENDPOINTS.orders.create, signed);
  }

  async createMarket(req: PlaceMarketOrderRequest): Promise<CreateOrderResult> {
    const builder = this.requireSigner();
    const signed = await builder.buildAndSignMarket(req);
    return this.http.post<CreateOrderResult>(ENDPOINTS.orders.create, signed);
  }

  async cancel(nonce: Hex): Promise<CancelResult> {
    const builder = this.requireSigner();
    const signature = await builder.signCancel(nonce);
    return this.http.post<CancelResult>(ENDPOINTS.orders.cancel, {
      trader: builder.address,
      nonce,
      signature,
    });
  }

  async cancelReplace(
    cancelNonce: Hex,
    newOrder: PlaceOrderRequest,
  ): Promise<CancelReplaceResult> {
    const builder = this.requireSigner();
    const cancelSig = await builder.signCancel(cancelNonce);
    const signed = await builder.buildAndSign(newOrder);

    return this.http.post<CancelReplaceResult>(
      ENDPOINTS.orders.cancelReplace,
      {
        cancel: {
          trader: builder.address,
          nonce: cancelNonce,
          signature: cancelSig,
        },
        create: signed,
      },
    );
  }

  async bulkCreate(orders: PlaceOrderRequest[]): Promise<BulkCreateResult> {
    const builder = this.requireSigner();
    const signed = await Promise.all(
      orders.map((req) => builder.buildAndSign(req)),
    );
    return this.http.post<BulkCreateResult>(
      ENDPOINTS.orders.bulkCreate,
      { orders: signed },
    );
  }

  async bulkCancel(nonces: Hex[]): Promise<BulkCancelResult> {
    const builder = this.requireSigner();
    const cancels = await Promise.all(
      nonces.map(async (nonce) => {
        const signature = await builder.signCancel(nonce);
        return { trader: builder.address, nonce, signature };
      }),
    );
    return this.http.post<BulkCancelResult>(
      ENDPOINTS.orders.bulkCancel,
      { cancels },
    );
  }

  async bulk(
    creates: PlaceOrderRequest[],
    cancelNonces: Hex[],
  ): Promise<BulkResult> {
    const builder = this.requireSigner();

    const createOps = await Promise.all(
      creates.map(async (req) => ({
        type: "create" as const,
        order: await builder.buildAndSign(req),
      })),
    );

    const cancelOps = await Promise.all(
      cancelNonces.map(async (nonce) => ({
        type: "cancel" as const,
        cancel: {
          trader: builder.address,
          nonce,
          signature: await builder.signCancel(nonce),
        },
      })),
    );

    return this.http.post<BulkResult>(ENDPOINTS.orders.bulk, {
      operations: [...createOps, ...cancelOps],
    });
  }
}
