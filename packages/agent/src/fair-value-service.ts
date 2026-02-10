/**
 * FairValueService — Runtime-level pricing infrastructure
 *
 * Centralizes fair value computation so the runtime owns caching, rate limiting,
 * timeout cooldowns, and flow tracking. Strategies read `snapshot.fairValue`
 * instead of managing their own provider lifecycle.
 *
 * Phase 1: Additive, non-breaking. If not configured, behavior is identical to before.
 */

import type { Market, Fill } from "@context-markets/sdk";
import type { FairValueProvider, FairValueEstimate } from "./fair-value.js";
import type { MarketSnapshot } from "./strategy.js";

// ─── Configuration ───

export interface FairValueServiceOptions {
  /** Default provider for all markets. */
  default?: FairValueProvider;
  /** Override providers for specific market subsets. First match wins. */
  overrides?: Array<{
    filter: (market: Market) => boolean;
    provider: FairValueProvider;
  }>;
  /** Global rate limit: max concurrent LLM calls. Default: 1 */
  maxConcurrentCalls?: number;
  /** Minimum ms between LLM calls (stagger). Default: 20000 */
  minCallIntervalMs?: number;
  /** Flow tracking config. */
  flow?: {
    /** How much each fill shifts FV (cents per contract). Default: 0.02 */
    impactPerContract?: number;
    /** Maximum FV drift from flow between recalculations (cents). Default: 8 */
    maxDriftCents?: number;
    /** How much weight the LLM gets vs accumulated flow on recalculation (0-1). Default: 0.7 */
    llmWeightOnRecalc?: number;
    /** Provider names that should get flow adjustment. Default: all providers. */
    providerNames?: string[];
  };
  /** Timeout cooldown config. */
  cooldown?: {
    /** Base cooldown after a timeout (ms). Default: 300000 (5min) */
    baseMs?: number;
    /** Max cooldown cap (ms). Default: 1800000 (30min) */
    maxMs?: number;
  };
}

// ─── Internal State Types ───

interface CacheEntry {
  estimate: FairValueEstimate;
  providerName: string;
  timestamp: number;
  ttlMs: number;
}

interface FlowState {
  /** Base FV from last provider call. */
  llmFV: number;
  /** Accumulated fill-based drift. */
  flowPressure: number;
  /** Number of fills since last recalculation. */
  fillsSinceRecalc: number;
}

interface TimeoutInfo {
  lastTimeout: number;
  consecutive: number;
}

// ─── Service ───

export class FairValueService {
  private readonly defaultProvider: FairValueProvider | undefined;
  private readonly overrides: Array<{
    filter: (market: Market) => boolean;
    provider: FairValueProvider;
  }>;

  // Rate limiting
  private readonly maxConcurrentCalls: number;
  private readonly minCallIntervalMs: number;
  private callsInFlight = 0;
  private lastCallTime = 0;

  // Flow config
  private readonly flowImpactPerContract: number;
  private readonly flowMaxDriftCents: number;
  private readonly flowLlmWeightOnRecalc: number;
  private readonly flowProviderNames: string[] | undefined;

  // Cooldown config
  private readonly cooldownBaseMs: number;
  private readonly cooldownMaxMs: number;

  // Per-market state
  private readonly cache = new Map<string, CacheEntry>();
  private readonly flowState = new Map<string, FlowState>();
  private readonly timeoutHistory = new Map<string, TimeoutInfo>();

  // Fill buffer
  private readonly pendingFills: Fill[] = [];

  constructor(options: FairValueServiceOptions) {
    this.defaultProvider = options.default;
    this.overrides = options.overrides ?? [];

    this.maxConcurrentCalls = options.maxConcurrentCalls ?? 1;
    this.minCallIntervalMs = options.minCallIntervalMs ?? 20_000;

    this.flowImpactPerContract = options.flow?.impactPerContract ?? 0.02;
    this.flowMaxDriftCents = options.flow?.maxDriftCents ?? 8;
    this.flowLlmWeightOnRecalc = options.flow?.llmWeightOnRecalc ?? 0.7;
    this.flowProviderNames = options.flow?.providerNames;

    this.cooldownBaseMs = options.cooldown?.baseMs ?? 300_000;
    this.cooldownMaxMs = options.cooldown?.maxMs ?? 1_800_000;
  }

