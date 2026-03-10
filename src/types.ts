import type { Address, Hex } from "viem";
import type { components } from "./generated/api-types.js";

// ─── Re-exported API Types (generated from OpenAPI spec) ───
// Run `bun run generate` to update from the spec.

export type Market = components["schemas"]["Market"];
export type OutcomePrice = components["schemas"]["OutcomePrice"];
export type MarketMetadata = components["schemas"]["MarketMetadata"];
export type MarketList = components["schemas"]["MarketList"];

export type Quotes = components["schemas"]["Quotes"];
/** Single side (yes/no) of a quote — { bid, ask, last }. */
export type QuoteSide = Quotes["yes"];

export type Orderbook = components["schemas"]["Orderbook"];
/** Single price level in the orderbook. */
export type OrderbookLevel = Orderbook["bids"][number];

export type Order = components["schemas"]["Order"];
export type OrderMarkets = Record<string, components["schemas"]["OrderMarketInfo"]>;
export type OrderList = components["schemas"]["OrderList"];
export type CreateOrderResult = components["schemas"]["OrderCreated"];
export type CancelResult = components["schemas"]["OrderCancelResult"];
export type CancelReplaceResult = components["schemas"]["OrderCancelReplaceResult"];
export type BulkResult = components["schemas"]["BulkOrderResult"];

export type SimulateResult = components["schemas"]["SimulateResult"];
export type SimulateWarning = components["schemas"]["SimulateWarning"];
export type OrderSimulateResult = components["schemas"]["OrderSimulateResult"];
export type OrderSimulateLevel = components["schemas"]["OrderSimulateLevel"];

export type PriceHistory = components["schemas"]["PriceHistory"];
/** Single { time, price } data point. */
export type PricePoint = PriceHistory["prices"][number];

export type OracleResponse = components["schemas"]["OracleSummaryResponse"];
/** Oracle data with evidence and summary. */
export type OracleData = NonNullable<OracleResponse["oracle"]>;
export type OracleQuote = components["schemas"]["OracleQuote"];
export type OracleQuotesResponse = components["schemas"]["OracleQuoteList"];
export type OracleQuoteRequestResult = components["schemas"]["OracleQuoteCreated"];

export type ActivityItem = components["schemas"]["ActivityItem"];
export type ActivityResponse = components["schemas"]["ActivityResponse"];

export type Portfolio = components["schemas"]["PortfolioSummary"];
export type Position = components["schemas"]["Position"];
export type ClaimableResponse = components["schemas"]["ClaimablePositions"];
export type ClaimableMarket = components["schemas"]["ClaimableMarket"];
export type ClaimablePosition = components["schemas"]["ClaimablePosition"];
export type PortfolioStats = components["schemas"]["PortfolioStats"];

export type Balance = components["schemas"]["BalanceSummary"];
/** USDC balance breakdown (wallet + settlement). */
export type UsdcBalance = Balance["usdc"];
export type OutcomeTokenBalance = components["schemas"]["OutcomeTokenBalance"];
export type TokenBalance = components["schemas"]["TokenBalance"];

export type GaslessOperatorResult = components["schemas"]["GaslessOperatorResult"];
export type GaslessDepositResult = components["schemas"]["GaslessDepositResult"];

export type SubmitQuestionResult = components["schemas"]["QuestionPostResponse"];
export type QuestionSubmission = components["schemas"]["SubmissionResponse"];
export type CreateMarketResult = components["schemas"]["MarketCreated"];

// ─── SDK-Only Types (not from API spec) ───

/** SDK-composed type combining yes + no orderbooks. */
export interface FullOrderbook {
  marketId: string;
  yes: { bids: OrderbookLevel[]; asks: OrderbookLevel[] };
  no: { bids: OrderbookLevel[]; asks: OrderbookLevel[] };
  timestamp: string;
}

/** @deprecated Use PricePoint instead — API returns {time, price} not OHLCV candles. */
export type Candle = PricePoint;

export type PriceTimeframe = "1h" | "6h" | "1d" | "1w" | "1M" | "all";

