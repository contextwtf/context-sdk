/**
 * invariants.ts — System invariant checks run after every Chief cycle.
 *
 * Pure function: takes state, returns pass/fail results.
 * Markets in "resolved", "closing", or human-halted status are skipped.
 *
 * Severity mapping:
 *   critical — must fix THIS cycle
 *   warning  — fix within 2-3 cycles
 *   info     — optimize when idle
 */

import type {
  InvariantResult,
  InvariantSeverity,
  MarketState,
  MarketTier,
  RiskLimits,
} from "./types-v2.js";

// ─── State interface (subset of OrderBookState) ───

export interface InvariantState {
  markets: Map<string, MarketState>;
  balance: number;
  totalExposure: number;
  capitalUtilization: number;
  sessionPnL: number;
  haltedByHuman: Set<string>;
}

// ─── Config ───

/** Max quote staleness per tier (ms). */
const STALENESS_LIMITS: Record<MarketTier, number> = {
  1: 120_000,  // 2 minutes — must stay quoted
  2: 180_000,  // 3 minutes — should stay quoted
  3: 300_000,  // 5 minutes — may go dark
};

/** Severity for freshness violations per tier. */
const STALENESS_SEVERITY: Record<MarketTier, InvariantSeverity> = {
  1: "critical",
  2: "warning",
  3: "info",
};

/** Max acceptable drift between quote midpoint and fair value (cents). */
const MAX_FV_DRIFT = 10;

// ─── Core ───

/**
 * Run all invariants against current state.
 * Returns array of results — check `passed` field for failures.
 */
export function runInvariants(
  state: InvariantState,
  limits: RiskLimits,
): InvariantResult[] {
  const results: InvariantResult[] = [];

  // Per-market invariants
  for (const [marketId, market] of state.markets) {
    // Skip resolved, closing, or human-halted markets
    if (
      market.status === "resolved" ||
      market.status === "closing" ||
      state.haltedByHuman.has(marketId)
    ) {
      continue;
    }

    results.push(...checkMarketInvariants(market, limits));
  }

  // Portfolio-level invariants
  results.push(...checkPortfolioInvariants(state, limits));

  return results;
}

/**
 * Return only failed invariants, sorted by severity (critical first).
 */
