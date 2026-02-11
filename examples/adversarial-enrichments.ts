/**
 * Custom Enrichments for Adversarial Agents
 *
 * These enrichments are NOT part of the public SDK — they're private
 * analytical views designed to exploit specific weaknesses in oracle
 * pricing and market maker behavior.
 */

import type { ContextEnrichment, EnrichmentInput } from "@context-markets/agent";

// ─── Oracle vs Market ───

/**
 * Compares oracle confidence to market mid-price for each market.
 * Flags gaps where the oracle and market disagree — these are
 * potential mispricing opportunities.
 *
 * Used by: Oracle Skeptic
 */
export const oracleVsMarket: ContextEnrichment = {
  name: "Oracle vs Market",
  compute(current, _history) {
    const lines: string[] = [];

    // Known weak categories for the Haiku oracle (from calibration data)
    const weakCategories = ["entertainment", "crypto", "geopolitics"];

    for (const snap of current.markets) {
      const title = snap.market.title || (snap.market as any).question || "";
      const oracle = snap.oracleSignals[0];
      if (!oracle) continue;

      const oracleConf = (oracle as any).confidence ?? (oracle as any).probability;
      if (oracleConf === undefined) continue;

      const oraclePct = Math.round(oracleConf * 100);
      const bestBid = snap.orderbook.bids[0]?.price ?? 0;
      const bestAsk = snap.orderbook.asks[0]?.price ?? 100;
      const mid = Math.round((bestBid + bestAsk) / 2);

      const gap = oraclePct - mid;
      if (Math.abs(gap) < 5) continue; // Only flag 5+ cent gaps

      // Detect category from title keywords
      const lower = title.toLowerCase();
      const category = detectCategory(lower);
      const isWeakCategory = weakCategories.includes(category);

      const direction = gap > 0 ? "HIGHER" : "LOWER";
      const confidence = isWeakCategory ? " ⚠️ WEAK CATEGORY" : "";
      const evidence = ((oracle as any).evidence || (oracle as any).reasoning || "").slice(0, 200);

      lines.push(`ORACLE vs MARKET — "${title}"`);
      lines.push(`  Oracle: ${oraclePct}% | Market mid: ${mid}¢ | Gap: ${gap > 0 ? "+" : ""}${gap}¢ (oracle ${direction})`);
      lines.push(`  Category: ${category}${confidence}`);
      if (evidence) {
        lines.push(`  Oracle reasoning: "${evidence}"`);
      }
      lines.push(`  Bid: ${bestBid}¢ / Ask: ${bestAsk}¢ (spread: ${bestAsk - bestBid}¢)`);
      lines.push("");
    }

    return lines.length > 0 ? lines.join("\n") : null;
  },
};

// ─── News Recency ───

/**
 * Tracks when oracle confidence last changed per market.
 * Flags markets where the oracle hasn't updated in many cycles
 * but may be stale relative to real-world events.
 *
 * Used by: Latency Sniper
 */
export const newsRecency: ContextEnrichment = {
  name: "News Recency",
  compute(current, history) {
    if (history.length < 3) return null;
    const lines: string[] = [];

    for (const snap of current.markets) {
      const marketId = snap.market.id;
      const title = snap.market.title || (snap.market as any).question || "";
      const currentOracle = snap.oracleSignals[0];
      if (!currentOracle) continue;

      const currentConf = (currentOracle as any).confidence ?? (currentOracle as any).probability;
      if (currentConf === undefined) continue;

      // Find when oracle last changed for this market
      let lastChangeCycle = current.cycle;
      let lastChangeTimestamp = current.timestamp;
      let previousConf = currentConf;

      for (let i = history.length - 1; i >= 0; i--) {
        const prev = history[i];
        const prevSnap = prev.markets.find((m) => m.market.id === marketId);
        const prevOracle = prevSnap?.oracleSignals[0];
        if (!prevOracle) continue;

        const prevConf = (prevOracle as any).confidence ?? (prevOracle as any).probability;
        if (prevConf === undefined) continue;

        if (Math.abs(prevConf - currentConf) > 0.02) {
          // Oracle changed here — this is when it last updated
          lastChangeCycle = prev.cycle;
          lastChangeTimestamp = prev.timestamp;
          previousConf = prevConf;
          break;
        }
      }

      const cyclesSinceChange = current.cycle - lastChangeCycle;
      const minutesSinceChange = Math.round((current.timestamp - lastChangeTimestamp) / 60000);

      // Flag markets where oracle has been static for 5+ cycles
      if (cyclesSinceChange < 5) continue;

      // Check if market mid has moved despite static oracle
      const mid = getMid(snap);
      let oldMid = mid;
      const changeHistory = history.find((h) => h.cycle === lastChangeCycle);
      if (changeHistory) {
        const oldSnap = changeHistory.markets.find((m) => m.market.id === marketId);
        if (oldSnap) oldMid = getMid(oldSnap);
      }
      const midDrift = mid - oldMid;

      lines.push(`STALE ORACLE — "${title}"`);
      lines.push(`  Oracle unchanged for ${cyclesSinceChange} cycles (${minutesSinceChange} min)`);
      lines.push(`  Oracle: ${Math.round(currentConf * 100)}% (was ${Math.round(previousConf * 100)}%)`);
      if (Math.abs(midDrift) >= 2) {
        lines.push(`  Market drifted ${midDrift > 0 ? "+" : ""}${midDrift}¢ since last oracle update`);
      }
      lines.push("");
    }

    return lines.length > 0 ? lines.join("\n") : null;
  },
};