  /**
   * Compute fair values for all snapshots. Called by the runtime before strategy.evaluate().
   * Attaches results to snapshot.fairValue in-place.
   */
  async computeAll(snapshots: MarketSnapshot[]): Promise<void> {
    // Process any buffered fills before computing
    this.processPendingFills();

    // Group snapshots by provider for parallel execution
    const groups = new Map<
      FairValueProvider,
      MarketSnapshot[]
    >();
    const noProvider: MarketSnapshot[] = [];

    for (const snapshot of snapshots) {
      const provider = this.getProvider(snapshot.market);
      if (!provider) {
        noProvider.push(snapshot);
        continue;
      }
      const group = groups.get(provider) ?? [];
      group.push(snapshot);
      groups.set(provider, group);
    }

    // Run provider groups concurrently
    const providerPromises: Promise<void>[] = [];
    for (const [provider, group] of groups) {
      providerPromises.push(this.computeGroup(provider, group));
    }

    await Promise.all(providerPromises);
  }

  /**
   * Buffer a fill for flow adjustment on the next computeAll() call.
   */
  onFill(fill: Fill): void {
    this.pendingFills.push(fill);
  }

  /**
   * Returns which provider handles a given market, or undefined if none configured.
   */
  getProvider(market: Market): FairValueProvider | undefined {
    for (const override of this.overrides) {
      if (override.filter(market)) {
        return override.provider;
      }
    }
    return this.defaultProvider;
  }

  // ─── Provider Group Processing ───

  private async computeGroup(
    provider: FairValueProvider,
    snapshots: MarketSnapshot[],
  ): Promise<void> {
    // Process each market in the group sequentially (respecting rate limits)
    for (const snapshot of snapshots) {
      await this.computeOne(provider, snapshot);
    }
  }

  private async computeOne(
    provider: FairValueProvider,
    snapshot: MarketSnapshot,
  ): Promise<void> {
    const marketId = snapshot.market.id;
    const now = Date.now();

    // 1. Check cache — if valid and not expired, use it
    const cached = this.cache.get(marketId);
    if (cached && cached.providerName === provider.name) {
      const age = now - cached.timestamp;
      if (age < cached.ttlMs) {
        // Cache hit — apply flow drift if opted in, then attach
        snapshot.fairValue = this.applyFlowDrift(marketId, cached.estimate);
        return;
      }
    }

    // 2. Check cooldown — if market timed out recently, skip
    const timeoutInfo = this.timeoutHistory.get(marketId);
    if (timeoutInfo) {
      const cooldownMs = Math.min(
        this.cooldownBaseMs * Math.pow(2, timeoutInfo.consecutive - 1),
        this.cooldownMaxMs,
      );
      const elapsed = now - timeoutInfo.lastTimeout;
      if (elapsed < cooldownMs) {
        const remainMin = ((cooldownMs - elapsed) / 60_000).toFixed(1);
        console.log(
          `[fv-service] COOLDOWN: ${this.marketLabel(snapshot)} (${timeoutInfo.consecutive}x timeout, ${remainMin}min left)`,
        );
        // Use cached if available, otherwise return midpoint
        if (cached) {
          snapshot.fairValue = this.applyFlowDrift(marketId, cached.estimate);
        } else {
          snapshot.fairValue = this.midpointEstimate(snapshot);
        }
        return;
      }
    }

    // 3. Check rate limit
    const timeSinceLastCall = now - this.lastCallTime;
    if (
      this.callsInFlight >= this.maxConcurrentCalls ||
      timeSinceLastCall < this.minCallIntervalMs
    ) {
      // Rate limited — use cached or midpoint
      if (cached) {
        snapshot.fairValue = this.applyFlowDrift(marketId, cached.estimate);
      } else {
        snapshot.fairValue = this.midpointEstimate(snapshot);
      }
      return;
    }

    // 4. Call provider
    this.callsInFlight++;
    this.lastCallTime = now;

    try {
      const estimate = await Promise.race([
        provider.estimate(snapshot),
        this.timeout(90_000),
      ]);

      // Success — clear cooldown, cache result, reset flow state
      this.timeoutHistory.delete(marketId);

      const ttlMs = estimate.cacheTtlMs ?? 3_600_000; // Default: 1 hour

      // Blend with flow if we had prior state and fills occurred
      const flow = this.flowState.get(marketId);
      let effectiveEstimate = estimate;
      if (flow && flow.fillsSinceRecalc > 0 && this.isFlowEnabled(provider.name)) {
        const blendedYes = Math.round(
          this.flowLlmWeightOnRecalc * estimate.yesCents +
          (1 - this.flowLlmWeightOnRecalc) * (flow.llmFV + flow.flowPressure),
        );
        effectiveEstimate = {
          ...estimate,
          yesCents: clamp(blendedYes, 1, 99),
        };
        console.log(
          `[fv-service] RECALC BLEND: ${this.marketLabel(snapshot)} LLM=${estimate.yesCents}¢ flow-adj=${Math.round(flow.llmFV + flow.flowPressure)}¢ → blended=${effectiveEstimate.yesCents}¢`,
        );
      }

      this.cache.set(marketId, {
        estimate: effectiveEstimate,
        providerName: provider.name,
        timestamp: Date.now(),
        ttlMs,
      });

      // Reset flow state for this market
      if (this.isFlowEnabled(provider.name)) {
        this.flowState.set(marketId, {
          llmFV: effectiveEstimate.yesCents,
          flowPressure: 0,
          fillsSinceRecalc: 0,
        });
      }

      snapshot.fairValue = effectiveEstimate;
    } catch (error: any) {
      if (error?.message === "FV_SERVICE_TIMEOUT") {
        // Record timeout
        const prev = this.timeoutHistory.get(marketId);
        const consecutive = (prev?.consecutive ?? 0) + 1;
        this.timeoutHistory.set(marketId, {
          lastTimeout: Date.now(),
          consecutive,
        });
        const cooldownMin =
          Math.min(
            this.cooldownBaseMs * Math.pow(2, consecutive - 1),
            this.cooldownMaxMs,
          ) / 60_000;
        console.error(
          `[fv-service] TIMEOUT: ${this.marketLabel(snapshot)} (${consecutive}x → cooldown ${cooldownMin.toFixed(0)}min)`,
        );
      } else {
        console.error(
          `[fv-service] Provider error for ${this.marketLabel(snapshot)}:`,
          error,
        );
      }

      // Fallback: cached or midpoint
      if (cached) {
        snapshot.fairValue = this.applyFlowDrift(marketId, cached.estimate);
      } else {
        snapshot.fairValue = this.midpointEstimate(snapshot);
      }
    } finally {
      this.callsInFlight--;
      this.lastCallTime = Date.now();
    }
  }

