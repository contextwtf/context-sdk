/**
 * Cost Controller
 *
 * Controls LLM invocation frequency, model selection, and budget tracking.
 * Prevents unnecessary API calls when nothing interesting has changed.
 */

import type { MarketSnapshot, AgentState } from "../strategy.js";

// ─── Types ───

export interface CostControlOptions {
  /** Only call LLM every N cycles. Default: 1 (every cycle). */
  evaluateEveryNCycles?: number;

  /** Cheap model for routine evaluation. Default: "claude-haiku-4-5-20251001". */
  routineModel?: string;
  /** Model for significant events (fills, big moves). Default: "claude-sonnet-4-5-20250929". */
  significantModel?: string;
  /** Condition that triggers the significant model. */
  significantCondition?: (ctx: CostContext) => boolean;

  /** Max tool calls per LLM invocation. Default: 5. */
  maxToolCallsPerCycle?: number;
  /** Daily cost budget in cents. Default: unlimited (0). */
  dailyBudgetCents?: number;

  /** Skip evaluation when no prices moved. Default: true. */
  skipWhenUnchanged?: boolean;
  /** Minimum price move (cents) to consider "changed". Default: 3. */
  unchangedThresholdCents?: number;
}

export interface CostContext {
  markets: MarketSnapshot[];
  state: AgentState;
  cycleNumber: number;
  /** Whether a fill was detected since last evaluation. */
  hadFill: boolean;
}

// ─── Cost Controller ───

export class CostController {
  private readonly opts: Required<
    Pick<
      CostControlOptions,
      | "evaluateEveryNCycles"
      | "routineModel"
      | "significantModel"
      | "maxToolCallsPerCycle"
      | "dailyBudgetCents"
      | "skipWhenUnchanged"
      | "unchangedThresholdCents"
    >
  > & {
    significantCondition?: (ctx: CostContext) => boolean;
  };

  private lastEvalCycle = -1;
  private lastPrices = new Map<string, number>();
  private dailySpendCents = 0;
  private dailyResetDate = "";

  constructor(options: CostControlOptions = {}) {
    this.opts = {
      evaluateEveryNCycles: options.evaluateEveryNCycles ?? 1,
      routineModel: options.routineModel ?? "claude-haiku-4-5-20251001",
      significantModel: options.significantModel ?? "claude-sonnet-4-5-20250929",
      significantCondition: options.significantCondition,
      maxToolCallsPerCycle: options.maxToolCallsPerCycle ?? 5,
      dailyBudgetCents: options.dailyBudgetCents ?? 0,
      skipWhenUnchanged: options.skipWhenUnchanged ?? true,
      unchangedThresholdCents: options.unchangedThresholdCents ?? 3,
    };
  }

  get maxToolCalls(): number {
    return this.opts.maxToolCallsPerCycle;
  }

  /** Should we call the LLM this cycle? */
  shouldEvaluate(ctx: CostContext): boolean {
    // Always evaluate if there was a fill
    if (ctx.hadFill) return true;

    // Frequency gate
    if (ctx.cycleNumber - this.lastEvalCycle < this.opts.evaluateEveryNCycles) {
      return false;
    }

    // Daily budget gate
    if (this.opts.dailyBudgetCents > 0) {
      this.resetDailyIfNeeded();
      if (this.dailySpendCents >= this.opts.dailyBudgetCents) {
        return false;
      }
    }

    // Unchanged gate
    if (this.opts.skipWhenUnchanged && this.lastPrices.size > 0) {
      const anyMoved = ctx.markets.some((snap) => {
        const mid = this.getMidPrice(snap);
        const prev = this.lastPrices.get(snap.market.id);
        if (prev === undefined) return true; // new market = changed
        return Math.abs(mid - prev) >= this.opts.unchangedThresholdCents;
      });
      if (!anyMoved) return false;
    }

    return true;
  }

  /** Select the appropriate model for this cycle. */
  selectModel(ctx: CostContext): string {
    if (this.opts.significantCondition && this.opts.significantCondition(ctx)) {
      return this.opts.significantModel;
    }
    return this.opts.routineModel;
  }

  /** Record that an evaluation happened. */
  recordEvaluation(
    cycleNumber: number,
    markets: MarketSnapshot[],
    usage: { inputTokens: number; outputTokens: number },
  ): void {
    this.lastEvalCycle = cycleNumber;

    // Update price cache
    this.lastPrices.clear();
    for (const snap of markets) {
      this.lastPrices.set(snap.market.id, this.getMidPrice(snap));
    }

    // Estimate cost (rough: Haiku ~$0.25/M in, ~$1.25/M out)
    const costCents =
      (usage.inputTokens * 0.025) / 1000 +
      (usage.outputTokens * 0.125) / 1000;
    this.dailySpendCents += costCents;
  }

  private getMidPrice(snap: MarketSnapshot): number {
    const bestBid = snap.orderbook.bids[0]?.price ?? 0;
    const bestAsk = snap.orderbook.asks[0]?.price ?? 100;
    return (bestBid + bestAsk) / 2;
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyResetDate) {
      this.dailyResetDate = today;
      this.dailySpendCents = 0;
    }
  }
}
