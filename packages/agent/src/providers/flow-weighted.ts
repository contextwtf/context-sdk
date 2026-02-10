import { readFileSync, writeFile } from "node:fs";
import type { Fill } from "@context-markets/sdk";
import type { MarketSnapshot } from "../strategy.js";
import type { FairValueEstimate, FairValueProvider } from "../fair-value.js";

export interface FlowWeightedFairValueOptions {
  /** Anchor provider for decay target (e.g., ChainedFairValue). */
  anchorProvider?: FairValueProvider;
  /** Fallback FV in cents if no anchor. Default 50. */
  fallbackCents?: number;
  /** FV move per contract filled. Default 0.5. */
  impactCents?: number;
  /** Per-cycle decay toward anchor (0-1). Default 0.02. ~35 cycle half-life. */
  decayRate?: number;
  /** Max cents FV can drift from anchor. Default 30. Prevents runaway. */
  maxDriftCents?: number;
  /** Path to persist state. Null = no persistence. */
  statePath?: string | null;
  /** Fill count threshold for full confidence. Default 10. */
  targetFillCount?: number;
  /** Max age in ms before persisted state gets extra decay. Default 1hr. */
  staleThresholdMs?: number;
}

interface MarketFVState {
  yesFV: number;
  fillCount: number;
  lastUpdated: string;
}

interface PersistedState {
  version: number;
  markets: Record<string, MarketFVState>;
}

export class FlowWeightedFairValue implements FairValueProvider {
  readonly name = "Flow-Weighted Fair Value";

  private readonly anchorProvider?: FairValueProvider;
  private readonly fallbackCents: number;
  private readonly impactCents: number;
  private readonly decayRate: number;
  private readonly maxDriftCents: number;
  private readonly statePath: string | null;
  private readonly targetFillCount: number;
  private readonly staleThresholdMs: number;

  // Track last anchor FV per market for drift clamping in onFill
  private anchorCache = new Map<string, number>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private markets = new Map<string, MarketFVState>();

  constructor(options: FlowWeightedFairValueOptions = {}) {
    this.anchorProvider = options.anchorProvider;
    this.fallbackCents = options.fallbackCents ?? 50;
    this.impactCents = options.impactCents ?? 0.5;
    this.decayRate = options.decayRate ?? 0.02;
    this.maxDriftCents = options.maxDriftCents ?? 30;
    this.statePath = options.statePath ?? null;
    this.targetFillCount = options.targetFillCount ?? 10;
    this.staleThresholdMs = options.staleThresholdMs ?? 60 * 60 * 1000;

    this.loadState();
  }

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    const marketId = snapshot.market.id;
    let state = this.markets.get(marketId);

    // Get anchor FV for decay target and cold start
    let anchorFV = this.fallbackCents;
    if (this.anchorProvider) {
      const anchorEstimate = await this.anchorProvider.estimate(snapshot);
      anchorFV = anchorEstimate.yesCents;
    }

    if (!state) {
      // Cold start — seed from anchor
      state = {
        yesFV: anchorFV,
        fillCount: 0,
        lastUpdated: new Date().toISOString(),
      };
      this.markets.set(marketId, state);
    }

    // Cache anchor for drift clamping in onFill
    this.anchorCache.set(marketId, anchorFV);

    // Apply decay toward anchor
    state.yesFV = state.yesFV * (1 - this.decayRate) + anchorFV * this.decayRate;

    // Clamp to max drift from anchor
    state.yesFV = clamp(
      state.yesFV,
      Math.max(1, anchorFV - this.maxDriftCents),
      Math.min(99, anchorFV + this.maxDriftCents),
    );
    state.lastUpdated = new Date().toISOString();

    // Confidence based on recent fill count
    const confidence = Math.min(1, state.fillCount / this.targetFillCount);

    return {
      yesCents: Math.round(state.yesFV),
      confidence: Math.max(0.1, confidence), // Floor at 0.1 so we always quote
    };
  }

  onFill(fill: Fill): void {
    const marketId = fill.order.marketId;
    if (!marketId) return;

    let state = this.markets.get(marketId);
    if (!state) {
      state = {
        yesFV: this.fallbackCents,
        fillCount: 0,
        lastUpdated: new Date().toISOString(),
      };
      this.markets.set(marketId, state);
    }

    // Direction: MM sell filled → someone bought → FV up
    //            MM buy filled → someone sold → FV down
    let direction = fill.order.side === "sell" ? 1 : -1;

    // Invert for NO outcome (buy NO = bearish for YES)
    if (fill.order.outcome === "no") {
      direction *= -1;
    }

    state.yesFV += direction * fill.fillSize * this.impactCents;

    // Clamp to max drift from last known anchor
    const anchor = this.anchorCache.get(marketId) ?? this.fallbackCents;
    state.yesFV = clamp(
      state.yesFV,
      Math.max(1, anchor - this.maxDriftCents),
      Math.min(99, anchor + this.maxDriftCents),
    );
    state.fillCount += 1;
    state.lastUpdated = new Date().toISOString();

    console.log(
      `[flow-fv] ${marketId.slice(0, 8)}... fill ${fill.order.side} ${fill.order.outcome} x${fill.fillSize} → FV=${state.yesFV.toFixed(1)}¢ (fills=${state.fillCount})`,
    );

    this.debouncedPersist();
  }

  private debouncedPersist(): void {
    if (this.persistTimer) return; // Already scheduled
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistState();
    }, 1000);
  }

  private loadState(): void {
    if (!this.statePath) return;

    try {
      const raw = readFileSync(this.statePath, "utf-8");
      const persisted: PersistedState = JSON.parse(raw);

      if (persisted.version !== 1) return;

      const now = Date.now();
      for (const [marketId, state] of Object.entries(persisted.markets)) {
        const age = now - new Date(state.lastUpdated).getTime();

        // Apply extra decay for stale state
        if (age > this.staleThresholdMs) {
          const extraDecayCycles = Math.floor(age / 15_000); // Assume 15s cycles
          const totalDecay = Math.pow(1 - this.decayRate, extraDecayCycles);
          state.yesFV = state.yesFV * totalDecay + this.fallbackCents * (1 - totalDecay);
          state.yesFV = clamp(state.yesFV, 1, 99);
          console.log(
            `[flow-fv] Loaded stale state for ${marketId.slice(0, 8)}... (age=${Math.round(age / 60_000)}min, decayed FV=${state.yesFV.toFixed(1)}¢)`,
          );
        } else {
          console.log(
            `[flow-fv] Loaded state for ${marketId.slice(0, 8)}... FV=${state.yesFV.toFixed(1)}¢ (fills=${state.fillCount})`,
          );
        }

        this.markets.set(marketId, state);
      }
    } catch {
      // No file or invalid — start fresh
    }
  }

  private persistState(): void {
    if (!this.statePath) return;

    const persisted: PersistedState = {
      version: 1,
      markets: Object.fromEntries(this.markets),
    };

    writeFile(this.statePath, JSON.stringify(persisted, null, 2), (err) => {
      if (err) console.error(`[flow-fv] Failed to persist state: ${err}`);
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
