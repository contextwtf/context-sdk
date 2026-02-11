/**
 * order-book-state.ts — Single source of truth for the MM team v2.
 *
 * Evolves from TeamBoard (board.ts). Key differences:
 * - Per-market MarketState instead of separate fairValues/assignments/etc.
 * - Event emission on significant state changes (pushes events to queue)
 * - Attention-based context building for Chief (full detail vs one-line)
 * - No agent inboxes or signal queue — replaced by EventQueue
 */

import type {
  EventListener,
  MarketSnapshotV2,
  MarketState,
  MarketStatus,
  MarketTier,
  QuoteState,
  RiskLimits,
  TeamEvent,
  DEFAULT_RISK_LIMITS,
} from "./types-v2.js";

// ─── OrderBookState ───

export class OrderBookState {
  // Per-market state
  readonly markets = new Map<string, MarketState>();

  // Portfolio state
  balance = 0;
  totalExposure = 0;
  capitalUtilization = 0;
  sessionPnL = 0;

  // Platform state
  platformStatus: "healthy" | "degraded" = "healthy";
  consecutiveApiFailures = 0;

  // Human controls
  readonly haltedByHuman = new Set<string>();
  globalHalt = false;
  globalHaltReason = "";

  // Pending scanner tasks (for Chief context)
  readonly pendingTasks: Array<{
    id: string;
    type: string;
    markets: string[];
    dispatchedAt: number;
    status: "running" | "completed" | "failed";
  }> = [];

  // Risk limits
  limits: RiskLimits;

  // Invariant tracking
  lastInvariantResults: import("./types-v2.js").InvariantResult[] = [];
  lastInvariantAt = 0;

  // Event listener — wired to EventQueue by RuntimeV2
  private eventListeners: EventListener[] = [];

  constructor(limits?: RiskLimits) {
    // Import default at runtime to avoid circular
    this.limits = limits ?? {
      maxPositionPerMarket: 500,
      maxTotalExposure: 0.80,
      maxCapitalUtilization: 0.80,
      maxLossPerMarket: 50,
      maxDailyLoss: 100,
      minSpread: 2,
      maxSpread: 30,
      minSize: 5,
    };
  }

  // ─── Event Listeners ───