export function getViolations(results: InvariantResult[]): InvariantResult[] {
  const severityOrder: Record<InvariantSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return results
    .filter((r) => !r.passed)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

/**
 * Check if any critical invariant failed.
 */
export function hasCriticalViolation(results: InvariantResult[]): boolean {
  return results.some((r) => !r.passed && r.severity === "critical");
}

// ─── Per-Market Checks ───

function checkMarketInvariants(
  market: MarketState,
  limits: RiskLimits,
): InvariantResult[] {
  const results: InvariantResult[] = [];
  const id = market.id;

  // 1. FRESHNESS — are we stale?
  const maxStale = STALENESS_LIMITS[market.tier];
  const severity = STALENESS_SEVERITY[market.tier];

  if (market.status === "dark") {
    // Tier 1/2 should never be dark
    if (market.tier <= 2) {
      results.push({
        rule: "freshness_dark",
        passed: false,
        severity: market.tier === 1 ? "critical" : "warning",
        details: `Tier ${market.tier} market is dark — should be quoting`,
        marketId: id,
      });
    }
    // Tier 3 dark is acceptable — info only
    else {
      results.push({
        rule: "freshness_dark",
        passed: true,
        severity: "info",
        details: `Tier 3 market dark — acceptable`,
        marketId: id,
      });
    }
  } else if (market.quotedAt > 0) {
    const quoteAge = Date.now() - market.quotedAt;
    if (quoteAge > maxStale) {
      results.push({
        rule: "freshness_stale",
        passed: false,
        severity,
        details: `Quote age ${Math.round(quoteAge / 1000)}s exceeds limit ${maxStale / 1000}s for tier ${market.tier}`,
        marketId: id,
      });
    } else {
      results.push({
        rule: "freshness_stale",
        passed: true,
        severity: "info",
        marketId: id,
      });
    }
  }

  // 2. SPREAD BOUNDS — bid/ask spread within limits
  if (market.ourBid && market.ourAsk) {
    const spread = market.ourAsk.price - market.ourBid.price;

    if (spread < limits.minSpread) {
      results.push({
        rule: "spread_too_tight",
        passed: false,
        severity: "warning",
        details: `Spread ${spread}¢ below minimum ${limits.minSpread}¢`,
        marketId: id,
      });
    } else {
      results.push({
        rule: "spread_too_tight",
        passed: true,
        severity: "info",
        marketId: id,
      });
    }

    // Wide spread is safe but worth noting
    if (spread > limits.maxSpread) {
      results.push({
        rule: "spread_too_wide",
        passed: false,
        severity: "info",
        details: `Spread ${spread}¢ above max ${limits.maxSpread}¢ — safe but not optimal`,
        marketId: id,
      });
    }

    // 3. CONSISTENCY — no crossed quotes
    if (market.ourBid.price >= market.ourAsk.price) {
      results.push({
        rule: "crossed_quotes",
        passed: false,
        severity: "critical",
        details: `Bid ${market.ourBid.price}¢ >= Ask ${market.ourAsk.price}¢`,
        marketId: id,
      });
    } else {
      results.push({
        rule: "crossed_quotes",
        passed: true,
        severity: "info",
        marketId: id,
      });
    }

    // 4. FAIR VALUE ALIGNMENT — quote midpoint should be near FV
    const quoteMid = (market.ourBid.price + market.ourAsk.price) / 2;
    const drift = Math.abs(quoteMid - market.fairValue);
    if (drift > MAX_FV_DRIFT) {
      results.push({
        rule: "fv_drift",
        passed: false,
        severity: "warning",
        details: `Quote mid ${quoteMid}¢ drifted ${drift}¢ from FV ${market.fairValue}¢`,
        marketId: id,
      });
    } else {
      results.push({
        rule: "fv_drift",
        passed: true,
        severity: "info",
        marketId: id,
      });
    }

    // 5. MINIMUM SIZE
    if (market.ourBid.size < limits.minSize || market.ourAsk.size < limits.minSize) {
      results.push({
        rule: "size_below_min",
        passed: false,
        severity: "info",
        details: `Bid size ${market.ourBid.size}, ask size ${market.ourAsk.size} — min ${limits.minSize}`,
        marketId: id,
      });
    }
  }

  // 6. POSITION LIMITS
  const netPosition = Math.abs(market.position.yes - market.position.no);
  if (netPosition > limits.maxPositionPerMarket) {
    results.push({
      rule: "position_limit",
      passed: false,
      severity: "critical",
      details: `Net position ${netPosition} exceeds limit ${limits.maxPositionPerMarket}`,
      marketId: id,
    });
  }

  return results;
}

// ─── Portfolio-Level Checks ───

function checkPortfolioInvariants(
  state: InvariantState,
  limits: RiskLimits,
): InvariantResult[] {
  const results: InvariantResult[] = [];

  // Capital utilization
  if (state.capitalUtilization > limits.maxCapitalUtilization) {
    results.push({
      rule: "capital_utilization",
      passed: false,
      severity: "critical",
      details: `Capital utilization ${(state.capitalUtilization * 100).toFixed(1)}% exceeds limit ${limits.maxCapitalUtilization * 100}%`,
    });
  } else {
    results.push({
      rule: "capital_utilization",
      passed: true,
      severity: "info",
    });
  }

  // Daily loss limit
  if (state.sessionPnL < -limits.maxDailyLoss) {
    results.push({
      rule: "daily_loss",
      passed: false,
      severity: "critical",
      details: `Session PnL $${state.sessionPnL.toFixed(2)} exceeds daily loss limit -$${limits.maxDailyLoss}`,
    });
  } else {
    results.push({
      rule: "daily_loss",
      passed: true,
      severity: "info",
    });
  }

  // Exposure limit
  if (state.balance > 0) {
    const exposureFraction = state.totalExposure / state.balance;
    if (exposureFraction > limits.maxTotalExposure) {
      results.push({
        rule: "total_exposure",
        passed: false,
        severity: "critical",
        details: `Total exposure ${(exposureFraction * 100).toFixed(1)}% exceeds limit ${limits.maxTotalExposure * 100}%`,
      });
    } else {
      results.push({
        rule: "total_exposure",
        passed: true,
        severity: "info",
      });
    }
  }

  return results;
}
