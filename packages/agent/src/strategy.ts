import type {
  Market,
  Quote,
  Orderbook,
  OracleSignal,
  Order,
  Portfolio,
  Balance,
} from "@context-markets/sdk";

// ─── Market Selection ───

export type MarketSelector =
  | { type: "ids"; ids: string[] }
  | { type: "search"; query: string; status?: "active" | "resolved" };

// ─── Snapshots (what the strategy sees) ───

export interface MarketSnapshot {
  market: Market;
  quotes: Quote[];
  orderbook: Orderbook;
  oracleSignals: OracleSignal[];
}

export interface AgentState {
  portfolio: Portfolio;
  openOrders: Order[];
  balance: Balance;
}

// ─── Actions (what the strategy emits) ───

export type Action =
  | PlaceOrderAction
  | CancelOrderAction
  | CancelReplaceAction
  | NoAction;

export interface PlaceOrderAction {
  type: "place_order";
  marketId: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  priceCents: number;
  size: number;
}

export interface CancelOrderAction {
  type: "cancel_order";
  nonce: string;
}

export interface CancelReplaceAction {
  type: "cancel_replace";
  cancelNonce: string;
  marketId: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  priceCents: number;
  size: number;
}

export interface NoAction {
  type: "no_action";
  reason?: string;
}

// ─── Strategy Interface ───

export interface Strategy {
  /** Human-readable name for logging. */
  name: string;

  /** Return which markets to track. Called on startup + periodically. */
  selectMarkets(): Promise<MarketSelector>;

  /**
   * Pure decision function.
   * Gets market data + agent state, returns actions.
   * No side effects, no API calls — the runtime handles execution.
   */
  evaluate(
    markets: MarketSnapshot[],
    state: AgentState,
  ): Promise<Action[]>;

  /** Called when an order is filled. Optional. */
  onFill?(order: Order, fill: unknown): void;

  /** Called on graceful shutdown. Optional. */
  onShutdown?(): Promise<void>;
}
