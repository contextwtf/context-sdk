/**
 * Enrichments Layer
 *
 * Enrichments compute analytical views from data the runtime already fetches,
 * producing rich narrative text for the LLM context. They maintain rolling
 * history across cycles to show trends, not just current state.
 *
 * Key difference from tools: enrichments are always present in context (free),
 * while tools are on-demand lookups the LLM requests.
 */

import type { MarketSnapshot, AgentState } from "../strategy.js";

// ─── Types ───

export interface EnrichmentInput {
  cycle: number;
  timestamp: number;
  markets: MarketSnapshot[];
  state: AgentState;
}

export interface ContextEnrichment {
  name: string;
  /**
   * Called each cycle with current data + rolling history.
   * Returns text for LLM context, or null to skip this cycle.
   */
  compute(current: EnrichmentInput, history: EnrichmentInput[]): string | null;
}

// ─── Built-in Enrichments ───

/**
 * Oracle Evolution — tracks how oracle signals change across cycles.
 * Shows the full evidence/reasoning text at each point so the LLM can
 * reason about *why* the oracle changed, not just that the number moved.
 */
export const oracleEvolution: ContextEnrichment = {
  name: "Oracle Evolution",
  compute(current, history) {
    const lines: string[] = [];

    for (const snap of current.markets) {
      const title = snap.market.title || (snap.market as any).question || "";
      const currentSignal = snap.oracleSignals[0];
      if (!currentSignal) continue;

      // Collect historical oracle signals for this market
      const points: Array<{
        cycle: number;
        timestamp: number;
        confidence: number;
        evidence: string;
      }> = [];

      for (const prev of history) {
        const prevSnap = prev.markets.find((m) => m.market.id === snap.market.id);
        const prevSignal = prevSnap?.oracleSignals[0];
        if (!prevSignal) continue;

        const prevConf = (prevSignal as any).confidence ?? (prevSignal as any).probability;
        if (prevConf === undefined) continue;

        // Only add if confidence changed from previous point
        const lastPoint = points[points.length - 1];
        if (lastPoint && Math.abs(lastPoint.confidence - prevConf * 100) < 1) continue;

        points.push({
          cycle: prev.cycle,
          timestamp: prev.timestamp,
          confidence: Math.round(prevConf * 100),
          evidence: ((prevSignal as any).evidence || (prevSignal as any).reasoning || "").slice(0, 150),
        });
      }

      const currentConf = (currentSignal as any).confidence ?? (currentSignal as any).probability;
      if (currentConf === undefined) continue;
      const currentPct = Math.round(currentConf * 100);

      // Only show if there's meaningful history (at least one different point)
      if (points.length === 0) continue;

      const firstConf = points[0].confidence;
      const delta = currentPct - firstConf;
      if (Math.abs(delta) < 2) continue; // Skip if barely moved

      lines.push(`ORACLE EVOLUTION — "${title}"`);

      // Show up to 3 most interesting historical points
      const shown = points.slice(-3);
      for (const pt of shown) {
        const time = new Date(pt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        lines.push(`  Cycle ${pt.cycle} (${time}): ${pt.confidence}%${pt.evidence ? ` — "${pt.evidence}"` : ""}`);
      }
      lines.push(`  Current: ${currentPct}% — "${((currentSignal as any).evidence || (currentSignal as any).reasoning || "").slice(0, 150)}"`);

      const direction = delta > 0 ? "up" : "down";
      const span = current.cycle - (shown[0]?.cycle ?? current.cycle);
      lines.push(`  Trend: ${delta > 0 ? "+" : ""}${delta}pp ${direction} over ${span} cycles`);
      lines.push("");
    }

    return lines.length > 0 ? lines.join("\n") : null;
  },
};

/**
 * Orderbook Diff — compares current orderbook to previous cycle.
 * Highlights aggressive orders, swept levels, and spread changes.
 */
export const orderbookDiff: ContextEnrichment = {
  name: "Orderbook Diff",
  compute(current, history) {
    if (history.length === 0) return null;
    const prev = history[history.length - 1];
    const lines: string[] = [];

    for (const snap of current.markets) {
      const title = snap.market.title || (snap.market as any).question || "";
      const prevSnap = prev.markets.find((m) => m.market.id === snap.market.id);
      if (!prevSnap) continue;

      const changes: string[] = [];

      // Bid side changes
      const currBidDepth = snap.orderbook.bids.reduce((s, b) => s + (b.size ?? 0), 0);
      const prevBidDepth = prevSnap.orderbook.bids.reduce((s, b) => s + (b.size ?? 0), 0);
      const bidDelta = currBidDepth - prevBidDepth;
      if (Math.abs(bidDelta) > 50) {
        const bestBid = snap.orderbook.bids[0]?.price;
        const prevBestBid = prevSnap.orderbook.bids[0]?.price;
        const bidLabel = bidDelta > 0 ? `+${bidDelta}` : `${bidDelta}`;
        let note = `Bid side: ${bidLabel} contracts`;
        if (bestBid !== undefined && bestBid !== prevBestBid) {
          note += ` (best bid ${prevBestBid ?? "?"}¢ → ${bestBid}¢)`;
        }
        changes.push(note);
      }

      // Ask side changes
      const currAskDepth = snap.orderbook.asks.reduce((s, a) => s + (a.size ?? 0), 0);
      const prevAskDepth = prevSnap.orderbook.asks.reduce((s, a) => s + (a.size ?? 0), 0);
      const askDelta = currAskDepth - prevAskDepth;
      if (Math.abs(askDelta) > 50) {
        const bestAsk = snap.orderbook.asks[0]?.price;
        const prevBestAsk = prevSnap.orderbook.asks[0]?.price;
        const askLabel = askDelta > 0 ? `+${askDelta}` : `${askDelta}`;
        let note = `Ask side: ${askLabel} contracts`;
        if (bestAsk !== undefined && bestAsk !== prevBestAsk) {
          note += ` (best ask ${prevBestAsk ?? "?"}¢ → ${bestAsk}¢)`;
        }
        changes.push(note);
      }

      // Spread change
      const currSpread = (snap.orderbook.asks[0]?.price ?? 100) - (snap.orderbook.bids[0]?.price ?? 0);
      const prevSpread = (prevSnap.orderbook.asks[0]?.price ?? 100) - (prevSnap.orderbook.bids[0]?.price ?? 0);
      if (Math.abs(currSpread - prevSpread) >= 2) {
        changes.push(`Spread: ${prevSpread}¢ → ${currSpread}¢`);
      }

      if (changes.length > 0) {
        lines.push(`ORDERBOOK CHANGES — "${title}"`);
        for (const change of changes) {
          lines.push(`  ${change}`);
        }
        lines.push("");
      }
    }

    return lines.length > 0 ? lines.join("\n") : null;
  },
};

/**
 * Price Momentum — rolling mid-price history for each market.
 * Shows markets with meaningful trends (5+ cent moves).
 */
export const priceMomentum: ContextEnrichment = {
  name: "Price Momentum",
  compute(current, history) {
    if (history.length < 3) return null;
    const lines: string[] = [];

    for (const snap of current.markets) {
      const title = snap.market.title || (snap.market as any).question || "";
      const currMid = getMid(snap);

      // Build price series from history
      const prices: number[] = [];
      for (const prev of history) {
        const prevSnap = prev.markets.find((m) => m.market.id === snap.market.id);
        if (prevSnap) prices.push(getMid(prevSnap));
      }
      prices.push(currMid);

      if (prices.length < 3) continue;

      const first = prices[0];
      const last = prices[prices.length - 1];
      const delta = last - first;

      // Only report 5+ cent moves
      if (Math.abs(delta) < 5) continue;

      const direction = delta > 0 ? "climb" : "drop";
      const accel = isAccelerating(prices) ? ", accelerating" : "";
      lines.push(
        `  "${title}" — ${first}¢ → ${last}¢ (${delta > 0 ? "+" : ""}${delta}¢, ${prices.length} cycles, ${direction}${accel})`,
      );
    }

    if (lines.length === 0) return null;
    return `PRICE TRENDS (5+ cent moves):\n${lines.join("\n")}`;
  },
};

/**
 * Volume Profile — fill activity summary per market.
 * Shows which markets are actively trading vs stale.
 */
export const volumeProfile: ContextEnrichment = {
  name: "Volume Profile",
  compute(current, _history) {
    // Volume profile works from the agent state — open orders and positions
    const positions = current.state.portfolio.positions ?? [];
    if (positions.length === 0) return null;

    const activeMarkets: string[] = [];
    const staleMarkets: string[] = [];

    for (const snap of current.markets) {
      const title = snap.market.title || (snap.market as any).question || "";
      const hasPosition = positions.some(
        (p: any) => p.marketId === snap.market.id && p.size > 0,
      );
      const hasOrders = current.state.openOrders.some(
        (o: any) => o.marketId === snap.market.id,
      );

      if (hasPosition || hasOrders) {
        activeMarkets.push(title);
      } else {
        staleMarkets.push(title);
      }
    }

    if (activeMarkets.length === 0) return null;

    const lines = [
      `ACTIVITY: ${activeMarkets.length} markets with positions/orders, ${staleMarkets.length} markets quiet`,
    ];
    for (const title of activeMarkets) {
      lines.push(`  Active: "${title}"`);
    }

    return lines.join("\n");
  },
};

// ─── Helpers ───

function getMid(snap: MarketSnapshot): number {
  const bestBid = snap.orderbook.bids[0]?.price ?? 0;
  const bestAsk = snap.orderbook.asks[0]?.price ?? 100;
  return Math.round((bestBid + bestAsk) / 2);
}

function isAccelerating(prices: number[]): boolean {
  if (prices.length < 4) return false;
  const half = Math.floor(prices.length / 2);
  const firstHalfDelta = prices[half] - prices[0];
  const secondHalfDelta = prices[prices.length - 1] - prices[half];
  // Accelerating if second half moved more in the same direction
  return Math.abs(secondHalfDelta) > Math.abs(firstHalfDelta) * 1.5
    && Math.sign(firstHalfDelta) === Math.sign(secondHalfDelta);
}
