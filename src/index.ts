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
export type {
  ChainConfig,
  ChainOption,
  SettlementVersion,
  TimeInForce,
} from "./config.js";
export {
  MAINNET_CONFIG,
  TESTNET_CONFIG,
  resolveChainConfig,
  getSettlementAddress,
  getHoldingsAddress,
  settlementDomain,
  settlementV2Domain,
  holdingsDomain,
  permit2Domain,
  TIME_IN_FORCE_GTC,
  TIME_IN_FORCE_IOC,
  TIME_IN_FORCE_FOK,
  ORDER_KIND_BUY,
  ORDER_KIND_SELL_INVENTORY,
  ORDER_KIND_SELL_NO_INVENTORY,
} from "./config.js";

// Legacy chain config (deprecated — use ChainConfig presets)
export {
  API_BASE,
  SETTLEMENT_ADDRESS,
  HOLDINGS_ADDRESS,
  LEGACY_SETTLEMENT_ADDRESS,
  SETTLEMENT_V2_ADDRESS,
  LEGACY_HOLDINGS_ADDRESS,
  NEW_HOLDINGS_ADDRESS,
  USDC_ADDRESS,
  PERMIT2_ADDRESS,
  CHAIN_ID,
  EIP712_DOMAIN,
  EIP712_DOMAIN_V2,
  HOLDINGS_EIP712_DOMAIN,
  PERMIT2_EIP712_DOMAIN,
} from "./config.js";

// Modules
export { MigrationModule } from "./modules/migration.js";

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
  MigrationBalance,
  MigrationFundsPlan,
  MigrationFundsPlanChunk,
  MigrationFundsPlanToken,
  PendingMigrationRestorationDraft,
  PendingMigrationRestoration,
  SponsoredFundsMigrationStatus,
  MigrationStatus,
  StartMigrationResult,
  DismissMigrationOrdersRequest,
  DismissMigrationOrdersResult,
  SignedMigrationAction,
  SponsoredMigrateFundsRequest,
  SponsoredMigrateFundsExecution,
  SponsoredMigrateFundsResult,
  RestoreMigrationOrderRequest,
  RestoreMigrationOrdersResult,
} from "./types.js";

// Generated OpenAPI spec types (for power users / openapi-fetch integration)
export type {
  paths as ApiPaths,
  operations as ApiOperations,
  components as ApiComponents,
} from "./generated/api-types.js";

// Generated endpoint registry
export { ENDPOINTS } from "./generated/endpoints.js";
