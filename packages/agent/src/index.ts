// Runtime
export { AgentRuntime, type AgentRuntimeOptions } from "./runtime.js";

// Strategy interface & types
export type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
  PlaceOrderAction,
  CancelOrderAction,
  CancelReplaceAction,
  NoAction,
} from "./strategy.js";

// Fair value
export type { FairValueEstimate, FairValueProvider } from "./fair-value.js";
export {
  FairValueService,
  type FairValueServiceOptions,
} from "./fair-value-service.js";
export {
  StaticFairValue,
  OracleFairValue,
  MidpointFairValue,
  ChainedFairValue,
  FlowWeightedFairValue,
  type FlowWeightedFairValueOptions,
  LlmFairValue,
  type LlmFairValueOptions,
  ResolutionFairValue,
  SentimentFairValue,
  type SentimentFairValueOptions,
  VegasFairValue,
  type VegasFairValueResult,
  type GameState,
  GeminiFairValue,
  type GeminiFairValueOptions,
} from "./providers/index.js";

// Risk
export { RiskManager, type RiskLimits, type RiskCheckResult } from "./risk.js";

// Logger
export { TradeLogger, type LogEntry } from "./logger.js";

// Built-in strategies
export {
  OracleTrackerStrategy,
  type OracleTrackerOptions,
} from "./strategies/oracle-tracker.js";
export {
  SimpleMmStrategy,
  type SimpleMmOptions,
} from "./strategies/simple-mm.js";
export {
  AdaptiveMmStrategy,
  type AdaptiveMmOptions,
} from "./strategies/adaptive-mm.js";
export {
  EdgeTradingStrategy,
  type EdgeTradingOptions,
} from "./strategies/edge-trading.js";
export {
  ResolutionSniperStrategy,
  type ResolutionSniperOptions,
} from "./strategies/resolution-sniper.js";
export {
  MeanReversionStrategy,
  type MeanReversionOptions,
} from "./strategies/mean-reversion.js";
export {
  SportsMmStrategy,
  type SportsMmOptions,
} from "./strategies/sports-mm.js";
export {
  FavoritesDipStrategy,
  type FavoritesDipOptions,
} from "./strategies/favorites-dip.js";

// LLM-powered strategy
export {
  LlmStrategy,
  type LlmStrategyOptions,
} from "./strategies/llm-strategy.js";

// LLM building blocks
export {
  type LlmClient,
  type LlmTool,
  type ContextEnrichment,
  type ChatMessage,
  type ToolDefinition,
  webSearchTool,
  espnDataTool,
  vegasOddsTool,
  readMemoryTool,
  writeMemoryTool,
  builtinTools,
  oracleEvolution,
  orderbookDiff,
  priceMomentum,
  volumeProfile,
  AgentMemory,
  type MemoryOptions,
  CostController,
  type CostControlOptions,
  createLlmClient,
} from "./llm/index.js";

// Signals (sports data enrichment)
export * as espn from "./signals/espn.js";
export * as vegas from "./signals/vegas.js";
export { extractLeagueFromQuestion } from "./signals/espn.js";
