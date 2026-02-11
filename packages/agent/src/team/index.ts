// Team coordination
export { TeamBoard } from "./board.js";
export type {
  TeamBoardState,
  AgentRole,
  Signal,
  SignalPriority,
  SignalType,
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
