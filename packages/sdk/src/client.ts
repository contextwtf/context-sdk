import type { Address } from "viem";
import { HttpTransport } from "./http.js";
import type {
  ContextClientOptions,
  Market,
  MarketList,
  Quote,
  Orderbook,
  SimulateTradeParams,
  SimulateResult,
  Candle,
  OracleSignal,
  ActivityItem,
  Order,
  Portfolio,
  Balance,
  SearchMarketsParams,
  GetOrdersParams,
  GetPriceHistoryParams,
} from "./types.js";

/**
 * Read-only client for Context Markets.
 * No authentication required for most endpoints.
 */
export class ContextClient {
  protected readonly http: HttpTransport;

  constructor(options: ContextClientOptions = {}) {
    this.http = new HttpTransport({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });
  }

  // ─── Markets ───

  async searchMarkets(params?: SearchMarketsParams): Promise<MarketList> {
    return this.http.get<MarketList>("/markets", {
      search: params?.query,
      status: params?.status,
      limit: params?.limit,
    });
  }

  async getMarket(id: string): Promise<Market> {
    return this.http.get<Market>(`/markets/${id}`);
  }

  // ─── Market Data ───

  async getQuotes(marketId: string): Promise<Quote[]> {
    return this.http.get<Quote[]>(`/markets/${marketId}/quotes`);
  }

  async getOrderbook(marketId: string): Promise<Orderbook> {
    return this.http.get<Orderbook>(`/markets/${marketId}/orderbook`);
  }

  async simulateTrade(
    marketId: string,
    params: SimulateTradeParams,
  ): Promise<SimulateResult> {
    return this.http.post<SimulateResult>(
      `/markets/${marketId}/simulate`,
      {
        side: params.side,
        amount: params.amount,
        amountType: params.amountType ?? "usd",
      },
    );
  }

  async getPriceHistory(
    marketId: string,
    params?: GetPriceHistoryParams,
  ): Promise<Candle[]> {
    return this.http.get<Candle[]>(`/markets/${marketId}/prices`, {
      interval: params?.interval,
    });
  }

  async getOracleSignals(marketId: string): Promise<OracleSignal[]> {
    return this.http.get<OracleSignal[]>(`/markets/${marketId}/oracle`);
  }

  // ─── Activity ───

  async getMarketActivity(marketId: string): Promise<ActivityItem[]> {
    return this.http.get<ActivityItem[]>(
      `/markets/${marketId}/activity`,
    );
  }

  async getGlobalActivity(): Promise<ActivityItem[]> {
    return this.http.get<ActivityItem[]>("/activity");
  }

  // ─── Orders (read) ───

  async getOrders(params?: GetOrdersParams): Promise<Order[]> {
    return this.http.get<Order[]>("/orders", {
      trader: params?.trader,
      marketId: params?.marketId,
    });
  }

  // ─── Portfolio / Balance ───

  async getPortfolio(address: Address): Promise<Portfolio> {
    return this.http.get<Portfolio>(`/portfolio/${address}`);
  }

  async getBalance(address: Address): Promise<Balance> {
    return this.http.get<Balance>(`/balance/${address}`);
  }
}
