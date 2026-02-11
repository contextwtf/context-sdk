// Team coordination
export { TeamBoard } from "./board.js";
export type {
  TeamBoardState,
  AgentRole,
  Signal,
  SignalPriority,
  SignalType,
  SignalListener,
  HaltState,
  RiskMetrics,
  FairValueRecord,
  AgentStatus,
} from "./board.js";

export { TeamRuntime } from "./runtime.js";
export type { TeamRuntimeOptions } from "./runtime.js";

export { BaseTeamAgent } from "./agent.js";
export type {
  TeamAgent,
  TeamAgentContext,
  TeamAgentResult,
  WalletAccess,
  BaseTeamAgentOptions,
} from "./agent.js";

export type { ChatBridge } from "./chat-bridge.js";
export { ConsoleChatBridge } from "./chat-bridge.js";

export { createTeamIntelligence, createPortfolioRisk } from "./enrichments.js";

export { SharedDataCache } from "./data-cache.js";
export type { MarketSnapshot as CachedMarketSnapshot, SharedDataCacheOptions } from "./data-cache.js";

// ─── Team v2 ───

// Types
export type {
  TeamEvent,
  QueuedEvent,
  EventPriority,
  MarketState,
  MarketStatus,
  MarketTier,
  QuoteState,
  RiskLimits,
  InvariantResult,
  InvariantSeverity,
  Quote,
  RiskDecision,
  FastPathAction,
  FastPathTier,
  FastPathConfig,
  ScannerDispatch,
  ScannerResult,
  ScannerFinding,
  ChiefDirective,
  MarketSnapshotV2,
  RuntimeV2Config,
  LlmConfig,
  EventListener,
} from "./types-v2.js";
export { DEFAULT_RISK_LIMITS, DEFAULT_FAST_PATH_CONFIG, DEFAULT_LLM_CONFIG } from "./types-v2.js";

// Pure functions
export { computeQuotes, buildPricerParams } from "./pricer-fn.js";
export type { PricerParams } from "./pricer-fn.js";
export { riskCheck, validateSpread, riskCheckAll } from "./risk-middleware.js";
export type { RiskState } from "./risk-middleware.js";
export { runInvariants, getViolations, hasCriticalViolation } from "./invariants.js";
export type { InvariantState } from "./invariants.js";

// State + Queue
export { OrderBookState } from "./order-book-state.js";
export { EventQueue, getCoalesceKey, getEventPriority } from "./event-queue.js";

// Fast Path
export { FastPath } from "./fast-path.js";

// Intelligence
export { dispatchScanner } from "./scanner-worker.js";
export type { MarketContext } from "./scanner-worker.js";
export { ChiefGateway } from "./chief-gateway.js";

// Integration
export { ReconciliationLoop } from "./reconciliation.js";
export { RuntimeV2 } from "./runtime-v2.js";
export type { RuntimeV2Options } from "./runtime-v2.js";