// ─── MM Fingerprint ───

/**
 * Analyzes orderbook structure to identify automated market makers.
 * Looks for telltale patterns: symmetric ladders, equal spacing,
 * fixed sizes, and regular refresh intervals.
 *
 * Used by: Microstructure Reader
 */
export const mmFingerprint: ContextEnrichment = {
  name: "MM Fingerprint",
  compute(current, history) {
    if (history.length < 3) return null;
    const lines: string[] = [];

    for (const snap of current.markets) {
      const title = snap.market.title || (snap.market as any).question || "";
      const bids = snap.orderbook.bids;
      const asks = snap.orderbook.asks;

      if (bids.length < 2 || asks.length < 2) continue;

      // Analyze bid ladder
      const bidAnalysis = analyzeLadder(bids);
      const askAnalysis = analyzeLadder(asks);

      // Check for symmetric structure (MM hallmark)
      const isSymmetric =
        bidAnalysis.isLadder &&
        askAnalysis.isLadder &&
        Math.abs(bidAnalysis.avgSize - askAnalysis.avgSize) < bidAnalysis.avgSize * 0.3;

      if (!isSymmetric && !bidAnalysis.isLadder && !askAnalysis.isLadder) continue;

      // Calculate spread
      const bestBid = bids[0]?.price ?? 0;
      const bestAsk = asks[0]?.price ?? 100;
      const spread = bestAsk - bestBid;

      // Detect inventory skew — if bids are further from mid than asks,
      // MM is likely long (shifted asks down to sell)
      const mid = Math.round((bestBid + bestAsk) / 2);
      const bidDistance = mid - bestBid;
      const askDistance = bestAsk - mid;
      const skew = bidDistance - askDistance; // positive = shifted asks closer (MM is long)

      // Estimate refresh interval from history
      const refreshInfo = estimateRefreshInterval(snap.market.id, current, history);

      lines.push(`MM DETECTED — "${title}"`);
      if (isSymmetric) {
        lines.push(`  Structure: Symmetric ${bids.length}-level ladder, ${spread}¢ spread`);
      } else {
        lines.push(`  Structure: ${bidAnalysis.isLadder ? "Bid" : ""}${askAnalysis.isLadder ? " Ask" : ""} ladder, ${spread}¢ spread`);
      }
      lines.push(`  Bid levels: ${bids.length} (avg ${bidAnalysis.avgSize} contracts, ${bidAnalysis.avgSpacing}¢ spacing)`);
      lines.push(`  Ask levels: ${asks.length} (avg ${askAnalysis.avgSize} contracts, ${askAnalysis.avgSpacing}¢ spacing)`);

      if (Math.abs(skew) >= 1) {
        const direction = skew > 0 ? "LONG (asks closer to mid)" : "SHORT (bids closer to mid)";
        lines.push(`  Inventory skew: ${direction} (${Math.abs(skew)}¢ asymmetry)`);
      }

      if (refreshInfo) {
        lines.push(`  Refresh: ~${refreshInfo.intervalCycles} cycles (last ${refreshInfo.cyclesSinceLast} cycles ago)`);
        if (refreshInfo.predictedNextIn !== undefined) {
          lines.push(`  Next refresh predicted in ~${refreshInfo.predictedNextIn} cycles`);
        }
      }
      lines.push("");
    }

    return lines.length > 0 ? lines.join("\n") : null;
  },
};

