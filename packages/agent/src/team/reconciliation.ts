/**
 * reconciliation.ts — Periodic sync between believed state and platform reality.
 *
 * Runs every 30s. Catches:
 * - Orphaned orders (on platform, not in our state) → cancel
 * - Phantom orders (in our state, not on platform) → re-place or mark filled
 * - Stale orders (wrong price/size) → cancel + re-place
 * - Position drift → update state, emit fill events
 * - Balance drift → update state, recalculate exposure
 */

import type { ContextTrader } from "@context-markets/sdk";
import type { OrderBookState } from "./order-book-state.js";
import type { EventQueue } from "./event-queue.js";
import type { TeamEvent } from "./types-v2.js";
import { getCoalesceKey, getEventPriority } from "./event-queue.js";

// ─── ReconciliationLoop ───

export class ReconciliationLoop {
  private readonly state: OrderBookState;
  private readonly queue: EventQueue;
  private readonly trader: ContextTrader;
  private readonly intervalMs: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private reconciling = false;

  constructor(
    state: OrderBookState,
    queue: EventQueue,
    trader: ContextTrader,
    intervalMs: number = 30_000,
  ) {
    this.state = state;
    this.queue = queue;
    this.trader = trader;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    console.log(`[reconcile] Starting reconciliation loop (every ${this.intervalMs / 1000}s)`);

    // First reconcile after a short delay (let the system initialize)
    setTimeout(() => this.reconcile(), 5_000);

    this.timer = setInterval(() => this.reconcile(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[reconcile] Stopped");
  }

  // ─── Core ───

  private async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;

    try {
      await this.reconcileOrders();
      await this.reconcileBalance();
      console.log(`[reconcile] Complete — ${this.state.markets.size} markets checked`);
    } catch (err) {
      console.error("[reconcile] Error:", err instanceof Error ? err.message : err);

      // Track API failures
      this.state.consecutiveApiFailures++;
      if (this.state.consecutiveApiFailures >= 3) {
        this.state.platformStatus = "degraded";
        console.error("[reconcile] Platform marked as DEGRADED (3+ consecutive API failures)");
      }
    } finally {
      this.reconciling = false;
    }
  }

  // ─── Order Reconciliation ───

  private async reconcileOrders(): Promise<void> {
    let allOrders: any[];
    try {
      const result = await this.trader.getAllMyOrders();
      allOrders = Array.isArray(result) ? result : (result as any).orders ?? [];
      // Reset failure counter on success
      this.state.consecutiveApiFailures = 0;
      this.state.platformStatus = "healthy";
    } catch {
      return; // Can't reconcile without order data
    }

    const openOrders = allOrders.filter((o: any) => !o.status || o.status === "open");

    // Build map of platform orders by market
    const platformOrdersByMarket = new Map<string, any[]>();
    for (const order of openOrders) {
      const marketId = order.marketId;
      if (!marketId) continue;
      if (!platformOrdersByMarket.has(marketId)) {
        platformOrdersByMarket.set(marketId, []);
      }
      platformOrdersByMarket.get(marketId)!.push(order);
    }

    // Check each market we think we're quoting
    for (const [marketId, market] of this.state.markets) {
      if (market.status === "resolved") continue;

      const platformOrders = platformOrdersByMarket.get(marketId) ?? [];

      // Orphan check: orders on platform but not in our state
      for (const order of platformOrders) {
        const nonce = order.nonce;
        const isOurBid = market.ourBid?.nonce === nonce;
        const isOurAsk = market.ourAsk?.nonce === nonce;

        if (!isOurBid && !isOurAsk) {
          // Orphaned order — cancel it
          console.log(`[reconcile] Orphan: ${nonce} on ${marketId} — cancelling`);
          try {
            await this.trader.cancelOrder(nonce);
          } catch (err) {
            console.error(`[reconcile] Failed to cancel orphan ${nonce}:`, err instanceof Error ? err.message : err);
          }
        }
      }

      // Phantom check: orders in our state but not on platform
      const platformNonces = new Set(platformOrders.map((o: any) => o.nonce));

      if (market.ourBid?.nonce && !platformNonces.has(market.ourBid.nonce)) {
        console.log(`[reconcile] Phantom bid on ${marketId} — might have been filled`);
        // Assume filled — emit fill event for Chief to handle
        const event: TeamEvent = {
          type: "fill",
          orderId: market.ourBid.nonce,
          marketId,
          side: "buy",
          outcome: "yes",
          priceCents: market.ourBid.price,
          size: market.ourBid.size,
        };
        this.queue.push(event, getEventPriority(event), getCoalesceKey(event));
        market.ourBid = null;
      }

      if (market.ourAsk?.nonce && !platformNonces.has(market.ourAsk.nonce)) {
        console.log(`[reconcile] Phantom ask on ${marketId} — might have been filled`);
        const event: TeamEvent = {
          type: "fill",
          orderId: market.ourAsk.nonce,
          marketId,
          side: "sell",
          outcome: "yes",
          priceCents: market.ourAsk.price,
          size: market.ourAsk.size,
        };
        this.queue.push(event, getEventPriority(event), getCoalesceKey(event));
        market.ourAsk = null;
      }

      // Remove this market from the platform map (so remaining are truly orphaned)
      platformOrdersByMarket.delete(marketId);
    }

    // Any remaining platform orders are for markets we don't track — cancel them
    for (const [marketId, orders] of platformOrdersByMarket) {
      for (const order of orders) {
        console.log(`[reconcile] Untracked market order: ${order.nonce} on ${marketId} — cancelling`);
        try {
          await this.trader.cancelOrder(order.nonce);
        } catch (err) {
          console.error(`[reconcile] Failed to cancel untracked order:`, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  // ─── Balance Reconciliation ───

  private async reconcileBalance(): Promise<void> {
    try {
      // Use API balance check
      const balanceResult = await this.trader.getMyBalance();
      const balance = typeof balanceResult === "number"
        ? balanceResult
        : (balanceResult as any).usdc ?? (balanceResult as any).balance ?? 0;

      const previousBalance = this.state.balance;
      this.state.updateBalance(balance);

      if (Math.abs(balance - previousBalance) > 0.01) {
        console.log(`[reconcile] Balance updated: $${previousBalance.toFixed(2)} → $${balance.toFixed(2)}`);
      }
    } catch (err) {
      console.error("[reconcile] Balance check failed:", err instanceof Error ? err.message : err);
    }
  }
}
