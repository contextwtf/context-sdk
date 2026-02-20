import type { HttpClient } from "../http.js";
import { ENDPOINTS } from "../endpoints.js";
import type {
  Market,
  MarketList,
  Quotes,
  Orderbook,
  FullOrderbook,
  SimulateTradeParams,
  SimulateResult,
  PriceHistory,
  OracleResponse,
  OracleQuotesResponse,
  OracleQuoteRequestResult,
  ActivityResponse,
  SearchMarketsParams,
  GetOrderbookParams,
  GetPriceHistoryParams,
  GetActivityParams,
  CreateMarketResult,
} from "../types.js";

export class Markets {
  constructor(private readonly http: HttpClient) {}

  async list(params?: SearchMarketsParams): Promise<MarketList> {
    return this.http.get<MarketList>(ENDPOINTS.markets.list, {
      search: params?.query,
      status: params?.status,
      sortBy: params?.sortBy,
      sort: params?.sort,
      limit: params?.limit,
      cursor: params?.cursor,
      visibility: params?.visibility,
      resolutionStatus: params?.resolutionStatus,
      creator: params?.creator,
      category: params?.category,
      createdAfter: params?.createdAfter,
    });
  }

  async get(id: string): Promise<Market> {
    const res = await this.http.get<{ market: Market }>(
      ENDPOINTS.markets.get(id),
    );
    return res.market;
  }

  async quotes(marketId: string): Promise<Quotes> {
    return this.http.get<Quotes>(ENDPOINTS.markets.quotes(marketId));
  }

  async orderbook(
    marketId: string,
    params?: GetOrderbookParams,
  ): Promise<Orderbook> {
    return this.http.get<Orderbook>(ENDPOINTS.markets.orderbook(marketId), {
      depth: params?.depth,
      outcomeIndex: params?.outcomeIndex,
    });
  }

  async fullOrderbook(
    marketId: string,
    params?: Omit<GetOrderbookParams, "outcomeIndex">,
  ): Promise<FullOrderbook> {
    const [no, yes] = await Promise.all([
      this.orderbook(marketId, { ...params, outcomeIndex: 0 }),
      this.orderbook(marketId, { ...params, outcomeIndex: 1 }),
    ]);
    return {
      marketId: yes.marketId,
      yes: { bids: yes.bids, asks: yes.asks },
      no: { bids: no.bids, asks: no.asks },
      timestamp: yes.timestamp,
    };
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
        ...(params.trader ? { trader: params.trader } : {}),
      },
    );
  }

  async priceHistory(
    marketId: string,
    params?: GetPriceHistoryParams,
  ): Promise<PriceHistory> {
    return this.http.get<PriceHistory>(ENDPOINTS.markets.prices(marketId), {
      timeframe: params?.timeframe ?? params?.interval,
    });
  }

  async oracle(marketId: string): Promise<OracleResponse> {
    return this.http.get<OracleResponse>(ENDPOINTS.markets.oracle(marketId));
  }

  async oracleQuotes(marketId: string): Promise<OracleQuotesResponse> {
    return this.http.get<OracleQuotesResponse>(
      ENDPOINTS.markets.oracleQuotes(marketId),
    );
  }

  async requestOracleQuote(
    marketId: string,
  ): Promise<OracleQuoteRequestResult> {
    return this.http.post<OracleQuoteRequestResult>(
      ENDPOINTS.markets.oracleQuotes(marketId),
      {},
    );
  }

  async activity(
    marketId: string,
    params?: GetActivityParams,
  ): Promise<ActivityResponse> {
    return this.http.get<ActivityResponse>(
      ENDPOINTS.markets.activity(marketId),
      {
        cursor: params?.cursor,
        limit: params?.limit,
        types: params?.types,
        startTime: params?.startTime,
        endTime: params?.endTime,
      },
    );
  }

  async create(questionId: string): Promise<CreateMarketResult> {
    return this.http.post<CreateMarketResult>(ENDPOINTS.markets.create, {
      questionId,
    });
  }

  async globalActivity(params?: GetActivityParams): Promise<ActivityResponse> {
    return this.http.get<ActivityResponse>(ENDPOINTS.activity.global, {
      cursor: params?.cursor,
      limit: params?.limit,
      types: params?.types,
      startTime: params?.startTime,
      endTime: params?.endTime,
    });
  }
}
