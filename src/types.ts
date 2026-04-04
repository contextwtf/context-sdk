import type { Address, Hex } from "viem";
import type { components } from "./generated/api-types.js";
import type {
  SettlementVersion,
  TimeInForce,
} from "./config.js";

// ─── Re-exported API Types (generated from OpenAPI spec) ───
// Run `bun run generate` to update from the spec.

export type Market = components["schemas"]["Market"];
export type OutcomePrice = components["schemas"]["OutcomePrice"];
export type MarketMetadata = components["schemas"]["MarketMetadata"];
export type MarketList = components["schemas"]["MarketList"];

export type Orderbook = components["schemas"]["Orderbook"];
/** Single price level in the orderbook. */
export type OrderbookLevel = Orderbook["bids"][number];

type GeneratedOrder = components["schemas"]["Order"];

export type Order = GeneratedOrder;
export type OrderMarkets = Record<string, components["schemas"]["OrderMarketInfo"]>;
export type OrderList = components["schemas"]["OrderList"];
export type CreateOrderResult = components["schemas"]["OrderCreated"];
export type CancelResult = components["schemas"]["OrderCancelResult"];
export type CancelReplaceResult = components["schemas"]["OrderCancelReplaceResult"];
export type BulkResult = components["schemas"]["BulkOrderResult"];
export type MintResult = components["schemas"]["MintResult"];

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

export type ActivityItem = components["schemas"]["ActivityItem"];
export type ActivityResponse = components["schemas"]["ActivityResponse"];

export type Portfolio = components["schemas"]["PortfolioSummary"];
export type Position = components["schemas"]["Position"];
export type PositionList = components["schemas"]["PositionList"];
export type PortfolioPosition = components["schemas"]["PortfolioPosition"];
export type ClaimableResponse = components["schemas"]["ClaimablePositions"];
export type ClaimableMarket = components["schemas"]["ClaimableMarket"];
export type ClaimablePosition = components["schemas"]["ClaimablePosition"];
export type PortfolioStats = components["schemas"]["PortfolioStats"];

export type Balance = components["schemas"]["BalanceSummary"];
/** USDC balance breakdown (wallet + settlement). */
export type UsdcBalance = Balance["usdc"];
export type OutcomeTokenBalance = components["schemas"]["OutcomeTokenBalance"];
export type TokenBalance = components["schemas"]["TokenBalance"];
export type SettlementBalance = components["schemas"]["SettlementBalance"];

export type GaslessOperatorResult = components["schemas"]["GaslessOperatorResult"];

export type SubmitQuestionResult = components["schemas"]["QuestionPostResponse"];
export type QuestionSubmission = components["schemas"]["SubmissionResponse"];
export type CreateMarketResult = components["schemas"]["MarketCreated"];
export type Bucket = components["schemas"]["Bucket"];

// ─── Agent Submit Types (from OpenAPI spec) ───

/** Request body for questions.agentSubmit() — POST /questions/agent-submit */
export interface AgentSubmitMarketDraft {
  market: {
    formattedQuestion: string;
    shortQuestion: string;
    marketType: "SUBJECTIVE" | "OBJECTIVE";
    evidenceMode: "social_only" | "web_enabled";
    resolutionCriteria: string;
    /** End time as "YYYY-MM-DD HH:MM:SS" interpreted in the given timezone */
    endTime: string;
    /** IANA timezone identifier. @default "America/New_York" */
    timezone?: string;
    /** @default [] */
    sources?: string[];
    buckets?: Bucket[];
    comparisons?: AgentSubmitComparison[];
    /** Max 120 characters */
    explanation?: string;
  };
}

