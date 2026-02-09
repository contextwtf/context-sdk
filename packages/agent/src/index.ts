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
