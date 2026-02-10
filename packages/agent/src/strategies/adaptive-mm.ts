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
  /** Minimum FV confidence to quote. Markets below this are skipped. Default: 0.3. */
  minConfidence?: number;
  /** Pluggable fair value source. Overrides fairValueCents when provided. */
  fairValueProvider?: FairValueProvider;
}

interface QuoteState {
  fairValue: number;
  skew: number;
  bidPrices: number[];
  askPrices: number[];
}

/**
 * Adaptive Market Maker Strategy (dual-side quoting)
 *
 * Quotes multi-level bid/ask ladders on both YES and NO outcomes.
 * YES ladder is centered on yesFV, NO ladder on (100 - yesFV).
 * Both sides adjust to order flow via the fair value provider.
 *
 * Inventory skew adjusts quotes based on net YES position:
 * - Long YES → YES skew DOWN + NO skew UP (offload YES, accumulate NO)
 * - Short YES → YES skew UP + NO skew DOWN (accumulate YES, offload NO)
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
  private readonly minConfidence: number;
  private readonly fairValueProvider?: FairValueProvider;

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
    this.minConfidence = options.minConfidence ?? 0.3;
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

    // 1. Determine YES fair value
    //    Priority: snapshot.fairValue (from service) > provider > static fallback
    let yesFV = this.fairValueCents;
    let fvConfidence = 1;
    let fvSource = "static";

    if (snapshot.fairValue) {
      yesFV = clamp(Math.round(snapshot.fairValue.yesCents), 1, 99);
      fvConfidence = snapshot.fairValue.confidence;
      fvSource = "service";
    } else if (this.fairValueProvider) {
      const estimate = await this.fairValueProvider.estimate(snapshot);
      yesFV = clamp(Math.round(estimate.yesCents), 1, 99);
      fvConfidence = estimate.confidence;
      fvSource = this.fairValueProvider.name;
    }

    if (fvSource !== "static") {
      console.log(
        `[adaptive-mm] FV from ${fvSource}: ${yesFV}¢ (confidence: ${fvConfidence.toFixed(2)})`,
      );
    }

    // 1b. Skip markets where FV confidence is below threshold
    if (fvConfidence < this.minConfidence && fvSource !== "static") {
      console.log(
        `[adaptive-mm] SKIP ${market.id.slice(0, 8)}...: confidence ${fvConfidence.toFixed(2)} < ${this.minConfidence}`,
      );
      return [{ type: "no_action", reason: `Low confidence: ${fvConfidence.toFixed(2)} < ${this.minConfidence}` }];
    }

    // 2. Calculate inventory skew from net YES position
    // YES position increases when we buy YES or when someone sells us YES.
    // We also factor in NO position: holding NO is equivalent to being short YES.
    const yesPosition = state.portfolio.positions.find(
      (p) => p.marketId === market.id && p.outcome === "yes",
    );
    const noPosition = state.portfolio.positions.find(
      (p) => p.marketId === market.id && p.outcome === "no",
    );

    const yesSize = yesPosition ? yesPosition.size : 0;
    const noSize = noPosition ? noPosition.size : 0;
    // Net YES exposure: long YES minus long NO (holding NO offsets YES risk)
    const netYes = yesSize - noSize;

    const skew = clamp(
      netYes * this.skewPerContract,
      -this.maxSkewCents,
      this.maxSkewCents,
    );

    // 3. Generate YES + NO quote ladders
    const yesLadder = this.generateLadder(yesFV, skew);
    const noFV = 100 - yesFV;
    const noLadder = this.generateLadder(noFV, -skew);

    console.log(
      `[adaptive-mm] ${market.id.slice(0, 8)}... yesFV=${yesFV}¢ noFV=${noFV}¢ yesPos=${yesSize} noPos=${noSize} net=${netYes} skew=${skew.toFixed(1)}¢`,
    );
    console.log(
      `  YES bids=[${yesLadder.bidPrices}] asks=[${yesLadder.askPrices}]  NO bids=[${noLadder.bidPrices}] asks=[${noLadder.askPrices}]`,
    );

    // 4. Diff against existing quotes
    const existing = this.lastQuotes.get(market.id);

    const newState: QuoteState = {
      fairValue: yesFV,
      skew,
      bidPrices: yesLadder.bidPrices,
      askPrices: yesLadder.askPrices,
    };

    if (existing) {
      const changed = this.quoteChanged(existing, newState);

      // Check if we actually have orders on the book — if orders were
      // blocked by risk manager or consumed by traders, we need to requote
      // even when FV hasn't changed.
      const myOrdersForMarket = state.openOrders.filter(
        (o) => o.marketId === market.id,
      );
      const expectedOrders = this.levels * 4; // levels * (bid+ask) * (YES+NO)
      const bookThin = myOrdersForMarket.length < expectedOrders * 0.5;

      if (!changed && !bookThin) {
        return [
          {
            type: "no_action",
            reason: `Quotes still fresh for ${market.id.slice(0, 8)}`,
          },
        ];
      }

      if (bookThin && !changed) {
        console.log(
          `[adaptive-mm] Replenishing ${market.id.slice(0, 8)}... (${myOrdersForMarket.length}/${expectedOrders} orders on book)`,
        );
      }

      // Cancel all our open orders for this market
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

  private quoteChanged(prev: QuoteState, next: QuoteState): boolean {
    const fvDelta = Math.abs(prev.fairValue - next.fairValue);
    const skewDelta = Math.abs(prev.skew - next.skew);
    return (
      fvDelta >= this.requoteDeltaCents ||
      skewDelta >= this.requoteDeltaCents
    );
  }

  private buildLadder(
    marketId: string,
    outcome: "yes" | "no",
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
    // Forward to fair value provider so it can react to flow
    if (this.fairValueProvider?.onFill) {
      this.fairValueProvider.onFill(fill);
    }
  }

  async onShutdown(): Promise<void> {
    this.lastQuotes.clear();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