  /** Register a callback for state-change events. Returns unsubscribe function. */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emit(event: TeamEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[state] Event listener error:", err);
      }
    }
  }

  // ─── Market Management ───

  /** Initialize a market from a data cache snapshot. */
  addMarket(
    id: string,
    snapshot: MarketSnapshotV2,
    tier: MarketTier = 3,
    category: string = "general",
  ): MarketState {
    const market = snapshot.market as Record<string, any>;
    const ob = snapshot.orderbook;

    const bestBid = ob.bids.length > 0 ? Math.max(...ob.bids.map((b) => b.price)) : 0;
    const bestAsk = ob.asks.length > 0 ? Math.min(...ob.asks.map((a) => a.price)) : 100;
    const midpoint = bestBid > 0 && bestAsk < 100
      ? Math.round((bestBid + bestAsk) / 2)
      : 50;

    const oracleConf = snapshot.oracleSignals[0]?.confidence ?? 0.5;

    const state: MarketState = {
      id,
      name: market.question ?? market.title ?? market.name ?? id.slice(0, 8),
      resolutionCriteria: market.resolutionCriteria ?? "",
      tier,
      category,

      fairValue: midpoint,
      fairValueConfidence: typeof oracleConf === "number" ? oracleConf : 0.5,
      fairValueSource: "initial",
      fairValueSetAt: Date.now(),

      status: "quoting",

      ourBid: null,
      ourAsk: null,

      position: { yes: 0, no: 0, costBasis: 0 },

      orderbook: { bestBid, bestAsk, midpoint },
      oracleConfidence: typeof oracleConf === "number" ? oracleConf : 0.5,
      volatilityEstimate: 0,

      quotedAt: 0,
    };

    this.markets.set(id, state);
    return state;
  }

  /** Update fair value. Emits reprice_needed if change is significant. */
  setFairValue(
    id: string,
    fv: number,
    confidence: number,
    source: string,
  ): void {
    const market = this.markets.get(id);
    if (!market) return;

    const oldFv = market.fairValue;
    market.fairValue = fv;
    market.fairValueConfidence = confidence;
    market.fairValueSource = source;
    market.fairValueSetAt = Date.now();

    // Clear provisional status when Chief sets FV
    if (source === "chief" && (market.status === "provisional" || market.status === "provisional_urgent")) {
      market.status = "quoting";
    }

    // Emit reprice_needed if FV changed significantly
    const delta = Math.abs(fv - oldFv);
    if (delta >= 2) {
      this.emit({
        type: "reprice_needed",
        marketId: id,
        reason: `FV changed ${oldFv}→${fv} (${source})`,
        urgent: delta >= 8,
      });
    }
  }

  /** Update market data from cache refresh. */
  updateMarketData(
    id: string,
    orderbook: { bestBid: number; bestAsk: number; midpoint: number },
    oracleConfidence?: number,
  ): void {
    const market = this.markets.get(id);
    if (!market) return;

    market.orderbook = orderbook;
    if (oracleConfidence !== undefined) {
      const previousConf = market.oracleConfidence;
      market.oracleConfidence = oracleConfidence;

      // Emit oracle_change if significant
      if (Math.abs(oracleConfidence - previousConf) > 0.05) {
        this.emit({
          type: "oracle_change",
          marketId: id,
          newConfidence: oracleConfidence,
          previousConfidence: previousConf,
        });
      }
    }
  }

  /** Update position after a fill or reconciliation. */
  updatePosition(
    id: string,
    position: { yes: number; no: number; costBasis: number },
  ): void {
    const market = this.markets.get(id);
    if (!market) return;

    market.position = position;

    // Update tier: markets with positions are always tier 1
    if (position.yes > 0 || position.no > 0) {
      market.tier = 1;
    }
  }

  /** Update balance and recalculate portfolio metrics. */
  updateBalance(balance: number): void {
    this.balance = balance;
    this.recalculatePortfolio();
  }

  /** Set market status. */
  setMarketStatus(id: string, status: MarketStatus): void {
    const market = this.markets.get(id);
    if (!market) return;
    market.status = status;
  }

  /** Record that we placed/updated quotes on a market. */
  setQuotes(
    id: string,
    bid: QuoteState | null,
    ask: QuoteState | null,
  ): void {
    const market = this.markets.get(id);
    if (!market) return;

    market.ourBid = bid;
    market.ourAsk = ask;
    market.quotedAt = Date.now();

    // If we have quotes, we're not dark
    if (bid || ask) {
      if (market.status === "dark") {
        market.status = "quoting";
      }
    }
  }

  // ─── Halt Management ───

  haltMarket(id: string, reason: string): void {
    this.haltedByHuman.add(id);
    const market = this.markets.get(id);
    if (market) {
      market.status = "dark";
    }
    console.log(`[state] Market halted: ${id} — ${reason}`);
  }

  resumeMarket(id: string): void {
    this.haltedByHuman.delete(id);
    const market = this.markets.get(id);
    if (market && market.status === "dark") {
      market.status = "quoting";
    }
    console.log(`[state] Market resumed: ${id}`);
  }

  setGlobalHalt(halt: boolean, reason: string): void {
    this.globalHalt = halt;
    this.globalHaltReason = reason;
    if (halt) {
      console.log(`[state] GLOBAL HALT: ${reason}`);
    } else {
      console.log(`[state] Global halt cleared`);
    }
  }

  isHalted(marketId?: string): boolean {
    if (this.globalHalt) return true;
    if (marketId && this.haltedByHuman.has(marketId)) return true;
    return false;
  }

  // ─── Pending Tasks ───

  addPendingTask(task: { id: string; type: string; markets: string[] }): void {
    this.pendingTasks.push({
      ...task,
      dispatchedAt: Date.now(),
      status: "running",
    });
  }

  completePendingTask(taskId: string, status: "completed" | "failed" = "completed"): void {
    const task = this.pendingTasks.find((t) => t.id === taskId);
    if (task) {
      task.status = status;
    }
    // Clean up old completed tasks (keep last 10)
    const completed = this.pendingTasks.filter((t) => t.status !== "running");
    if (completed.length > 10) {
      const toRemove = completed.slice(0, completed.length - 10);
      for (const t of toRemove) {
        const idx = this.pendingTasks.indexOf(t);
        if (idx >= 0) this.pendingTasks.splice(idx, 1);
      }
    }
  }

  // ─── Context Building ───

  /** Get markets that need Chief's attention. */
  getMarketsNeedingAttention(): MarketState[] {
    return Array.from(this.markets.values()).filter((m) =>
      m.status === "provisional" ||
      m.status === "provisional_urgent" ||
      m.position.yes > 0 ||
      m.position.no > 0,
    );
  }

  /**
   * Build attention-based context string for Chief LLM.
   *
   * Full detail for: markets in event batch, provisional markets, markets with positions.
   * One-line summary for all others.
   */
  buildChiefContext(activeMarketIds: string[]): string {
    const activeSet = new Set(activeMarketIds);

    // Markets needing full context
    const detailedIds = new Set<string>();
    for (const id of activeSet) detailedIds.add(id);
    for (const m of this.markets.values()) {
      if (m.status === "provisional" || m.status === "provisional_urgent") detailedIds.add(m.id);
      if (m.position.yes > 0 || m.position.no > 0) detailedIds.add(m.id);
    }

    const detailed: string[] = [];
    const background: string[] = [];

    for (const [id, m] of this.markets) {
      if (detailedIds.has(id)) {
        detailed.push(renderFullMarketContext(m));
      } else {
        background.push(renderOneLineMarket(m));
      }
    }

    const sections: string[] = [];

    if (detailed.length > 0) {
      sections.push(`## Markets Needing Attention (${detailed.length})\n${detailed.join("\n\n")}`);
    }
    if (background.length > 0) {
      sections.push(`## Background Markets (${background.length} — all stable)\n${background.join("\n")}`);
    }

    // Portfolio summary
    sections.push([
      `## Portfolio`,
      `Balance: $${this.balance.toFixed(2)}`,
      `Exposure: ${(this.totalExposure * 100).toFixed(1)}%`,
      `Capital Util: ${(this.capitalUtilization * 100).toFixed(1)}%`,
      `Session PnL: $${this.sessionPnL.toFixed(2)}`,
      this.globalHalt ? `GLOBAL HALT: ${this.globalHaltReason}` : "",
    ].filter(Boolean).join("\n"));

    // Pending tasks
    const running = this.pendingTasks.filter((t) => t.status === "running");
    if (running.length > 0) {
      sections.push(`## Pending Tasks\n${running.map((t) =>
        `- ${t.id}: ${t.type} on ${t.markets.join(", ")} (${Math.round((Date.now() - t.dispatchedAt) / 1000)}s ago)`,
      ).join("\n")}`);
    }

    return sections.join("\n\n");
  }

  // ─── Serialization ───

  toJSON(): Record<string, unknown> {
    const markets: Record<string, unknown> = {};
    for (const [id, m] of this.markets) {
      markets[id] = { ...m };
    }
    return {
      markets,
      balance: this.balance,
      totalExposure: this.totalExposure,
      capitalUtilization: this.capitalUtilization,
      sessionPnL: this.sessionPnL,
      platformStatus: this.platformStatus,
      globalHalt: this.globalHalt,
      globalHaltReason: this.globalHaltReason,
      haltedByHuman: [...this.haltedByHuman],
      pendingTasks: this.pendingTasks,
    };
  }

  // ─── Internal ───

  private recalculatePortfolio(): void {
    let totalCost = 0;
    let totalExposure = 0;

    for (const market of this.markets.values()) {
      totalCost += market.position.costBasis;
      // Worst case loss: max of cost basis or (100 - price) * size for sells
      const netPos = market.position.yes - market.position.no;
      if (netPos > 0) {
        // Long YES: worst case is worth 0 → lose cost basis
        totalExposure += market.position.costBasis;
      } else if (netPos < 0) {
        // Short YES (long NO): worst case is worth 100
        totalExposure += Math.abs(netPos) - market.position.costBasis;
      }
    }

    this.capitalUtilization = this.balance > 0 ? totalCost / this.balance : 0;
    this.totalExposure = this.balance > 0 ? totalExposure / this.balance : 0;
  }
}

