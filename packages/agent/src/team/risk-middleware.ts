/**
 * risk-middleware.ts — Pure risk checks run before every order.
 *
 * No LLM, no side effects. Takes a proposed order + current state + limits
 * and returns allow/deny with optional suggested adjustments.
 *
 * Extracted from examples/team/agents/risk-sentinel.ts exposure calc + circuit breakers.
 */

import type { Quote, RiskDecision, RiskLimits, MarketState } from "./types-v2.js";

// ─── State interface (subset of OrderBookState for risk checks) ───

export interface RiskState {
  markets: Map<string, MarketState>;
  balance: number;           // current USDC balance
  totalExposure: number;     // sum of worst-case losses across all markets
  sessionPnL: number;        // session profit/loss in dollars
}

// ─── Core ───

/**
 * Check a proposed quote against risk limits.
 * Returns { allow: true } or { allow: false, reason, suggested? }.
 *
 * Checks run in order — first failure returns immediately.
 */
export function riskCheck(
  quote: Quote,
  marketId: string,
  state: RiskState,
  limits: RiskLimits,
): RiskDecision {
  const market = state.markets.get(marketId);

  // 1. Price sanity — must be 1-99
  if (quote.priceCents < 1 || quote.priceCents > 99) {
    return { allow: false, reason: "price_out_of_range" };
  }

  // 2. Minimum size
  if (quote.size < 1) {
    return { allow: false, reason: "size_too_small" };
  }

  // 3. Position limit — would this order exceed per-market max?
  if (market) {
    const currentNet = Math.abs(market.position.yes - market.position.no);
    const wouldAdd = quote.size;
    if (currentNet + wouldAdd > limits.maxPositionPerMarket) {
      const allowedSize = Math.max(0, limits.maxPositionPerMarket - currentNet);
      if (allowedSize <= 0) {
        return { allow: false, reason: "position_limit_exceeded" };
      }
      return {
        allow: false,
        reason: "position_limit_would_exceed",
        suggested: { size: allowedSize },
      };
    }
  }

  // 4. Exposure limit — total exposure as fraction of balance
  if (state.balance > 0) {
    const additionalExposure = worstCaseLoss(quote);
    const newExposure = state.totalExposure + additionalExposure;
    const newExposureFraction = newExposure / state.balance;
    if (newExposureFraction > limits.maxTotalExposure) {
      const headroom = (limits.maxTotalExposure * state.balance) - state.totalExposure;
      if (headroom <= 0) {
        return { allow: false, reason: "exposure_limit_exceeded" };
      }
      const maxAffordableSize = Math.floor(headroom / (quote.priceCents / 100));
      if (maxAffordableSize < limits.minSize) {
        return { allow: false, reason: "exposure_limit_exceeded" };
      }
      return {
        allow: false,
        reason: "exposure_limit_would_exceed",
        suggested: { size: Math.min(quote.size, maxAffordableSize) },
      };
    }
  }

  // 5. Capital utilization — similar to exposure but measures total capital deployed
  if (state.balance > 0) {
    const cost = (quote.priceCents / 100) * quote.size;
    const currentUtil = capitalUtilization(state);
    const newUtil = currentUtil + (cost / state.balance);
    if (newUtil > limits.maxCapitalUtilization) {
      const headroom = (limits.maxCapitalUtilization - currentUtil) * state.balance;
      if (headroom <= 0) {
        return { allow: false, reason: "capital_utilization_exceeded" };
      }
      const maxAffordableSize = Math.floor(headroom / (quote.priceCents / 100));
      if (maxAffordableSize < limits.minSize) {
        return { allow: false, reason: "capital_utilization_exceeded" };
      }
      return {
        allow: false,
        reason: "capital_utilization_would_exceed",
        suggested: { size: Math.min(quote.size, maxAffordableSize) },
      };
    }
  }

  // 6. Daily loss limit
  if (state.sessionPnL < -limits.maxDailyLoss) {
    return { allow: false, reason: "daily_loss_limit_exceeded" };
  }

  return { allow: true };
}

/**
 * Validate a pair of quotes (bid + ask) for spread sanity.
 */
export function validateSpread(
  bid: Quote,
  ask: Quote,
  limits: RiskLimits,
): RiskDecision {
  if (bid.priceCents >= ask.priceCents) {
    return { allow: false, reason: "crossed_quotes" };
  }

  const spread = ask.priceCents - bid.priceCents;
  if (spread < limits.minSpread) {
    return {
      allow: false,
      reason: "spread_too_tight",
      suggested: {
        priceCents: bid.priceCents - Math.ceil((limits.minSpread - spread) / 2),
      },
    };
  }

  return { allow: true };
}

/**
 * Check all quotes for a market in one call.
 * Returns decisions for each quote + spread validation.
 */
export function riskCheckAll(
  quotes: Quote[],
  marketId: string,
  state: RiskState,
  limits: RiskLimits,
): { decisions: RiskDecision[]; spreadOk: RiskDecision } {
  const decisions = quotes.map((q) => riskCheck(q, marketId, state, limits));

  const bids = quotes.filter((q) => q.side === "buy");
  const asks = quotes.filter((q) => q.side === "sell");

  let spreadOk: RiskDecision = { allow: true };
  if (bids.length > 0 && asks.length > 0) {
    spreadOk = validateSpread(bids[0], asks[0], limits);
  }

  return { decisions, spreadOk };
}

// ─── Helpers ───

/** Worst-case loss for a quote (buy: lose the cost, sell: lose (100-price) * size). */
function worstCaseLoss(quote: Quote): number {
  if (quote.side === "buy") {
    return (quote.priceCents / 100) * quote.size;
  }
  // Selling: worst case is market goes to 100, we lose (100 - price) per contract
  return ((100 - quote.priceCents) / 100) * quote.size;
}

/** Current capital utilization: total cost basis across all positions / balance. */
function capitalUtilization(state: RiskState): number {
  if (state.balance <= 0) return 1;

  let totalCost = 0;
  for (const market of state.markets.values()) {
    totalCost += market.position.costBasis;
  }
  return totalCost / state.balance;
}
