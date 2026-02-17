import type { Address, Hex } from "viem";

// ─── Market Types ───

export interface Market {
  id: string;
  question: string;
  shortQuestion: string;
  oracle: string;
  outcomeTokens: string[];
  outcomePrices: OutcomePrice[];
  creator: string;
  creatorProfile: { username: string | null; avatarUrl: string | null } | null;
  volume: string;
  volume24h: string;
  participantCount: number;
  resolutionStatus: "none" | "pending" | "resolved";
  status: "active" | "pending" | "resolved" | "closed";
  createdAt: string;
  deadline: string;
  resolutionCriteria: string;
  resolvedAt: string | null;
  payoutPcts: number[] | null;
  metadata: MarketMetadata;
  outcome: number | null;
  contractAddress: string | null;
  [key: string]: unknown;
}

export interface OutcomePrice {
  outcomeIndex: number;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  midPrice: number | null;
  lastPrice: number | null;
  currentPrice: number | null;
}

export interface MarketMetadata {
  slug: string | null;
  criteria: string;
  startTime: number;
  endTime: number;
  shortSummary: string | null;
  mediaHash: string | null;
  sourceAccounts: {
    platform: string;
    userId: string;
    username: string;
    displayName: string | null;
    profileImageUrl: string | null;
  }[];
  categories: string[] | null;
  [key: string]: unknown;
}

export interface MarketList {
  markets: Market[];
  cursor: string | null;
}

// ─── Quote Types ───

export interface QuoteSide {
  bid: number | null;
  ask: number | null;
  last: number | null;
}

export interface Quotes {
  marketId: string;
  yes: QuoteSide;
  no: QuoteSide;
  spread: number | null;
  timestamp: string;
  [key: string]: unknown;
}

// ─── Orderbook Types ───

export interface Orderbook {
  marketId: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: string;
  [key: string]: unknown;
}

export interface OrderbookLevel {
  price: number;
  size: number;
  [key: string]: unknown;
}

export interface FullOrderbook {
  marketId: string;
  yes: { bids: OrderbookLevel[]; asks: OrderbookLevel[] };
  no: { bids: OrderbookLevel[]; asks: OrderbookLevel[] };
  timestamp: string;
}

// ─── Order Types ───

export interface Order {
  nonce: Hex;
  marketId: string;
  trader: Address;
  outcomeIndex: number;
  side: 0 | 1;
  price: string;
  size: string;
  type: "limit" | "market";
  status: "open" | "filled" | "cancelled" | "expired" | "voided";
  insertedAt: string;
  filledSize: string;
  remainingSize: string;
  percentFilled: number;
  voidedAt: string | null;
  voidReason:
    | "UNFILLED_MARKET_ORDER"
    | "UNDER_COLLATERALIZED"
    | "MISSING_OPERATOR_APPROVAL"
    | null;
  [key: string]: unknown;
}

/** Enriched market info returned alongside orders. Keyed by marketId. */
export type OrderMarkets = Record<
  string,
  { shortQuestion: string; slug: string }
>;

export interface OrderList {
  orders: Order[];
  markets?: OrderMarkets;
  cursor: string | null;
}

export interface CreateOrderResult {
  success: boolean;
  order: Order;
}

export interface Fill {
  order: Order;
  previousFilledSize: number;
  currentFilledSize: number;
  fillSize: number;
  type: "partial" | "full";
}

export interface PlaceOrderRequest {
  marketId: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  priceCents: number;
  size: number;
  expirySeconds?: number;
}

export interface PlaceMarketOrderRequest {
  marketId: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  maxPriceCents: number;
  maxSize: number;
  expirySeconds?: number;
}

export interface CancelResult {
  success: boolean;
  alreadyCancelled?: boolean;
  [key: string]: unknown;
}

export interface CancelReplaceResult {
  cancel: CancelResult & { trader: string; nonce: string };
  create: CreateOrderResult;
}

// ─── Simulate Types ───

export interface SimulateTradeParams {
  side: "yes" | "no";
  amount: number;
  amountType?: "usd" | "contracts";
  trader?: string;
}