// ─── Resolution Proximity ───

/**
 * Identifies markets approaching resolution — where price is converging
 * toward 0 or 100 and oracle confidence is trending strongly.
 *
 * Used by: Resolution Racer
 */
export const resolutionProximity: ContextEnrichment = {
  name: "Resolution Proximity",
  compute(current, history) {
    if (history.length < 2) return null;
    const lines: string[] = [];

    for (const snap of current.markets) {
      const title = snap.market.title || (snap.market as any).question || "";
      const mid = getMid(snap);
      const oracle = snap.oracleSignals[0];

      // Check distance from extremes
      const distFrom100 = 100 - mid;
      const distFrom0 = mid;
      const nearExtreme = Math.min(distFrom100, distFrom0);
      const leaning = distFrom0 > distFrom100 ? "YES" : "NO";

      // Need oracle or strong price signal
      let oracleConf = 0;
      let oracleDirection = "";
      if (oracle) {
        oracleConf = Math.round(
          ((oracle as any).confidence ?? (oracle as any).probability ?? 0.5) * 100,
        );
        oracleDirection = oracleConf >= 70 ? "YES" : oracleConf <= 30 ? "NO" : "UNCERTAIN";
      }

      // Track oracle confidence trajectory
      let oracleTrend = 0;
      let trendCycles = 0;
      if (history.length >= 3) {
        const recentHistory = history.slice(-5);
        const firstOracle = recentHistory[0]?.markets
          .find((m) => m.market.id === snap.market.id)
          ?.oracleSignals[0];
        if (firstOracle) {
          const firstConf = Math.round(
            ((firstOracle as any).confidence ?? (firstOracle as any).probability ?? 0.5) * 100,
          );
          oracleTrend = oracleConf - firstConf;
          trendCycles = current.cycle - (recentHistory[0]?.cycle ?? current.cycle);
        }
      }

      // Flag markets that are:
      // 1. Within 20¢ of resolution (mid > 80 or mid < 20)
      // 2. Oracle confidence > 75% or < 25%
      // 3. Strong oracle trend (5+ pp in recent history)
      const nearResolution = nearExtreme <= 20;
      const strongOracle = oracleConf >= 75 || oracleConf <= 25;
      const strongTrend = Math.abs(oracleTrend) >= 5;

      if (!nearResolution && !strongOracle && !strongTrend) continue;

      // Check resolution date if available
      const resolutionDate = (snap.market as any).resolutionDate || (snap.market as any).endDate;
      let timeToResolution = "";
      if (resolutionDate) {
        const resDate = new Date(resolutionDate);
        const hoursLeft = Math.round((resDate.getTime() - Date.now()) / 3600000);
        if (hoursLeft <= 0) {
          timeToResolution = "PAST DUE";
        } else if (hoursLeft <= 24) {
          timeToResolution = `${hoursLeft}h left`;
        } else {
          timeToResolution = `${Math.round(hoursLeft / 24)}d left`;
        }
      }

      lines.push(`RESOLUTION SIGNAL — "${title}"`);
      lines.push(`  Market: ${mid}¢ mid (leaning ${leaning}, ${nearExtreme}¢ from resolution)`);

      if (oracle) {
        lines.push(`  Oracle: ${oracleConf}% confidence → ${oracleDirection}`);
      }
      if (Math.abs(oracleTrend) >= 2) {
        lines.push(`  Oracle trend: ${oracleTrend > 0 ? "+" : ""}${oracleTrend}pp over ${trendCycles} cycles`);
      }
      if (timeToResolution) {
        lines.push(`  Deadline: ${timeToResolution}`);
      }

      // Agreement check — does oracle agree with market direction?
      if (oracle) {
        const oracleLeaning = oracleConf >= 50 ? "YES" : "NO";
        if (oracleLeaning !== leaning) {
          lines.push(`  ⚠️ DISAGREEMENT: Market leans ${leaning} but oracle leans ${oracleLeaning}`);
        } else if (strongOracle && nearExtreme > 10) {
          lines.push(`  OPPORTUNITY: Oracle strong (${oracleConf}%) but market still at ${mid}¢`);
        }
      }
      lines.push("");
    }

    return lines.length > 0 ? lines.join("\n") : null;
  },
};

// ─── Orderbook Arbitrage ───

