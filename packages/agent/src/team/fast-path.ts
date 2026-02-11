/**
 * fast-path.ts — Pre-LLM mechanical response in <100ms.
 *
 * The most important component. Implements "Stay Quoted" — adapt, don't disappear.
 *
 * Tier system:
 *   T1 (< 2¢ move):   No action (noise)
 *   T2 (2-8¢ move):   Cancel + replace at same FV, same spread, same size
 *   T3 (8-20¢ move):  Provisional FV = midpoint, spread × 2, size × 0.25, emit reprice_needed
 *   T4 (> 20¢ move):  Provisional FV = midpoint, spread × 4, size = minimum, emit reprice_needed (urgent)
 *
 * Never just cancels — always cancel + replace.
 * Only exceptions: capital exhaustion (risk denies ALL), closing mode, or human halt.
 */

import type {
  FastPathAction,
  FastPathConfig,
  FastPathTier,
  MarketSnapshotV2,
  Quote,
  RiskLimits,
  TeamEvent,
} from "./types-v2.js";
import type { OrderBookState } from "./order-book-state.js";
import type { EventQueue } from "./event-queue.js";
import { computeQuotes, buildPricerParams } from "./pricer-fn.js";
import { riskCheck, riskCheckAll } from "./risk-middleware.js";
import { getCoalesceKey, getEventPriority } from "./event-queue.js";

// ─── FastPath ───

export class FastPath {
  private readonly state: OrderBookState;
  private readonly queue: EventQueue;
  private readonly config: FastPathConfig;

  constructor(
    state: OrderBookState,
    queue: EventQueue,
    config: FastPathConfig,
  ) {
    this.state = state;
    this.queue = queue;
    this.config = config;
  }

  // ─── Data Refresh Handler ───

  /**
   * Process a data_refresh event. For each market, compute delta from current FV
   * to new orderbook midpoint and apply tier-based response.
   *
   * Returns actions for execution. Also pushes events to queue for Chief.
   */
  processDataRefresh(snapshots: MarketSnapshotV2[]): FastPathAction[] {
    const actions: FastPathAction[] = [];

    for (const snapshot of snapshots) {
      const marketId = (snapshot.market as Record<string, any>).id;
      if (!marketId) continue;

      const market = this.state.markets.get(marketId);
      if (!market) continue;

      // Skip markets that shouldn't be quoted
      if (market.status === "resolved" || market.status === "closing") {
        actions.push({ type: "no_action", marketId, reason: `status: ${market.status}` });
        continue;
      }
      if (this.state.isHalted(marketId)) {
        actions.push({ type: "no_action", marketId, reason: "halted" });
        continue;
      }

      // Compute orderbook midpoint from snapshot
      const ob = snapshot.orderbook;
      const bestBid = ob.bids.length > 0 ? Math.max(...ob.bids.map((b) => b.price)) : 0;
      const bestAsk = ob.asks.length > 0 ? Math.min(...ob.asks.map((a) => a.price)) : 100;
      const newMidpoint = bestBid > 0 && bestAsk < 100
        ? Math.round((bestBid + bestAsk) / 2)
        : market.fairValue;

      // Update market data in state
      this.state.updateMarketData(marketId, { bestBid, bestAsk, midpoint: newMidpoint });

      // Update oracle confidence if available
      const oracleConf = snapshot.oracleSignals[0]?.confidence;
      if (typeof oracleConf === "number") {
        this.state.updateMarketData(marketId, market.orderbook, oracleConf);
      }

      // Compute delta from current FV to new midpoint
      const delta = Math.abs(newMidpoint - market.fairValue);
      const tier = this.classifyTier(delta);

      const action = this.applyTier(tier, marketId, market, newMidpoint);
      actions.push(action);
    }

    return actions;
  }

  // ─── Oracle Change Handler ───

