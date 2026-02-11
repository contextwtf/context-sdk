/**
 * SharedDataCache — Polls market data once and serves all agents.
 *
 * Instead of 5 agents independently fetching markets, orderbooks, and oracle
 * signals (135+ API calls per cycle wave), the cache polls every N seconds
 * and agents read cached snapshots.
 *
 * API call reduction: ~135/wave → ~27/wave (one set of calls per poll).
 */

import type { ContextClient } from "@context-markets/sdk";

// ─── Types ───

export interface MarketSnapshot {
  market: Record<string, unknown>;
  orderbook: { bids: any[]; asks: any[] };
  oracleSignals: any[];
  fetchedAt: number;
}

export interface SharedDataCacheOptions {
  /** API client for fetching data. */
  client: ContextClient;
  /** Poll interval in ms. Default: 30000 (30s). */
  pollIntervalMs?: number;
  /** Search query for markets. Default: "" (all active). */
  searchQuery?: string;
  /** Max markets to track. Default: 20. */
  maxMarkets?: number;
  /** Callback fired after each successful poll with new snapshots. Used by v2 runtime. */
  onRefresh?: (snapshots: MarketSnapshot[]) => void;
}

// ─── SharedDataCache ───

export class SharedDataCache {
  private readonly client: ContextClient;
  private readonly pollIntervalMs: number;
  private readonly searchQuery: string;
  private readonly maxMarkets: number;
  private readonly onRefresh?: (snapshots: MarketSnapshot[]) => void;

  private snapshots = new Map<string, MarketSnapshot>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  /** Timestamp of last successful poll. */
  lastPollAt = 0;

  constructor(options: SharedDataCacheOptions) {
    this.client = options.client;
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.searchQuery = options.searchQuery ?? "";
    this.maxMarkets = options.maxMarkets ?? 20;
    this.onRefresh = options.onRefresh;
  }

  /** Start polling. Runs an initial poll immediately. */
  start(): void {
    if (this.pollTimer) return;

    console.log(`[cache] Starting shared data cache (poll every ${this.pollIntervalMs / 1000}s)`);

    // Initial poll
    this.poll();

    // Recurring poll
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log("[cache] Stopped");
  }

  /** Get cached snapshot for a market. */
  getSnapshot(marketId: string): MarketSnapshot | undefined {
    return this.snapshots.get(marketId);
  }

  /** Get all cached snapshots. */
  getAllSnapshots(): MarketSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /** Get just market IDs (for selectMarkets). */
  getMarketIds(): string[] {
    return Array.from(this.snapshots.keys());
  }

  /** Whether the cache has data (at least one successful poll). */
  get hasData(): boolean {
    return this.lastPollAt > 0 && this.snapshots.size > 0;
  }

  /** Age of cached data in ms. */
  get staleness(): number {
    return this.lastPollAt > 0 ? Date.now() - this.lastPollAt : Infinity;
  }

  // ─── Internal ───

  private async poll(): Promise<void> {
    // Prevent overlapping polls
    if (this.polling) return;
    this.polling = true;

    try {
      // 1. Discover markets
      const result = await this.client.searchMarkets({
        query: this.searchQuery,
        status: "active",
      });
      const marketIds = result.markets
        .map((m: { id: string }) => m.id)
        .slice(0, this.maxMarkets);

      if (marketIds.length === 0) {
        console.log("[cache] No active markets found");
        this.polling = false;
        return;
      }

      // 2. Fetch snapshots for all markets in parallel
      const newSnapshots = new Map<string, MarketSnapshot>();

      const results = await Promise.allSettled(
        marketIds.map(async (id: string) => {
          const [market, orderbook, oracle] = await Promise.all([
            this.client.getMarket(id),
            this.client.getOrderbook(id).catch(() => ({ bids: [], asks: [] })),
            this.client.getOracleSignals(id).catch(() => []),
          ]);
          return {
            id,
            snapshot: {
              market: (market as any).market ?? market,
              orderbook,
              oracleSignals: Array.isArray(oracle) ? oracle : [(oracle as any).oracle].filter(Boolean),
              fetchedAt: Date.now(),
            } as MarketSnapshot,
          };
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          newSnapshots.set(result.value.id, result.value.snapshot);
        }
      }

      // 3. Update cache atomically
      this.snapshots = newSnapshots;
      this.lastPollAt = Date.now();

      console.log(`[cache] Poll complete: ${newSnapshots.size} markets (${marketIds.length} requested)`);

      // 4. Fire onRefresh callback (v2 runtime wires this to FastPath + EventQueue)
      if (this.onRefresh && newSnapshots.size > 0) {
        try {
          this.onRefresh(Array.from(newSnapshots.values()));
        } catch (err) {
          console.error("[cache] onRefresh callback error:", err);
        }
      }
    } catch (err) {
      console.error("[cache] Poll error:", err instanceof Error ? err.message : err);
    } finally {
      this.polling = false;
    }
  }
}