export type AgentSubmitComparison =
  | {
      type: "binary";
      key: string;
      label: string;
      aKey: string;
      bKey: string;
      /** @default ">" */
      operator?: ">" | ">=" | "==" | "<=" | "<";
      aWeight?: number;
      bWeight?: number;
      margin?: number;
    }
  | {
      type: "max" | "min";
      key: string;
      label: string;
      bucketKeys: string[];
    }
  | {
      type: "before";
      key: string;
      label: string;
      aKey: string;
      bKey: string;
      /** @default "firstEvent" */
      event?: "firstEvent" | "targetReached";
      /** @default true */
      requireBoth?: boolean;
    }
  | {
      type: "first";
      key: string;
      label: string;
      bucketKeys: string[];
      /** @default "firstEvent" */
      event?: "firstEvent" | "targetReached";
    };

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
  buyValue?: number;
  expirySeconds?: number;
  expiry?: string | bigint;
  nonce?: Hex;
  maxFee?: string | bigint;
  /** Optional explicit version override. Only SettlementV2 signing is supported. */
  settlementVersion?: SettlementVersion;
  timeInForce?: TimeInForce;
  clientOrderType?: "limit" | "market";
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
  /**
   * High-level market-order amount.
   * For SettlementV1 and SettlementV2 sells, this is max shares.
   * For SettlementV2 buys, this is treated as the pre-fee collateral budget.
   * The signed onchain cap is `buyValue + maxFee`.
   */
  maxSize: number;
  /**
   * Optional explicit pre-fee collateral budget override for SettlementV2 buy
   * market orders. The signed onchain cap is `buyValue + maxFee`.
   */
  buyValue?: number;
  expirySeconds?: number;
  expiry?: string | bigint;
  nonce?: Hex;
  maxFee?: string | bigint;
  /** Optional explicit version override. Only SettlementV2 signing is supported. */
  settlementVersion?: SettlementVersion;
  timeInForce?: TimeInForce;
  clientOrderType?: "limit" | "market";
  inventoryModeConstraint?: InventoryMode;
  makerRoleConstraint?: MakerRoleConstraint;
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