  // ─── Flow Tracking ───

  private processPendingFills(): void {
    if (this.pendingFills.length === 0) return;

    for (const fill of this.pendingFills) {
      const marketId = fill.order.marketId;
      const flow = this.flowState.get(marketId);
      if (!flow) continue;

      // Check if the provider for this market has flow enabled
      const provider = this.getProviderForMarketId(marketId);
      if (provider && !this.isFlowEnabled(provider.name)) continue;

      const size = fill.fillSize || 1;
      const isBuy = fill.order.side === "buy";
      const isYes = fill.order.outcome === "yes";

      // Buy YES or Sell NO → upward pressure; Sell YES or Buy NO → downward
      const direction = isBuy === isYes ? 1 : -1;
      flow.flowPressure += direction * size * this.flowImpactPerContract;
      flow.fillsSinceRecalc++;

      // Clamp
      flow.flowPressure = clamp(
        flow.flowPressure,
        -this.flowMaxDriftCents,
        this.flowMaxDriftCents,
      );
    }

    // Clear buffer
    this.pendingFills.length = 0;
  }

  private applyFlowDrift(
    marketId: string,
    estimate: FairValueEstimate,
  ): FairValueEstimate {
    const flow = this.flowState.get(marketId);
    if (!flow || flow.flowPressure === 0) return estimate;

    return {
      ...estimate,
      yesCents: clamp(
        Math.round(flow.llmFV + flow.flowPressure),
        1,
        99,
      ),
    };
  }

  private isFlowEnabled(providerName: string): boolean {
    if (!this.flowProviderNames) return true; // All providers by default
    return this.flowProviderNames.includes(providerName);
  }

  // ─── Helpers ───

  /**
   * Lookup provider by market ID (for fill processing, where we only have the ID).
   * Falls back to checking overrides with a minimal market stub, then default.
   */
  private getProviderForMarketId(
    marketId: string,
  ): FairValueProvider | undefined {
    // Check cache first — it records which provider was used
    const cached = this.cache.get(marketId);
    if (cached) {
      // Find the provider by name
      for (const override of this.overrides) {
        if (override.provider.name === cached.providerName) {
          return override.provider;
        }
      }
      if (this.defaultProvider?.name === cached.providerName) {
        return this.defaultProvider;
      }
    }
    return this.defaultProvider;
  }

  private midpointEstimate(snapshot: MarketSnapshot): FairValueEstimate {
    const bestBid = snapshot.orderbook.bids?.[0]?.price ?? 0;
    const bestAsk = snapshot.orderbook.asks?.[0]?.price ?? 0;
    const mid =
      bestBid && bestAsk
        ? Math.round((bestBid + bestAsk) / 2)
        : bestBid || bestAsk || 50;
    return { yesCents: mid, confidence: 0.2 };
  }

  private marketLabel(snapshot: MarketSnapshot): string {
    const title =
      snapshot.market.title || (snapshot.market as any).question || "";
    return title.slice(0, 45) || snapshot.market.id.slice(0, 8);
  }

  private timeout(ms: number): Promise<never> {
    return new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("FV_SERVICE_TIMEOUT")), ms),
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