/** @deprecated Use PriceTimeframe — API param is "timeframe" with values 1h|6h|1d|1w|1M|all. */
export type PriceInterval = PriceTimeframe;

export type QuestionSubmissionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

/** @deprecated Use SubmissionQuestion from generated types. */
export interface GeneratedQuestion {
  id: string;
  text?: string;
  criteria?: string;
  [key: string]: unknown;
}

export interface QuestionSubmissionStatusUpdate {
  tool: string;
  status: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface Fill {
  order: Order;
  previousFilledSize: number;
  currentFilledSize: number;
  fillSize: number;
  type: "partial" | "full";
}

export interface SimulateSelfTrade {
  orderId: number;
  nonce: string;
  side: 0 | 1;
  price: string;
  remainingSize: string;
  [key: string]: unknown;
}

/**
 * Inventory mode constraint for limit orders.
 * - 0 (ANY): Fill can mint new tokens or use existing inventory
 * - 1 (REQUIRE_INVENTORY): Maker must already hold the outcome tokens
 * - 2 (REQUIRE_NO_INVENTORY): Settlement mints complete sets from maker's USDC on fill.
 *   Use this for SELL/ASK orders when you don't hold tokens but have USDC deposited.
 */
export type InventoryMode = 0 | 1 | 2;

/**
 * Maker role constraint for limit orders.
 * - 0 (ANY): No constraint — always use this unless you need taker-only.
 * - 1 (MAKER_ONLY): DANGEROUS — do NOT use. When two maker-only orders cross,
 *   Settlement reverts with InvalidRoleConstraint, poisoning the entire batch
 *   and blocking all trading on the market.
 * - 2 (TAKER_ONLY): Order must fill immediately or gets voided.
 */
export type MakerRoleConstraint = 0 | 1 | 2;

export interface PlaceOrderRequest {
  marketId: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  priceCents: number;
  size: number;
  expirySeconds?: number;
  /** Default: 0 (ANY). Set to 2 for SELL orders without existing token inventory. */
  inventoryModeConstraint?: InventoryMode;
  /** Default: 0 (ANY). Set to 1 for maker-only, 2 for taker-only. */
  makerRoleConstraint?: MakerRoleConstraint;
}

export interface PlaceMarketOrderRequest {
  marketId: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  maxPriceCents: number;
  maxSize: number;
  expirySeconds?: number;
}

export interface SimulateTradeParams {
  side: "yes" | "no";
  amount: number;
  amountType?: "usd" | "contracts";
  trader?: string;
}

export interface OrderSimulateParams {
  marketId: string;
  trader: string;
  maxSize: string;
  maxPrice: string;
  outcomeIndex: number;
  side: "bid" | "ask";
}

export type OrderStatus = "open" | "filled" | "cancelled" | "expired" | "voided";

export interface MarketSearchParams {
  q: string;
  limit?: number;
  offset?: number;
}

export interface MarketSearchResult {
  markets: Market[];
  hasMore: boolean;
}

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

export interface SubmitQuestionRequest {
  question: string;
}

export interface SubmitAndWaitOptions {
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export interface BulkOperation {
  type: "create" | "cancel";
  order?: Record<string, unknown>;
  cancel?: { trader: string; nonce: string; signature: string };
}

// ─── Wallet Types (client-side only, not API responses) ───

export interface WalletStatus {
  address: Address;
  ethBalance: bigint;
  usdcAllowance: bigint;
  isOperatorApproved: boolean;
  needsApprovals: boolean;
  /**
   * Whether the wallet needs gasless setup (operator approval only).
   * Gasless deposits use Permit2 signatures, so no USDC allowance is required.
   * Use this instead of `needsApprovals` when your app uses gasless deposits.
   */
  needsGaslessSetup: boolean;
}

export interface WalletSetupResult {
  usdcApprovalTx: Hex | null;
  operatorApprovalTx: Hex | null;
}

export interface GaslessOperatorRequest {
  user: Address;
  approved?: boolean;
  nonce: string;
  deadline: string;
  signature: Hex;
}

export interface GaslessDepositRequest {
  user: Address;
  amount: string;
  nonce: string;
  deadline: string;
  signature: Hex;
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
