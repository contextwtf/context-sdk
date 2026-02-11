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
  PriceInterval,
  OracleResponse,
  OracleData,
  ActivityItem,
  // Orders
  Order,
  Fill,
  PlaceOrderRequest,
  CancelResult,
  CancelReplaceResult,
  // Simulate
  SimulateTradeParams,
  SimulateResult,
  // Portfolio
  Portfolio,
  Position,
  Balance,
  // Wallet
  WalletStatus,
  WalletSetupResult,
  // Params
  SearchMarketsParams,
  GetOrdersParams,
  GetPriceHistoryParams,
  // Config
  ContextClientOptions,
  SignerInput,
} from "./types.js";