export interface GetPositionsParams {
  marketId?: string;
  status?: "open" | "closed";
  search?: string;
  cursor?: string;
  limit?: number;
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

export type BulkCreateResult = components["schemas"]["BulkOrderCreateResult"];

export type BulkCancelResult = components["schemas"]["BulkOrderCancelResult"];

// ─── Account Types (client-side only, not API responses) ───

export interface AccountStatus {
  address: Address;
  ethBalance: bigint;
  usdcBalance: bigint;
  usdcAllowance: bigint;
  isOperatorApproved: boolean;
  needsUsdcApproval: boolean;
  needsOperatorApproval: boolean;
  isReady: boolean;
}

export interface SetupResult {
  usdcApproval: { needed: boolean; txHash: Hex | null };
  operatorApproval: { needed: boolean; txHash: Hex | null };
}

export interface DepositResult {
  txHash: Hex;
  amount: string;
  gasless: boolean;
}

/** @deprecated Use AccountStatus */
export type WalletStatus = AccountStatus;
/** @deprecated Use SetupResult */
export type WalletSetupResult = SetupResult;

export interface GaslessOperatorRequest {
  user: Address;
  settlementVersion?: SettlementVersion;
  approved?: boolean;
  nonce: string;
  deadline: string;
  signature: Hex;
}

// ─── Client Options ───

export interface ContextClientOptions {
  /** Which chain to use. @default "mainnet" */
  chain?: "mainnet" | "testnet";
  /** Override the chain preset's default settlement/holdings generation. */
  settlementVersion?: SettlementVersion;
  apiKey?: string;
  /** Override the API base URL (ignores chain preset). */
  baseUrl?: string;
  rpcUrl?: string;
  signer?: SignerInput;
}

export type SignerInput =
  | { privateKey: Hex }
  | { account: import("viem").Account }
  | { walletClient: import("viem").WalletClient };

export interface MigrationBalance {
  token: Address;
  balance: string;
}

export interface MigrationFundsPlanToken {
  token: Address;
  amount: string;
}

export interface MigrationFundsPlanChunk {
  callCount: number;
  calls: unknown[];
  tokens: MigrationFundsPlanToken[];
}

export interface MigrationFundsPlan {
  phase: string;
  callCount: number;
  chunkCount: number;
  calls: unknown[];
  tokens: MigrationFundsPlanToken[];
  chunks: MigrationFundsPlanChunk[];
}

export interface PendingMigrationRestorationDraft {
  type: "limit" | "market";
  marketId: string;
  trader?: Address;
  side: 0 | 1;
  price: string;
  size?: string;
  remainingSize: string;
  outcomeIndex: number;
  nonce?: Hex;
  expiry: string;
  maxFee: string;
  timeInForce?: TimeInForce;
  clientOrderType?: "limit" | "market";
  makerRoleConstraint: MakerRoleConstraint;
  inventoryModeConstraint: InventoryMode;
  reason: string;
}

export interface PendingMigrationRestoration {
  id: number;
  legacyOrderId: number;
  legacyOrderHash: Hex;
  legacyMarketId: Hex;
  status: string;
  draft: PendingMigrationRestorationDraft;
  error: string | null;
  market: {
    shortQuestion: string;
    outcomeNames: string[];
  } | null;
}

export interface SponsoredFundsMigrationStatus {
  status: string;
  userOperationHash: Hex | null;
  txHash: Hex | null;
  error: string | null;
}

export interface MigrationStatus {
  migrationActive: boolean;
  walletAddress: Address;
  holdings: {
    legacy: Address;
    new: Address | null;
  };
  settlementV2Address: Address;
  legacyBalances: MigrationBalance[];
  newBalances: MigrationBalance[];
  v2OperatorApproved: boolean;
  newHoldingsOperatorNonce: string | null;
  fundsMigrationPlan: MigrationFundsPlan;
  pendingRestorations: PendingMigrationRestoration[];
  voidedLegacyOrderCount: number;
  legacyOpenOrderCount: number;
  sponsoredFundsMigrationAvailable: boolean;
  sponsoredRelayerAddress: Address | null;
  sponsoredFundsMigrationStatus: SponsoredFundsMigrationStatus | null;
  canStart: boolean;
  canMigrateFunds: boolean;
  canRestoreOrders: boolean;
  canDismissOrders: boolean;
  migrationComplete: boolean;
}

export interface StartMigrationResult {
  success: true;
  retiredCount: number;
  restorableCount: number;
  legacyBalances: MigrationBalance[];
  newBalances: MigrationBalance[];
  fundsMigrationPlan: MigrationFundsPlan;
  pendingRestorations: Array<{
    id: number;
    legacyOrderId: number;
    legacyMarketId: Hex;
    status: string;
    draft: PendingMigrationRestorationDraft;
  }>;
  legacyOpenOrderCount: number;
}

export interface PublicAddressAuthorization {
  deadline: string;
  signature: Hex;
}

export interface MigrationAddressRequest {
  address?: Address;
}

export interface StartMigrationRequest extends MigrationAddressRequest {
  authorization?: PublicAddressAuthorization;
}

export interface DismissMigrationOrdersRequest extends MigrationAddressRequest {
  authorization?: PublicAddressAuthorization;
  legacyOrderIds?: number[];
}

export type MigrationAuthorizationAction = "start" | "dismiss-orders";

export interface SignMigrationAddressAuthorizationRequest {
  action: MigrationAuthorizationAction;
  address?: Address;
  legacyOrderIds?: number[];
  deadline?: string | bigint;
}

export interface DismissMigrationOrdersResult {
  success: true;
  dismissedCount: number;
}

export interface SignedMigrationAction {
  nonce: string;
  deadline: string;
  signature: Hex;
}

export type SponsoredMigrateFundsRequest =
  | {
      address?: Address;
      batchWithdraw: SignedMigrationAction;
      setOperator: SignedMigrationAction;
    }
  | {
      address?: Address;
      chunks: Array<{
        batchWithdraw: SignedMigrationAction;
      }>;
      setOperator: SignedMigrationAction;
    };

export interface SponsoredMigrateFundsExecution {
  userOperationHash: Hex;
  txHash: Hex;
}

export interface SponsoredMigrateFundsResult {
  success: true;
  userOperationHash: Hex;
  txHash: Hex;
  executions: SponsoredMigrateFundsExecution[];
  legacyBalances: MigrationBalance[];
  newBalances: MigrationBalance[];
  v2OperatorApproved: boolean;
}

export interface RestoreMigrationOrderRequest {
  legacyOrderId: number;
  order: Record<string, unknown>;
}

export interface RestoreMigrationOrdersResult {
  success: boolean;
  restoredCount: number;
  failedCount: number;
  results: Array<
    | {
        legacyOrderId: number;
        success: true;
        restoredOrderId: number;
        restoredOrderHash: Hex;
      }
    | {
        legacyOrderId: number;
        success: false;
        error: string;
      }
  >;
  settlementV2Address: Address;
}

export interface RestoreMigrationOrdersRequest {
  address?: Address;
  restorations: RestoreMigrationOrderRequest[];
}