/**
 * Scans all orderbooks for arbitrage opportunities:
 * 1. Inverted spreads: YES ask < YES bid (buy ask, sell bid)
 * 2. Deep sweep: sweep multiple ask levels profitably into resting bids
 *
 * The orderbook is presented from the YES perspective. An "inverted" spread
 * means you can buy YES tokens at the ask and immediately sell at the bid.
 * This happens when NO-side orders create YES-equivalent prices that cross.
 *
 * Used by: Microstructure Reader
 */
export const orderbookArbitrage: ContextEnrichment = {
  name: "Orderbook Arbitrage",
  compute(current, _history) {
    const lines: string[] = [];

    for (const snap of current.markets) {
      const title = snap.market.title || (snap.market as any).question || "";
      const bids = snap.orderbook.bids; // YES bids, sorted desc by price
      const asks = snap.orderbook.asks; // YES asks, sorted asc by price

      if (bids.length === 0 || asks.length === 0) continue;

      const bestBid = bids[0].price;
      const bestAsk = asks[0].price;

      // Check for inverted spread (best ask < best bid)
      if (bestAsk < bestBid) {
        const instantProfit = bestBid - bestAsk;
        const minSize = Math.min(bids[0].size ?? 0, asks[0].size ?? 0);

        // Calculate full sweep profit across multiple levels
        const sweep = calculateSweepProfit(bids, asks);
        const arbSize = sweep.totalContracts > 0 ? sweep.totalContracts : minSize;

        lines.push(`🔴 ARBITRAGE — "${title}"`);
        lines.push(`  INVERTED SPREAD: Ask ${bestAsk}¢ < Bid ${bestBid}¢ (${instantProfit}¢ profit/contract)`);
        lines.push(`  Size: ${arbSize} contracts, Profit: $${((sweep.totalProfit || instantProfit * minSize) / 100).toFixed(2)}`);
        lines.push(`  >>> EXECUTE THESE EXACT ORDERS:`);
        lines.push(`  >>> { "type": "place_order", "market": "${title}", "side": "buy", "outcome": "yes", "priceCents": ${bestAsk}, "size": ${arbSize} }`);
        lines.push(`  >>> { "type": "place_order", "market": "${title}", "side": "sell", "outcome": "yes", "priceCents": ${bestBid}, "size": ${arbSize} }`);

        if (sweep.totalContracts > 0 && sweep.levels.length > 1) {
          lines.push(`  Level breakdown:`);
          for (const level of sweep.levels) {
            lines.push(`    ${level.size} @ buy ${level.buyPrice}¢ → sell ${level.sellPrice}¢ = +${level.profit.toFixed(1)}¢`);
          }
        }
        lines.push("");
      }

      // Also check for near-arbitrage (spread < 2¢ with deep liquidity)
      else if (bestBid - bestAsk <= 2 && bestBid > bestAsk) {
        // Already inverted but marginal — worth flagging
        const profit = bestBid - bestAsk;
        lines.push(`⚠️ NEAR-ARBITRAGE — "${title}"`);
        lines.push(`  Spread: ${profit}¢ (Ask ${bestAsk}¢ / Bid ${bestBid}¢)`);
        lines.push("");
      }
    }

    return lines.length > 0 ? lines.join("\n") : null;
  },
};

/**
 * Given YES bids (desc) and YES asks (asc), calculate how many contracts
 * you can buy at asks and sell at bids for a profit.
 * Walks both sides of the book until the spread is no longer inverted.
 */
function calculateSweepProfit(
  bids: Array<{ price: number; size?: number }>,
  asks: Array<{ price: number; size?: number }>,
): {
  totalContracts: number;
  totalProfit: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  levels: Array<{ buyPrice: number; sellPrice: number; size: number; profit: number }>;
} {
  const levels: Array<{ buyPrice: number; sellPrice: number; size: number; profit: number }> = [];
  let totalContracts = 0;
  let totalCost = 0;
  let totalRevenue = 0;

  let bidIdx = 0;
  let askIdx = 0;
  let bidRemaining = bids[0]?.size ?? 0;
  let askRemaining = asks[0]?.size ?? 0;

  while (bidIdx < bids.length && askIdx < asks.length) {
    const bidPrice = bids[bidIdx].price;
    const askPrice = asks[askIdx].price;

    // Stop when spread is no longer inverted
    if (askPrice >= bidPrice) break;

    const size = Math.min(bidRemaining, askRemaining);
    if (size <= 0) break;

    const profit = (bidPrice - askPrice) * size;
    levels.push({ buyPrice: askPrice, sellPrice: bidPrice, size, profit });
    totalContracts += size;
    totalCost += askPrice * size;
    totalRevenue += bidPrice * size;

    bidRemaining -= size;
    askRemaining -= size;

    if (bidRemaining <= 0) {
      bidIdx++;
      bidRemaining = bids[bidIdx]?.size ?? 0;
    }
    if (askRemaining <= 0) {
      askIdx++;
      askRemaining = asks[askIdx]?.size ?? 0;
    }
  }

  return {
    totalContracts,
    totalProfit: totalRevenue - totalCost,
    avgBuyPrice: totalContracts > 0 ? totalCost / totalContracts : 0,
    avgSellPrice: totalContracts > 0 ? totalRevenue / totalContracts : 0,
    levels,
  };
}