  /**
   * Process an oracle confidence change.
   * Adjusts quotes based on new confidence level.
   */
  processOracleChange(marketId: string, newConfidence: number): FastPathAction[] {
    const market = this.state.markets.get(marketId);
    if (!market) return [{ type: "no_action", marketId, reason: "unknown market" }];

    if (market.status === "resolved" || market.status === "closing") {
      return [{ type: "no_action", marketId, reason: `status: ${market.status}` }];
    }
    if (this.state.isHalted(marketId)) {
      return [{ type: "no_action", marketId, reason: "halted" }];
    }

    // High confidence → potential resolution
    if (newConfidence > 0.90) {
      const repriceEvent: TeamEvent = {
        type: "reprice_needed",
        marketId,
        reason: `Oracle confidence ${(newConfidence * 100).toFixed(0)}% — possible resolution`,
        urgent: true,
      };
      this.queue.push(repriceEvent, getEventPriority(repriceEvent), getCoalesceKey(repriceEvent));
    }

    // Recompute quotes with new confidence
    const quotes = computeQuotes(buildPricerParams(
      market.fairValue,
      newConfidence,
      market.position,
      this.state.limits,
      { maxSize: this.config.defaultMaxSize, skewFactor: this.config.skewFactor },
    ));

    return this.validateAndReturn(marketId, quotes);
  }

  // ─── Fill Handler ───

  /**
   * Process a fill event. Early warning: fill on our ask → market moved up.
   * Adjusts quotes to reflect new position.
   */
  processFill(
    marketId: string,
    side: "buy" | "sell",
    priceCents: number,
    size: number,
  ): FastPathAction[] {
    const market = this.state.markets.get(marketId);
    if (!market) return [{ type: "no_action", marketId, reason: "unknown market" }];

    // Fill on our ask → someone bought from us → market may be moving up
    // Fill on our bid → someone sold to us → market may be moving down
    const directionalSignal = side === "sell" ? "up" : "down";
    console.log(`[fast-path] Fill on ${marketId}: ${side} ${size} @ ${priceCents}¢ → market signal: ${directionalSignal}`);

    // Emit reprice_needed for Chief to evaluate
    const repriceEvent: TeamEvent = {
      type: "reprice_needed",
      marketId,
      reason: `Fill: ${side} ${size} @ ${priceCents}¢ — market moving ${directionalSignal}`,
      urgent: false,
    };
    this.queue.push(repriceEvent, getEventPriority(repriceEvent), getCoalesceKey(repriceEvent));

    // Recompute quotes with current state (position will be updated by reconciliation)
    const quotes = computeQuotes(buildPricerParams(
      market.fairValue,
      market.fairValueConfidence,
      market.position,
      this.state.limits,
      { maxSize: this.config.defaultMaxSize, skewFactor: this.config.skewFactor },
    ));

    return this.validateAndReturn(marketId, quotes);
  }

  // ─── Human Message Handler ───

  /**
   * Process a human message. Returns instant ack string if we can handle it,
   * or null if Chief should handle it.
   */
  processHumanMessage(content: string): { ack: string } | null {
    const lower = content.toLowerCase().trim();

    // Emergency keywords — handle immediately
    if (lower === "halt" || lower === "stop" || lower.includes("emergency halt")) {
      this.state.setGlobalHalt(true, `Human: ${content}`);
      return { ack: "HALT triggered. All trading stopped. Send 'resume' to restart." };
    }

    if (lower === "resume" || lower === "clear halt") {
      this.state.setGlobalHalt(false, "");
      return { ack: "Halt cleared. Resuming trading." };
    }

    if (lower === "status") {
      const marketCount = this.state.markets.size;
      const quotingCount = Array.from(this.state.markets.values()).filter((m) => m.status === "quoting").length;
      return {
        ack: `${quotingCount}/${marketCount} markets quoted. Balance: $${this.state.balance.toFixed(2)}. PnL: $${this.state.sessionPnL.toFixed(2)}.`,
      };
    }

    // Everything else → Chief handles it
    return null;
  }

  // ─── Internal ───

  /** Classify a price delta into a tier. */
  private classifyTier(deltaCents: number): FastPathTier {
    if (deltaCents < this.config.tier1Threshold) return 1;
    if (deltaCents < this.config.tier2Threshold) return 2;
    if (deltaCents < this.config.tier3Threshold) return 3;
    return 4;
  }