export interface SimulateResult {
  marketId: string;
  side: string;
  amount: number;
  amountType: string;
  estimatedContracts: number;
  estimatedAvgPrice: number;
  estimatedSlippage: number;
  [key: string]: unknown;
}

export interface OrderSimulateParams {
  marketId: string;
  trader: string;
  maxSize: string;
  maxPrice: string;
  outcomeIndex: number;
  side: "bid" | "ask";
}

export interface OrderSimulateResult {
  levels: OrderSimulateLevel[];
  summary: {
    fillSize: string;
    fillCost: string;
    takerFee: string;
    weightedAvgPrice: string;
    totalLiquidityAvailable: string;
    percentFillable: number;
    slippageBps: number;
  };
  collateral: {
    balance: string;
    outcomeTokenBalance: string;
    requiredForFill: string;
    isSufficient: boolean;
  };
  warnings: string[];
}

export interface OrderSimulateLevel {
  price: string;
  sizeAvailable: string;
  cumulativeSize: string;
  takerFee: string;
  cumulativeTakerFee: string;
  collateralRequired: string;
  cumulativeCollateral: string;
  makerCount: number;
}

// ─── Price History ───

export interface PricePoint {
  time: number;
  price: number;
  [key: string]: unknown;
}

export interface PriceHistory {
  prices: PricePoint[];
  startTime: number;
  endTime: number;
  interval: number;
  [key: string]: unknown;
}

/** @deprecated Use PricePoint instead — API returns {time, price} not OHLCV candles. */
export type Candle = PricePoint;

export type PriceTimeframe = "1h" | "6h" | "1d" | "1w" | "1M" | "all";

/** @deprecated Use PriceTimeframe — API param is "timeframe" with values 1h|6h|1d|1w|1M|all. */
export type PriceInterval = PriceTimeframe;

// ─── Oracle Types ───

export interface OracleResponse {
  oracle: OracleData;
}

export interface OracleData {
  lastCheckedAt: string | null;
  confidenceLevel: string | null;
  evidenceCollected: {
    postsCount: number;
    relevantPosts: string[];
  };
  sourcesMonitored: string[];
  summary: {
    decision: string;
    shortSummary: string;
    expandedSummary: string;
  };
  [key: string]: unknown;
}

export interface OracleQuote {
  id: number;
  status: string;
  probability: number | null;
  confidence: "low" | "medium" | "high" | null;
  reasoning: string | null;
  referenceMarketsCount: number;
  createdAt: string;
  completedAt: string | null;
  [key: string]: unknown;
}

export interface OracleQuotesResponse {
  quotes: OracleQuote[];
}

export interface OracleQuoteRequestResult {
  id: number;
  status: string;
  createdAt: string;
}

// ─── Activity Types ───

