/**
 * types-v2.ts — Shared types for the event-driven MM team v2.
 *
 * No logic, just interfaces. Every v2 module imports from here.
 */

// ─── Events ───

export type TeamEvent =
  | { type: "data_refresh"; snapshots: MarketSnapshotV2[] }
  | { type: "human_message"; content: string; from: string }
  | { type: "scanner_result"; taskId: string; findings: ScannerFinding[] }
  | { type: "tick"; timestamp: number }
  | { type: "fill"; orderId: string; marketId: string; side: "buy" | "sell"; outcome: "yes" | "no"; priceCents: number; size: number }
  | { type: "oracle_change"; marketId: string; newConfidence: number; previousConfidence: number }
  | { type: "invariant_violation"; rule: string; severity: InvariantSeverity; details: string; marketId?: string }
  | { type: "reprice_needed"; marketId: string; reason: string; urgent: boolean }
  | { type: "new_market"; marketId: string; name: string };

export interface QueuedEvent {
  event: TeamEvent;
  priority: EventPriority;
  arrivedAt: number;
  coalesceKey?: string;
}

/**
 * P0: Capital protection (invariant violations, risk breaches, fills on provisional)
 * P1: Information (scanner results, oracle changes, reprice_needed, data_refresh)
 * P2: Human interaction
 * P3: Exploration (new markets, heartbeat tick)
 */
export type EventPriority = 0 | 1 | 2 | 3;

// ─── Market State ───

export type MarketStatus =
  | "quoting"        // normal operation, quoted at FV
  | "provisional"    // fast path adjusted, waiting for Chief to confirm FV
  | "provisional_urgent" // large move, very wide quotes, needs immediate Chief attention
  | "closing"        // oracle high confidence, winding down position
  | "dark"           // no quotes (capital exhaustion, halted, etc.)
  | "resolved";      // market resolved, no further action

export type MarketTier = 1 | 2 | 3;

export interface MarketState {
  id: string;
  name: string;
  resolutionCriteria: string;
  tier: MarketTier;
  category: string;

  // Fair value
  fairValue: number;           // cents (1-99)
  fairValueConfidence: number; // 0-1
  fairValueSource: string;     // "chief" | "fast_path" | "initial"
  fairValueSetAt: number;      // timestamp

  // Status
  status: MarketStatus;

  // Our quotes
  ourBid: QuoteState | null;
  ourAsk: QuoteState | null;

  // Position
  position: { yes: number; no: number; costBasis: number };

  // External data
  orderbook: { bestBid: number; bestAsk: number; midpoint: number };
  oracleConfidence: number;
  volatilityEstimate: number;

  // Timestamps
  quotedAt: number;  // when we last placed/updated quotes
}

export interface QuoteState {
  price: number;
  size: number;
  orderId?: string;
  nonce?: string;
}

// ─── Risk ───

export interface RiskLimits {
  maxPositionPerMarket: number;  // max contracts per market
  maxTotalExposure: number;      // fraction of balance (0-1)
  maxCapitalUtilization: number; // fraction of balance (0-1)
  maxLossPerMarket: number;      // dollars
  maxDailyLoss: number;          // dollars
  minSpread: number;             // cents
  maxSpread: number;             // cents
  minSize: number;               // contracts
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionPerMarket: 500,
  maxTotalExposure: 0.80,
  maxCapitalUtilization: 0.80,
  maxLossPerMarket: 50,
  maxDailyLoss: 100,
  minSpread: 2,
  maxSpread: 30,
  minSize: 5,
};

// ─── Invariants ───

export type InvariantSeverity = "critical" | "warning" | "info";

export interface InvariantResult {
  rule: string;
  passed: boolean;
  severity: InvariantSeverity;
  details?: string;
  marketId?: string;
}

// ─── Quotes ───

export interface Quote {
  side: "buy" | "sell";
  outcome: "yes" | "no";
  priceCents: number;
  size: number;
}

// ─── Risk Decisions ───

export interface RiskDecision {
  allow: boolean;
  reason?: string;
  suggested?: { priceCents?: number; size?: number };
}

// ─── Fast Path ───

export type FastPathAction =
  | { type: "cancel_replace"; marketId: string; quotes: Quote[] }
  | { type: "no_action"; marketId: string; reason: string };

export type FastPathTier = 1 | 2 | 3 | 4;

// ─── Scanner ───

export interface ScannerDispatch {
  taskId: string;
  markets: string[];
  focus: string;
  tools: string[];
  maxToolCalls: number;
  timeout: number;
}

export interface ScannerResult {
  taskId: string;
  findings: ScannerFinding[];
  toolCallsUsed: number;
  durationMs: number;
}

export interface ScannerFinding {
  marketId: string;
  type: "score_update" | "correction" | "verification" | "news" | "data_release";
  data: Record<string, unknown>;
  confidence: number; // 0-1
  source: string;
  suggestedFairValue?: number;
}

// ─── Chief Directives ───

export type ChiefDirective =
  | { type: "set_fair_value"; marketId: string; fairValue: number; confidence: number; reasoning: string }
  | { type: "dispatch_scanner"; dispatch: ScannerDispatch }
  | { type: "respond_human"; message: string }
  | { type: "halt_market"; marketId: string; reason: string }
  | { type: "close_market"; marketId: string; direction: "yes" | "no"; confidence: number };

// ─── Market Snapshot (from SharedDataCache) ───

export interface MarketSnapshotV2 {
  market: Record<string, unknown>;
  orderbook: { bids: Array<{ price: number; size: number }>; asks: Array<{ price: number; size: number }> };
  oracleSignals: Array<{ confidence?: number; [key: string]: unknown }>;
  fetchedAt: number;
}

// ─── Event Listener ───

export type EventListener = (event: TeamEvent) => void;

// ─── Config ───

export interface RuntimeV2Config {
  dryRun: boolean;
  riskLimits: RiskLimits;
  cachePollIntervalMs: number;
  reconcileIntervalMs: number;
  heartbeatIntervalMs: number;
  fastPathConfig: FastPathConfig;
  llmConfig: LlmConfig;
}

export interface FastPathConfig {
  tier1Threshold: number;   // cents — below this, no action (default: 2)
  tier2Threshold: number;   // cents — mechanical reprice (default: 8)
  tier3Threshold: number;   // cents — provisional, spread×2 (default: 20)
  // above tier3Threshold → tier 4: provisional_urgent, spread×4
  skewFactor: number;       // inventory skew multiplier (default: 0.5)
  minSize: number;          // minimum quote size (default: 5)
  defaultMaxSize: number;   // default max quote size (default: 100)
}

export const DEFAULT_FAST_PATH_CONFIG: FastPathConfig = {
  tier1Threshold: 2,
  tier2Threshold: 8,
  tier3Threshold: 20,
  skewFactor: 0.5,
  minSize: 5,
  defaultMaxSize: 100,
};

export interface LlmConfig {
  routineModel: string;      // default: "kimi-k2.5"
  escalationModel: string;   // default: "claude-sonnet-4-5-20250929"
  maxToolCallsPerCycle: number;
  dailyBudgetCents: number;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  routineModel: "kimi-k2.5",
  escalationModel: "claude-sonnet-4-5-20250929",
  maxToolCallsPerCycle: 4,
  dailyBudgetCents: 300,
};