  /** Apply tier-based response to a market. */
  private applyTier(
    tier: FastPathTier,
    marketId: string,
    market: ReturnType<OrderBookState["markets"]["get"]> & {},
    newMidpoint: number,
  ): FastPathAction {
    switch (tier) {
      case 1:
        // Noise — no action needed
        return { type: "no_action", marketId, reason: "tier 1: noise" };

      case 2: {
        // Mechanical reprice — same FV, same spread, same size
        console.log(`[fast-path] T2 ${market.name}: ${Math.abs(newMidpoint - market.fairValue)}¢ move → mechanical reprice`);
        const quotes = computeQuotes(buildPricerParams(
          market.fairValue,
          market.fairValueConfidence,
          market.position,
          this.state.limits,
          { maxSize: this.config.defaultMaxSize, skewFactor: this.config.skewFactor },
        ));
        return this.validateAndReturnSingle(marketId, quotes);
      }

      case 3: {
        // Significant move — provisional FV, wider spread, smaller size
        console.log(`[fast-path] T3 ${market.name}: ${Math.abs(newMidpoint - market.fairValue)}¢ move → provisional FV ${newMidpoint}¢`);
        this.state.setFairValue(marketId, newMidpoint, market.fairValueConfidence * 0.5, "fast_path");
        this.state.setMarketStatus(marketId, "provisional");

        const quotes = computeQuotes({
          fairValue: newMidpoint,
          confidence: market.fairValueConfidence * 0.5,
          minSpread: this.state.limits.minSpread * 2,
          maxSpread: this.state.limits.maxSpread * 2,
          position: market.position,
          maxSize: Math.max(this.config.minSize, Math.round(this.config.defaultMaxSize * 0.25)),
          minSize: this.config.minSize,
          skewFactor: this.config.skewFactor,
        });

        // Emit reprice_needed for Chief
        const event: TeamEvent = {
          type: "reprice_needed",
          marketId,
          reason: `T3: ${Math.abs(newMidpoint - market.fairValue)}¢ move, provisional FV ${newMidpoint}¢`,
          urgent: false,
        };
        this.queue.push(event, getEventPriority(event), getCoalesceKey(event));

        return this.validateAndReturnSingle(marketId, quotes);
      }

      case 4: {
        // Massive dislocation — very wide, minimum size, urgent Chief attention
        console.log(`[fast-path] T4 ${market.name}: ${Math.abs(newMidpoint - market.fairValue)}¢ move → provisional_urgent FV ${newMidpoint}¢`);
        this.state.setFairValue(marketId, newMidpoint, market.fairValueConfidence * 0.25, "fast_path");
        this.state.setMarketStatus(marketId, "provisional_urgent");

        const quotes = computeQuotes({
          fairValue: newMidpoint,
          confidence: market.fairValueConfidence * 0.25,
          minSpread: this.state.limits.minSpread * 4,
          maxSpread: this.state.limits.maxSpread * 4,
          position: market.position,
          maxSize: this.config.minSize,
          minSize: this.config.minSize,
          skewFactor: this.config.skewFactor,
        });

        // Emit urgent reprice_needed for Chief
        const event: TeamEvent = {
          type: "reprice_needed",
          marketId,
          reason: `T4: ${Math.abs(newMidpoint - market.fairValue)}¢ move, URGENT provisional FV ${newMidpoint}¢`,
          urgent: true,
        };
        this.queue.push(event, 0, getCoalesceKey(event)); // P0 for T4

        return this.validateAndReturnSingle(marketId, quotes);
      }
    }
  }

  /** Validate quotes through risk middleware and return action. */
  private validateAndReturnSingle(marketId: string, quotes: Quote[]): FastPathAction {
    const riskState = {
      markets: this.state.markets,
      balance: this.state.balance,
      totalExposure: this.state.totalExposure,
      sessionPnL: this.state.sessionPnL,
    };

    const { decisions, spreadOk } = riskCheckAll(quotes, marketId, riskState, this.state.limits);

    // If spread is crossed, don't place
    if (!spreadOk.allow) {
      return { type: "no_action", marketId, reason: `risk: ${spreadOk.reason}` };
    }

    // Apply risk suggestions (reduced sizes)
    const validQuotes: Quote[] = [];
    for (let i = 0; i < quotes.length; i++) {
      const decision = decisions[i];
      if (decision.allow) {
        validQuotes.push(quotes[i]);
      } else if (decision.suggested?.size) {
        validQuotes.push({ ...quotes[i], size: decision.suggested.size });
      }
      // If not allowed and no suggestion, skip this quote
    }

    if (validQuotes.length === 0) {
      // Capital exhaustion — can't quote at all
      this.state.setMarketStatus(marketId, "dark");
      return { type: "no_action", marketId, reason: "risk: all quotes denied" };
    }

    return { type: "cancel_replace", marketId, quotes: validQuotes };
  }

  /** Validate and return actions for a list of quotes. */
  private validateAndReturn(marketId: string, quotes: Quote[]): FastPathAction[] {
    return [this.validateAndReturnSingle(marketId, quotes)];
  }
}