export interface ActivityItem {
  type: string;
  timestamp: string;
  marketId?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface ActivityResponse {
  marketId: string | null;
  activity: ActivityItem[];
  pagination?: {
    cursor: string | null;
    hasMore: boolean;
  };
}

// ─── Portfolio / Balance ───

export interface Portfolio {
  portfolio: Position[];
  marketIds: string[];
  cursor: string | null;
}

export interface Position {
  tokenAddress: string;
  balance: string;
  settlementBalance: string;
  walletBalance: string;
  outcomeIndex: number;
  outcomeName: string;
  marketId: string;
  netInvestment: string;
  currentValue: string;
  tokensRedeemed: string;
  [key: string]: unknown;
}

export interface ClaimableResponse {
  positions: ClaimablePosition[];
  markets: ClaimableMarket[];
  totalClaimable: string;
}

export interface ClaimableMarket {
  id: string;
  outcomeTokens: string[];
  outcomeNames: string[];
  payoutPcts: string[];
}

export interface ClaimablePosition {
  tokenAddress: string;
  balance: string;
  settlementBalance: string;
  walletBalance: string;
  outcomeIndex: number;
  outcomeName: string | null;
  marketId: string;
  netInvestment: string;
  claimableAmount: string;
  [key: string]: unknown;
}

export interface PortfolioStats {
  currentPortfolioValue: string;
  currentPortfolioPercentChange: number;
}

export interface Balance {
  address: Address;
  usdc: UsdcBalance;
  outcomeTokens: OutcomeTokenBalance[];
  [key: string]: unknown;
}

export interface UsdcBalance {
  tokenAddress: string;
  balance: string;
  settlementBalance: string;
  walletBalance: string;
}

export interface OutcomeTokenBalance {
  tokenAddress: string;
  marketId: string;
  outcomeIndex: number;
  outcomeName: string;
  balance: string;
  settlementBalance: string;
  walletBalance: string;
  [key: string]: unknown;
}

export interface TokenBalance {
  balance: string;
  decimals: number;
  symbol: string;
}

// ─── Wallet Types ───

export interface WalletStatus {
  address: Address;
  ethBalance: bigint;
  usdcAllowance: bigint;
  isOperatorApproved: boolean;
  needsApprovals: boolean;
}

export interface WalletSetupResult {
  usdcApprovalTx: Hex | null;
  operatorApprovalTx: Hex | null;
}

// ─── Search Params ───

export interface SearchMarketsParams {
  query?: string;
  status?: "active" | "pending" | "resolved" | "closed";
  sortBy?: "new" | "volume" | "trending" | "ending" | "chance";
  sort?: "asc" | "desc";
  limit?: number;
  cursor?: string;
  visibility?: "visible" | "hidden" | "all";
  resolutionStatus?: string;
  creator?: string;
  category?: string;
  createdAfter?: string;
}

export type OrderStatus = "open" | "filled" | "cancelled" | "expired" | "voided";

export interface GetOrdersParams {
  trader?: Address;
  marketId?: string;
  status?: OrderStatus;
  cursor?: string;
  limit?: number;
}

export interface GetRecentOrdersParams {
  trader?: Address;
  marketId?: string;
  status?: OrderStatus;
  limit?: number;
  windowSeconds?: number;
}

export interface GetOrderbookParams {
  depth?: number;
  outcomeIndex?: number;
}

export interface GetPriceHistoryParams {
  timeframe?: PriceTimeframe;
  /** @deprecated Use timeframe instead. */
  interval?: PriceTimeframe;
}

export interface GetActivityParams {
  cursor?: string;
  limit?: number;
  types?: string;
  startTime?: string;
  endTime?: string;
}

export interface GetPortfolioParams {
  kind?: "all" | "active" | "won" | "lost" | "claimable";
  marketId?: string;
  cursor?: string;
  pageSize?: number;
}

// ─── Gasless Types ───

export interface GaslessOperatorRequest {
  user: Address;
  approved?: boolean;
  nonce: string;
  deadline: string;
  signature: Hex;
}

export interface GaslessOperatorResult {
  success: true;
  txHash: Hex;
  user: Address;
  operator: Address;
  relayer: Address;
}

export interface GaslessDepositRequest {
  user: Address;
  amount: string;
  nonce: string;
  deadline: string;
  signature: Hex;
}

export interface GaslessDepositResult {
  success: true;
  txHash: Hex;
  user: Address;
  token: Address;
  amount: string;
  relayer: Address;
}

// ─── Bulk Mixed Operations ───

export interface BulkOperation {
  type: "create" | "cancel";
  order?: Record<string, unknown>;
  cancel?: { trader: string; nonce: string; signature: string };
}

export interface BulkResult {
  results: Array<
    | { type: "create"; success: boolean; order: Order }
    | {
        type: "cancel";
        success: boolean;
        trader: string;
        nonce: string;
        alreadyCancelled: boolean;
      }
  >;
}

// ─── Client Options ───

export interface ContextClientOptions {
  apiKey?: string;
  baseUrl?: string;
  rpcUrl?: string;
  signer?: SignerInput;
}

export type SignerInput =
  | { privateKey: Hex }
  | { account: import("viem").Account }
  | { walletClient: import("viem").WalletClient };
