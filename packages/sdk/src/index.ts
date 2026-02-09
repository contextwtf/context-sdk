// Core classes
export { ContextClient } from "./client.js";
export { ContextTrader } from "./trader.js";

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
} from "./encoding.js";

// Constants
export {
  API_BASE,
  SETTLEMENT_ADDRESS,
  HOLDINGS_ADDRESS,
  USDC_ADDRESS,
  CHAIN_ID,
  EIP712_DOMAIN,
  ORDER_TYPES,
  CANCEL_TYPES,
} from "./constants.js";

// Types
export type {
  // Market
  Market,
  Outcome,
  MarketList,
  // Data
  Quote,
  Orderbook,
  OrderbookLevel,
  Candle,
  PriceInterval,
  OracleSignal,
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
  ContextTraderOptions,
  SignerInput,
} from "./types.js";
