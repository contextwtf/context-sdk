import type { Position } from "@context-markets/sdk";
import type { Action, AgentState } from "./strategy.js";

export interface RiskLimits {
  /** Max position size in contracts per market. */
  maxPositionSize?: number;
  /** Max total portfolio value in USD. */
  maxPortfolioValue?: number;
  /** Max loss before halting (negative number, e.g. -100). */
  maxLoss?: number;
  /** Max open orders across all markets. */
  maxOpenOrders?: number;
  /** Max size per individual order. */
  maxOrderSize?: number;
  /** Max orders placed per market per cycle. */
  maxOrdersPerMarketPerCycle?: number;
}

export interface RiskCheckResult {
  allowed: Action[];
  blocked: { action: Action; reason: string }[];
}

export class RiskManager {
  private readonly limits: RiskLimits;

  constructor(limits: RiskLimits = {}) {
    this.limits = limits;
  }

  check(actions: Action[], state: AgentState): RiskCheckResult {
    const allowed: Action[] = [];
    const blocked: { action: Action; reason: string }[] = [];

    // Track orders-per-market this cycle
    const ordersPerMarket = new Map<string, number>();

    // Count cancels in this batch to deduct from open order count.
    // This prevents the startup problem where 559 stale cancels + 180
    // new placements all get evaluated against the pre-cancel count.
    let pendingCancels = 0;

    for (const action of actions) {
      if (action.type === "no_action") {
        allowed.push(action);
        continue;
      }

      if (action.type === "cancel_order") {
        // Cancels are always allowed
        allowed.push(action);
        pendingCancels++;
        continue;
      }

      const reason = this.checkAction(
        action,
        state,
        ordersPerMarket,
        pendingCancels,
      );
      if (reason) {
        blocked.push({ action, reason });
      } else {
        allowed.push(action);

        // Track for rate limiting within this cycle
        const marketId =
          action.type === "place_order" || action.type === "cancel_replace"
            ? action.marketId
            : undefined;
        if (marketId) {
          ordersPerMarket.set(
            marketId,
            (ordersPerMarket.get(marketId) ?? 0) + 1,
          );
        }
      }
    }

    return { allowed, blocked };
  }

  private checkAction(
    action: Action & { type: "place_order" | "cancel_replace" },
    state: AgentState,
    ordersPerMarket: Map<string, number>,
    pendingCancels: number = 0,
  ): string | null {
    const size =
      action.type === "place_order" || action.type === "cancel_replace"
        ? action.size
        : 0;

    // Max order size
    if (this.limits.maxOrderSize && size > this.limits.maxOrderSize) {
      return `Order size ${size} exceeds max ${this.limits.maxOrderSize}`;
    }

    // Max open orders (deduct pending cancels from the same batch)
    if (this.limits.maxOpenOrders) {
      const effectiveOpen = state.openOrders.length - pendingCancels;
      if (effectiveOpen >= this.limits.maxOpenOrders) {
        return `Open orders (${effectiveOpen}) at max (${this.limits.maxOpenOrders})`;
      }
    }

    // Max position size per outcome (only for buy orders — sells reduce position)
    if (this.limits.maxPositionSize && action.side === "buy") {
      const marketId = action.marketId;
      const outcome = action.outcome;
      const existingPosition = state.portfolio.positions.find(
        (p: Position) => p.marketId === marketId && p.outcome === outcome,
      );
      const currentSize = existingPosition?.size ?? 0;
      if (currentSize + size > this.limits.maxPositionSize) {
        return `Position would be ${currentSize + size}, max is ${this.limits.maxPositionSize}`;
      }
    }

    // Max portfolio value
    if (this.limits.maxPortfolioValue) {
      const totalValue = state.portfolio.positions.reduce(
        (sum: number, p: Position) => sum + p.size * p.avgPrice,
        0,
      );
      const orderValue = size * (action.priceCents / 100);
      if (totalValue + orderValue > this.limits.maxPortfolioValue) {
        return `Portfolio value would exceed max ${this.limits.maxPortfolioValue}`;
      }
    }

    // Max loss halt
    if (this.limits.maxLoss !== undefined) {
      // Simple P&L check: if balance is below initial + maxLoss, halt
      // In production this would track realized + unrealized P&L
      const currentBalance = state.balance.usdc;
      if (currentBalance <= Math.abs(this.limits.maxLoss)) {
        return `Balance ${currentBalance} at or below loss limit ${this.limits.maxLoss}`;
      }
    }

    // Rate limit per market per cycle
    if (this.limits.maxOrdersPerMarketPerCycle) {
      const marketId = action.marketId;
      const count = ordersPerMarket.get(marketId) ?? 0;
      if (count >= this.limits.maxOrdersPerMarketPerCycle) {
        return `Already placed ${count} orders for market ${marketId} this cycle`;
      }
    }

    return null;
  }
}
