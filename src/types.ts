import type { Address, Hex } from "viem";

// ─── Market Types ───

export interface Market {
  id: string;
  question: string;
  shortQuestion?: string;
  oracle?: string;
  outcomeTokens?: string[];
  outcomePrices?: OutcomePrice[];
  creator?: string;
  volume?: string;
  volume24h?: string;
  participantCount?: number;
  resolutionStatus?: string;
  resolvedAt?: string | null;
  metadata?: MarketMetadata;
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
  slug?: string;
  criteria?: string;
  startTime?: number;
  endTime?: number;
  shortSummary?: string;
  [key: string]: unknown;
}

export interface MarketList {
  markets: Market[];
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
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  [key: string]: unknown;
}

export interface OrderbookLevel {
  price: number;
  size: number;
  [key: string]: unknown;
}

// ─── Order Types ───

export interface Order {
  nonce: Hex;
  marketId: string;
  trader: Address;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  price: number;
  size: number;
  status?: string;
  createdAt?: string;
  filledSize?: number;
  remainingSize?: number;
  percentFilled?: number;
  [key: string]: unknown;
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

export interface CancelResult {
  nonce: Hex;
  success: boolean;
  [key: string]: unknown;
}

export interface CancelReplaceResult {
  cancel: CancelResult;
  create: Order;
}

// ─── Simulate Types ───

export interface SimulateTradeParams {
  side: "yes" | "no";
  amount: number;
  amountType?: "usd" | "contracts";
}

export interface SimulateResult {
  avgPrice: number;
  totalCost: number;
  contracts: number;
  priceImpact: number;
  [key: string]: unknown;
}

// ─── Price History ───

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  [key: string]: unknown;
}

export type PriceInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

// ─── Oracle Types ───

export interface OracleResponse {
  oracle: OracleData;
}

export interface OracleData {
  lastCheckedAt: string | null;
  confidenceLevel: number | null;
  evidenceCollected?: {
    postsCount: number;
    relevantPosts: unknown[];
  };
  sourcesMonitored?: string[];
  summary?: {
    decision: string;
    shortSummary: string;
    expandedSummary?: string;
  };
  [key: string]: unknown;
}

// ─── Activity Types ───

export interface ActivityItem {
  type: string;
  marketId?: string;
  trader?: Address;
  timestamp: string;
  [key: string]: unknown;
}

// ─── Portfolio / Balance ───

export interface Portfolio {
  address: Address;
  positions: Position[];
  [key: string]: unknown;
}

export interface Position {
  marketId: string;
  outcome: string;
  size: number;
  avgPrice: number;
  [key: string]: unknown;
}

export interface Balance {
  address: Address;
  usdc: number;
  [key: string]: unknown;
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
  status?: "active" | "resolved";
  limit?: number;
}

export interface GetOrdersParams {
  trader?: Address;
  marketId?: string;
  cursor?: string;
  limit?: number;
}

export interface GetPriceHistoryParams {
  interval?: PriceInterval;
}

// ─── Client Options ───

export interface ContextClientOptions {
  apiKey?: string;
  baseUrl?: string;
  signer?: SignerInput;
}

export type SignerInput =
  | { privateKey: Hex }
  | { account: import("viem").Account }
  | { walletClient: import("viem").WalletClient };