// ─── Helpers ───

function getMid(snap: { orderbook: { bids: any[]; asks: any[] } }): number {
  const bestBid = snap.orderbook.bids[0]?.price ?? 0;
  const bestAsk = snap.orderbook.asks[0]?.price ?? 100;
  return Math.round((bestBid + bestAsk) / 2);
}

function detectCategory(title: string): string {
  if (/nba|nfl|mlb|nhl|ncaa|game|win|score|series|playoff|champion/i.test(title)) return "sports";
  if (/bitcoin|btc|eth|crypto|solana|token|coin|defi/i.test(title)) return "crypto";
  if (/movie|oscar|grammy|emmy|album|song|box office|streaming|netflix/i.test(title)) return "entertainment";
  if (/trump|biden|election|congress|senate|supreme court|vote|poll/i.test(title)) return "politics";
  if (/war|nato|china|russia|ukraine|sanctions|missile|nuclear/i.test(title)) return "geopolitics";
  if (/stock|s&p|nasdaq|earnings|gdp|inflation|fed|interest rate/i.test(title)) return "business";
  return "general";
}

function analyzeLadder(levels: Array<{ price: number; size?: number }>): {
  isLadder: boolean;
  avgSpacing: number;
  avgSize: number;
} {
  if (levels.length < 2) return { isLadder: false, avgSpacing: 0, avgSize: 0 };

  const spacings: number[] = [];
  const sizes: number[] = [];

  for (let i = 0; i < levels.length - 1; i++) {
    spacings.push(Math.abs(levels[i + 1].price - levels[i].price));
    sizes.push(levels[i].size ?? 0);
  }
  sizes.push(levels[levels.length - 1].size ?? 0);

  const avgSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
  const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;

  // A "ladder" has relatively consistent spacing (within 50% of average)
  const spacingVariance =
    spacings.reduce((a, b) => a + Math.abs(b - avgSpacing), 0) / spacings.length;
  const isLadder = avgSpacing > 0 && spacingVariance / avgSpacing < 0.5;

  return {
    isLadder,
    avgSpacing: Math.round(avgSpacing),
    avgSize: Math.round(avgSize),
  };
}

function estimateRefreshInterval(
  marketId: string,
  current: EnrichmentInput,
  history: EnrichmentInput[],
): { intervalCycles: number; cyclesSinceLast: number; predictedNextIn?: number } | null {
  if (history.length < 5) return null;

  // Look for cycles where the orderbook structure changed significantly
  // (multiple levels added/removed simultaneously = MM refresh)
  const refreshCycles: number[] = [];
  let lastLevels = 0;

  for (let i = 0; i < history.length; i++) {
    const snap = history[i].markets.find((m) => m.market.id === marketId);
    if (!snap) continue;

    const totalLevels = snap.orderbook.bids.length + snap.orderbook.asks.length;
    if (lastLevels > 0 && Math.abs(totalLevels - lastLevels) >= 2) {
      refreshCycles.push(history[i].cycle);
    }
    lastLevels = totalLevels;
  }

  if (refreshCycles.length < 2) return null;

  // Calculate average interval between refreshes
  const intervals: number[] = [];
  for (let i = 1; i < refreshCycles.length; i++) {
    intervals.push(refreshCycles[i] - refreshCycles[i - 1]);
  }
  const avgInterval = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
  const lastRefresh = refreshCycles[refreshCycles.length - 1];
  const cyclesSinceLast = current.cycle - lastRefresh;

  return {
    intervalCycles: avgInterval,
    cyclesSinceLast,
    predictedNextIn: Math.max(0, avgInterval - cyclesSinceLast),
  };
}
