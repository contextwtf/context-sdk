// Client
export { ContextClient } from "./client.js";

// Errors
export {
  ContextApiError,
  ContextSigningError,
  ContextConfigError,
} from "./errors.js";

// Encoding utilities
export {
  encodePriceCents,
  encodeSize,
  calculateMaxFee,
  decodePriceCents,
  decodeSize,
} from "./order-builder/helpers.js";

// Chain config (for power users)
export {
  API_BASE,
  SETTLEMENT_ADDRESS,
  HOLDINGS_ADDRESS,
  USDC_ADDRESS,
  PERMIT2_ADDRESS,
  CHAIN_ID,
} from "./config.js";

// Types
export type {
  // Market
  Market,
  OutcomePrice,
  MarketMetadata,
  MarketList,
  // Data
  QuoteSide,
  Quotes,
  Orderbook,
  OrderbookLevel,
  Candle,
  PricePoint,
  PriceHistory,
  PriceTimeframe,
  PriceInterval,
  OracleResponse,
  OracleData,
  OracleQuote,
  OracleQuotesResponse,
  OracleQuoteRequestResult,
  ActivityItem,
  ActivityResponse,
  // Orders
  Order,
  OrderMarkets,
  OrderList,
  CreateOrderResult,
  Fill,
  PlaceOrderRequest,
  CancelResult,
  CancelReplaceResult,
  OrderSimulateParams,
  OrderSimulateResult,
  OrderSimulateLevel,
  // Simulate
  SimulateTradeParams,
  SimulateResult,
  // Portfolio
  Portfolio,
  Position,
  ClaimableResponse,
  ClaimableMarket,
  ClaimablePosition,
  PortfolioStats,
  Balance,
  UsdcBalance,
  OutcomeTokenBalance,
  TokenBalance,
  // Wallet
  WalletStatus,
  WalletSetupResult,
  // Gasless
  GaslessOperatorRequest,
  GaslessOperatorResult,
  GaslessDepositRequest,
  GaslessDepositResult,
  // Bulk
  BulkOperation,
  BulkResult,
  // Params
  OrderStatus,
  SearchMarketsParams,
  GetOrdersParams,
  GetRecentOrdersParams,
  GetOrderbookParams,
  GetPriceHistoryParams,
  GetActivityParams,
  GetPortfolioParams,
  // Config
  ContextClientOptions,
  SignerInput,
} from "./types.js";