// ─── Rendering Helpers ───

function renderFullMarketContext(m: MarketState): string {
  const lines = [
    `### ${m.name} [${m.status.toUpperCase()}] (Tier ${m.tier})`,
    `FV: ${m.fairValue}¢ (conf: ${(m.fairValueConfidence * 100).toFixed(0)}%, source: ${m.fairValueSource}, age: ${Math.round((Date.now() - m.fairValueSetAt) / 1000)}s)`,
    `Orderbook: bid ${m.orderbook.bestBid}¢ / ask ${m.orderbook.bestAsk}¢ (mid: ${m.orderbook.midpoint}¢)`,
    `Oracle confidence: ${(m.oracleConfidence * 100).toFixed(0)}%`,
  ];

  if (m.ourBid || m.ourAsk) {
    lines.push(
      `Our quotes: bid ${m.ourBid?.price ?? "-"}¢ × ${m.ourBid?.size ?? 0} / ask ${m.ourAsk?.price ?? "-"}¢ × ${m.ourAsk?.size ?? 0}`,
    );
  } else {
    lines.push(`Our quotes: NONE`);
  }

  const netPos = m.position.yes - m.position.no;
  if (netPos !== 0) {
    lines.push(
      `Position: ${netPos > 0 ? "LONG" : "SHORT"} ${Math.abs(netPos)} (yes: ${m.position.yes}, no: ${m.position.no}, cost: $${m.position.costBasis.toFixed(2)})`,
    );
  } else {
    lines.push(`Position: flat`);
  }

  return lines.join("\n");
}

function renderOneLineMarket(m: MarketState): string {
  const spread = m.ourBid && m.ourAsk
    ? `${m.ourAsk.price - m.ourBid.price}¢ spread`
    : "no quotes";
  const pos = m.position.yes - m.position.no;
  const posStr = pos === 0 ? "flat" : `${pos > 0 ? "+" : ""}${pos}`;
  return `${m.name}: FV ${m.fairValue}¢, ${spread}, ${posStr}`;
}
