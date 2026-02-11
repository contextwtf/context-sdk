import type { HttpClient } from "../http.js";
import { ENDPOINTS } from "../endpoints.js";
import type {
  Market,
  MarketList,
  Quotes,
  Orderbook,
  SimulateTradeParams,
  SimulateResult,
  Candle,
  OracleResponse,
  ActivityItem,
  SearchMarketsParams,
  GetPriceHistoryParams,
} from "../types.js";

export class Markets {
  constructor(private readonly http: HttpClient) {}

  async list(params?: SearchMarketsParams): Promise<MarketList> {
    return this.http.get<MarketList>(ENDPOINTS.markets.list, {
      search: params?.query,
      status: params?.status,
      limit: params?.limit,
    });
  }

  async get(id: string): Promise<Market> {
    return this.http.get<Market>(ENDPOINTS.markets.get(id));
  }

  async quotes(marketId: string): Promise<Quotes> {
    return this.http.get<Quotes>(ENDPOINTS.markets.quotes(marketId));
  }

  async orderbook(marketId: string): Promise<Orderbook> {
    return this.http.get<Orderbook>(ENDPOINTS.markets.orderbook(marketId));
  }

  async simulate(
    marketId: string,
    params: SimulateTradeParams,
  ): Promise<SimulateResult> {
    return this.http.post<SimulateResult>(
      ENDPOINTS.markets.simulate(marketId),
      {
        side: params.side,
        amount: params.amount,
        amountType: params.amountType ?? "usd",
      },
    );
  }

  async priceHistory(
    marketId: string,
    params?: GetPriceHistoryParams,
  ): Promise<Candle[]> {
    return this.http.get<Candle[]>(ENDPOINTS.markets.prices(marketId), {
      interval: params?.interval,
    });
  }

  async oracle(marketId: string): Promise<OracleResponse> {
    return this.http.get<OracleResponse>(ENDPOINTS.markets.oracle(marketId));
  }

  async activity(marketId: string): Promise<ActivityItem[]> {
    return this.http.get<ActivityItem[]>(
      ENDPOINTS.markets.activity(marketId),
    );
  }

  async globalActivity(): Promise<ActivityItem[]> {
    return this.http.get<ActivityItem[]>(ENDPOINTS.activity.global);
  }
}
