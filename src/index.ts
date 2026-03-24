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

// Chain config
export type { ChainConfig, ChainOption } from "./config.js";
export {
  MAINNET_CONFIG,
  TESTNET_CONFIG,
  resolveChainConfig,
  settlementDomain,
  holdingsDomain,
  permit2Domain,
} from "./config.js";

// Legacy chain config (deprecated — use ChainConfig presets)
export {
  API_BASE,
  SETTLEMENT_ADDRESS,
  HOLDINGS_ADDRESS,
  USDC_ADDRESS,
  PERMIT2_ADDRESS,
  CHAIN_ID,
  EIP712_DOMAIN,
  HOLDINGS_EIP712_DOMAIN,
  PERMIT2_EIP712_DOMAIN,
} from "./config.js";

// Types
export type {
  // Market
  Market,
  OutcomePrice,
  MarketMetadata,
  MarketList,
  MarketSearchParams,
  MarketSearchResult,
  // Data
  QuoteSide,
  Quotes,
  Orderbook,
  FullOrderbook,
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
  OracleQuoteLatest,
  ActivityItem,
  ActivityResponse,
  // Questions & Market Creation
  SubmitQuestionRequest,
  SubmitQuestionResult,
  QuestionSubmissionStatus,
  GeneratedQuestion,
  QuestionSubmissionStatusUpdate,
  QuestionSubmission,
  CreateMarketResult,
  SubmitAndWaitOptions,
  AgentSubmitMarketDraft,
  AgentSubmitComparison,
  Bucket,
  // Orders
  Order,
  OrderMarkets,
  OrderList,
  CreateOrderResult,
  BulkCreateResult,
  BulkCancelResult,
  Fill,
  PlaceOrderRequest,
  PlaceMarketOrderRequest,
  InventoryMode,
  MakerRoleConstraint,
  CancelResult,
  CancelReplaceResult,
  OrderSimulateParams,
  OrderSimulateResult,
  OrderSimulateLevel,
  // Simulate
  SimulateTradeParams,
  SimulateResult,
  SimulateWarning,
  SimulateSelfTrade,
  // Portfolio
  Portfolio,
  Position,
  PositionList,
  PortfolioPosition,
  ClaimableResponse,
  ClaimableMarket,
  ClaimablePosition,
  PortfolioStats,
  Balance,
  UsdcBalance,
  OutcomeTokenBalance,
  TokenBalance,
  SettlementBalance,
  // Account
  AccountStatus,
  SetupResult,
  DepositResult,
  MintResult,
  // Wallet (deprecated aliases)
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
  GetPositionsParams,
  // Config
  ContextClientOptions,
  SignerInput,
} from "./types.js";

// Generated OpenAPI spec types (for power users / openapi-fetch integration)
export type {
  paths as ApiPaths,
  operations as ApiOperations,
  components as ApiComponents,
} from "./generated/api-types.js";

// Generated endpoint registry
export { ENDPOINTS } from "./generated/endpoints.js";
