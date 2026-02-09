import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
} from "../strategy.js";
import type { Fill } from "@context-markets/sdk";
import type { FairValueProvider } from "../fair-value.js";

export interface AdaptiveMmOptions {
  /** Markets to make markets on. */
  markets: MarketSelector;
  /** Predetermined YES fair value in cents (e.g., 50). NO is derived as 100 - YES. */
  fairValueCents: number;
  /** Number of bid/ask levels per outcome (e.g., 3). */
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
  /** Pluggable fair value source. Overrides fairValueCents when provided. */
  fairValueProvider?: FairValueProvider;
}

type Outcome = "yes" | "no";

interface OutcomeQuoteState {
  fairValue: number;
  skew: number;
  bidPrices: number[];
  askPrices: number[];
}

interface MarketQuoteState {
  yes: OutcomeQuoteState;
  no: OutcomeQuoteState;
}

/**
 * Adaptive Market Maker Strategy
 *
 * Quotes multi-level bid/ask ladders on BOTH YES and NO outcomes,
 * tracks inventory per outcome, and skews quotes to manage position risk.
 *
 * Per outcome:
 * - Positive inventory (long) → skew DOWN (lower asks to offload, lower bids to slow buying)
 * - Negative inventory (short) → skew UP (raise bids to accumulate, raise asks to slow selling)
 *
 * YES fair value and NO fair value are complementary: NO_FV = 100 - YES_FV
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
  private readonly fairValueProvider?: FairValueProvider;

  private lastQuotes = new Map<string, MarketQuoteState>();

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
    this.fairValueProvider = options.fairValueProvider;
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
      const marketActions = await this.evaluateMarket(snapshot, state);
      actions.push(...marketActions);
    }

    return actions;
  }

  private async evaluateMarket(
    snapshot: MarketSnapshot,
    state: AgentState,
  ): Promise<Action[]> {
    const { market } = snapshot;

    // 1. Determine YES fair value (NO = 100 - YES)
    let yesFV = this.fairValueCents;
    let fvConfidence = 1;

    if (this.fairValueProvider) {
      const estimate = await this.fairValueProvider.estimate(snapshot);
      yesFV = clamp(Math.round(estimate.yesCents), 1, 99);
      fvConfidence = estimate.confidence;
      console.log(
        `[adaptive-mm] FV from ${this.fairValueProvider.name}: ${yesFV}¢ (confidence: ${fvConfidence.toFixed(2)})`,
      );
    }

    const noFV = 100 - yesFV;

    // 2. Calculate inventory skew per outcome
    const yesPosition = state.portfolio.positions.find(
      (p) => p.marketId === market.id && p.outcome === "yes",
    );
    const noPosition = state.portfolio.positions.find(
      (p) => p.marketId === market.id && p.outcome === "no",
    );

    const yesSize = yesPosition ? yesPosition.size : 0;
    const noSize = noPosition ? noPosition.size : 0;

    const yesSkew = clamp(
      yesSize * this.skewPerContract,
      -this.maxSkewCents,
      this.maxSkewCents,
    );
    const noSkew = clamp(
      noSize * this.skewPerContract,
      -this.maxSkewCents,
      this.maxSkewCents,
    );

    // 3. Generate quote ladders for both outcomes
    const yesLadder = this.generateLadder(yesFV, yesSkew);
    const noLadder = this.generateLadder(noFV, noSkew);

    console.log(
      `[adaptive-mm] ${market.id.slice(0, 8)}... YES: FV=${yesFV}¢ pos=${yesSize} skew=${yesSkew.toFixed(1)}¢ bids=[${yesLadder.bidPrices}] asks=[${yesLadder.askPrices}]`,
    );
    console.log(
      `[adaptive-mm] ${market.id.slice(0, 8)}...  NO: FV=${noFV}¢ pos=${noSize} skew=${noSkew.toFixed(1)}¢ bids=[${noLadder.bidPrices}] asks=[${noLadder.askPrices}]`,
    );

    // 4. Diff against existing orders
    const existing = this.lastQuotes.get(market.id);

    const newState: MarketQuoteState = {
      yes: { fairValue: yesFV, skew: yesSkew, ...yesLadder },
      no: { fairValue: noFV, skew: noSkew, ...noLadder },
    };

    if (existing) {
      const yesChanged = this.outcomeChanged(existing.yes, newState.yes);
      const noChanged = this.outcomeChanged(existing.no, newState.no);

      if (!yesChanged && !noChanged) {
        return [
          {
            type: "no_action",
            reason: `Quotes still fresh for ${market.id.slice(0, 8)}`,
          },
        ];
      }

      // Cancel all our open orders for this market using state from API
      const actions: Action[] = [];
      const marketOrders = state.openOrders.filter(
        (o) => o.marketId === market.id,
      );
      for (const order of marketOrders) {
        actions.push({ type: "cancel_order", nonce: order.nonce });
      }

      if (marketOrders.length > 0) {
        console.log(
          `[adaptive-mm] Cancelling ${marketOrders.length} existing orders for ${market.id.slice(0, 8)}...`,
        );
      }

      actions.push(
        ...this.buildLadder(market.id, "yes", yesLadder.bidPrices, yesLadder.askPrices),
        ...this.buildLadder(market.id, "no", noLadder.bidPrices, noLadder.askPrices),
      );

      this.lastQuotes.set(market.id, newState);
      return actions;
    }

    // Fresh placement — cancel any stale orders from previous runs
    const actions: Action[] = [];
    const staleOrders = state.openOrders.filter(
      (o) => o.marketId === market.id,
    );
    for (const order of staleOrders) {
      actions.push({ type: "cancel_order", nonce: order.nonce });
    }

    if (staleOrders.length > 0) {
      console.log(
        `[adaptive-mm] Cleaning ${staleOrders.length} stale orders for ${market.id.slice(0, 8)}...`,
      );
    }

    actions.push(
      ...this.buildLadder(market.id, "yes", yesLadder.bidPrices, yesLadder.askPrices),
      ...this.buildLadder(market.id, "no", noLadder.bidPrices, noLadder.askPrices),
    );

    this.lastQuotes.set(market.id, newState);
    return actions;
  }

  private generateLadder(
    fairValue: number,
    skew: number,
  ): { bidPrices: number[]; askPrices: number[] } {
    const bidPrices: number[] = [];
    const askPrices: number[] = [];

    for (let i = 0; i < this.levels; i++) {
      const bidPrice = clamp(
        Math.round(
          fairValue -
            this.baseSpreadCents -
            i * this.levelSpacingCents -
            skew,
        ),
        1,
        99,
      );
      const askPrice = clamp(
        Math.round(
          fairValue +
            this.baseSpreadCents +
            i * this.levelSpacingCents -
            skew,
        ),
        1,
        99,
      );
      bidPrices.push(bidPrice);
      askPrices.push(askPrice);
    }

    return { bidPrices, askPrices };
  }

  private outcomeChanged(
    prev: OutcomeQuoteState,
    next: OutcomeQuoteState,
  ): boolean {
    const fvDelta = Math.abs(prev.fairValue - next.fairValue);
    const skewDelta = Math.abs(prev.skew - next.skew);
    return (
      fvDelta >= this.requoteDeltaCents ||
      skewDelta >= this.requoteDeltaCents
    );
  }

  private buildLadder(
    marketId: string,
    outcome: Outcome,
    bidPrices: number[],
    askPrices: number[],
  ): Action[] {
    const actions: Action[] = [];

    for (const price of bidPrices) {
      actions.push({
        type: "place_order",
        marketId,
        outcome,
        side: "buy",
        priceCents: price,
        size: this.levelSize,
      });
    }

    for (const price of askPrices) {
      actions.push({
        type: "place_order",
        marketId,
        outcome,
        side: "sell",
        priceCents: price,
        size: this.levelSize,
      });
    }

    return actions;
  }

  onFill(fill: Fill): void {
    if (fill.order.marketId) {
      // Clear tracking so we re-quote on next cycle with updated inventory
      this.lastQuotes.delete(fill.order.marketId);
    }
  }

  async onShutdown(): Promise<void> {
    this.lastQuotes.clear();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
