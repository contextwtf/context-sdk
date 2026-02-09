import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
} from "../strategy.js";
import type { Order } from "@context-markets/sdk";

export interface AdaptiveMmOptions {
  /** Markets to make markets on. */
  markets: MarketSelector;
  /** Predetermined anchor price in cents (e.g., 50). */
  fairValueCents: number;
  /** Number of bid/ask levels to quote (e.g., 3). */
  levels: number;
  /** Cents between each level (e.g., 2). */
  levelSpacingCents: number;
  /** Contracts per level (e.g., 10). */
  levelSize: number;
  /** Half-spread from fair value to first level in cents (e.g., 2). */
  baseSpreadCents: number;
  /** Cents to skew per contract of inventory (e.g., 0.1). */
  skewPerContract: number;
  /** Maximum skew in cents (e.g., 5). */
  maxSkewCents: number;
  /** Min mid-move in cents before re-quoting (e.g., 1). */
  requoteDeltaCents: number;
  /** If true, anchor fair value to highest-confidence oracle signal. */
  useOracleAnchor?: boolean;
}

interface QuoteState {
  fairValue: number;
  skew: number;
  bidPrices: number[];
  askPrices: number[];
  nonces: string[];
}

/**
 * Adaptive Market Maker Strategy
 *
 * Quotes a multi-level bid/ask ladder around a fair value,
 * tracks inventory, and skews quotes to manage position risk.
 *
 * - Positive inventory (long) → skew DOWN (lower asks to offload, lower bids to slow buying)
 * - Negative inventory (short) → skew UP (raise bids to accumulate, raise asks to slow selling)
 */
export class AdaptiveMmStrategy implements Strategy {
  readonly name = "Adaptive MM";

  private readonly selector: MarketSelector;
  private readonly fairValueCents: number;
  private readonly levels: number;
  private readonly levelSpacingCents: number;
  private readonly levelSize: number;
  private readonly baseSpreadCents: number;
  private readonly skewPerContract: number;
  private readonly maxSkewCents: number;
  private readonly requoteDeltaCents: number;
  private readonly useOracleAnchor: boolean;

  private lastQuotes = new Map<string, QuoteState>();

  constructor(options: AdaptiveMmOptions) {
    this.selector = options.markets;
    this.fairValueCents = options.fairValueCents;
    this.levels = options.levels;
    this.levelSpacingCents = options.levelSpacingCents;
    this.levelSize = options.levelSize;
    this.baseSpreadCents = options.baseSpreadCents;
    this.skewPerContract = options.skewPerContract;
    this.maxSkewCents = options.maxSkewCents;
    this.requoteDeltaCents = options.requoteDeltaCents;
    this.useOracleAnchor = options.useOracleAnchor ?? false;
  }

  async selectMarkets(): Promise<MarketSelector> {
    return this.selector;
  }

  async evaluate(
    markets: MarketSnapshot[],
    state: AgentState,
  ): Promise<Action[]> {
    const actions: Action[] = [];

    for (const snapshot of markets) {
      const marketActions = this.evaluateMarket(snapshot, state);
      actions.push(...marketActions);
    }

    return actions;
  }

  private evaluateMarket(
    snapshot: MarketSnapshot,
    state: AgentState,
  ): Action[] {
    const { market, oracleSignals } = snapshot;

    // 1. Determine fair value
    let fairValue = this.fairValueCents;

    if (this.useOracleAnchor && oracleSignals.length > 0) {
      const best = oracleSignals.reduce((a, b) =>
        b.confidence > a.confidence ? b : a,
      );
      // Oracle confidence is 0-1, map to cents
      fairValue = Math.round(best.confidence * 100);
      fairValue = clamp(fairValue, 1, 99);
    }

    // 2. Calculate inventory skew
    const position = state.portfolio.positions.find(
      (p) => p.marketId === market.id,
    );
    const positionSize = position ? position.size : 0;
    const inventorySkew = clamp(
      positionSize * this.skewPerContract,
      -this.maxSkewCents,
      this.maxSkewCents,
    );

    // 3. Generate quote ladder
    const bidPrices: number[] = [];
    const askPrices: number[] = [];

    for (let i = 0; i < this.levels; i++) {
      const bidPrice = clamp(
        Math.round(
          fairValue -
            this.baseSpreadCents -
            i * this.levelSpacingCents -
            inventorySkew,
        ),
        1,
        99,
      );
      const askPrice = clamp(
        Math.round(
          fairValue +
            this.baseSpreadCents +
            i * this.levelSpacingCents -
            inventorySkew,
        ),
        1,
        99,
      );
      bidPrices.push(bidPrice);
      askPrices.push(askPrice);
    }

    console.log(
      `[adaptive-mm] ${market.id.slice(0, 8)}... FV=${fairValue}¢ pos=${positionSize} skew=${inventorySkew.toFixed(1)}¢ bids=[${bidPrices}] asks=[${askPrices}]`,
    );

    // 4. Diff against existing orders
    const existing = this.lastQuotes.get(market.id);

    if (existing) {
      const fvDelta = Math.abs(existing.fairValue - fairValue);
      const skewDelta = Math.abs(existing.skew - inventorySkew);

      if (
        fvDelta < this.requoteDeltaCents &&
        skewDelta < this.requoteDeltaCents
      ) {
        return [
          {
            type: "no_action",
            reason: `Quotes still fresh (fvDelta=${fvDelta.toFixed(1)}¢, skewDelta=${skewDelta.toFixed(1)}¢)`,
          },
        ];
      }

      // Cancel all existing orders then place new ladder
      const actions: Action[] = [];

      for (const nonce of existing.nonces) {
        actions.push({ type: "cancel_order", nonce });
      }

      actions.push(...this.buildLadder(market.id, bidPrices, askPrices));

      this.lastQuotes.set(market.id, {
        fairValue,
        skew: inventorySkew,
        bidPrices,
        askPrices,
        nonces: [],
      });

      return actions;
    }

    // Fresh placement
    const actions = this.buildLadder(market.id, bidPrices, askPrices);

    this.lastQuotes.set(market.id, {
      fairValue,
      skew: inventorySkew,
      bidPrices,
      askPrices,
      nonces: [],
    });

    return actions;
  }

  private buildLadder(
    marketId: string,
    bidPrices: number[],
    askPrices: number[],
  ): Action[] {
    const actions: Action[] = [];

    for (const price of bidPrices) {
      actions.push({
        type: "place_order",
        marketId,
        outcome: "yes",
        side: "buy",
        priceCents: price,
        size: this.levelSize,
      });
    }

    for (const price of askPrices) {
      actions.push({
        type: "place_order",
        marketId,
        outcome: "yes",
        side: "sell",
        priceCents: price,
        size: this.levelSize,
      });
    }

    return actions;
  }

  onFill(order: Order): void {
    if (order.marketId) {
      // Clear tracking so we re-quote on next cycle with updated inventory
      this.lastQuotes.delete(order.marketId);
    }
  }

  async onShutdown(): Promise<void> {
    this.lastQuotes.clear();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
