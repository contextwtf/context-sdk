/**
 * TeamAgent — Interface for agents in the MM team.
 *
 * Each team agent wraps an LlmStrategy (or rule-based logic) and adapts it
 * to the team coordination model: reading from the shared board, writing
 * signals, and respecting halt states.
 */

import type { Action } from "../strategy.js";
import type { TeamBoard, AgentRole, Signal } from "./board.js";
import type { ContextClient, ContextTrader } from "@context-markets/sdk";
import type { SharedDataCache } from "./data-cache.js";

// ─── Types ───

export interface TeamAgentContext {
  client: ContextClient;
  trader: ContextTrader | null;
  dryRun: boolean;
  /** Shared data cache — agents should prefer this over direct API calls. */
  dataCache?: SharedDataCache | null;
}

export interface TeamAgentResult {
  /** Trading actions (only from pricer + closer) */
  actions?: Action[];
  /** New signals to post to the board */
  signals?: Omit<Signal, "id" | "timestamp">[];
  /** Messages to post to the chat channel */
  chatMessages?: { content: string; priority: string }[];
}

export type WalletAccess = "full" | "cancel-only" | "none";

// ─── TeamAgent Interface ───

export interface TeamAgent {
  /** Agent's team role. */
  role: AgentRole;
  /** Human-readable display name. */
  displayName: string;
  /** Emoji prefix for chat messages. */
  emoji: string;
  /** Cycle interval in ms. */
  cycleMs: number;
  /** What wallet operations this agent can perform. */
  walletAccess: WalletAccess;

  /**
   * Core cycle — receives the shared board and runtime context, returns actions + signals.
   * The TeamRuntime calls this on each interval tick.
   */
  run(board: TeamBoard, context: TeamAgentContext): Promise<TeamAgentResult | null>;

  /** Called on graceful shutdown. Optional. */
  onShutdown?(): Promise<void>;
}

// ─── Base Implementation ───

export interface BaseTeamAgentOptions {
  role: AgentRole;
  displayName: string;
  emoji: string;
  cycleMs: number;
  walletAccess: WalletAccess;
}

/**
 * BaseTeamAgent — provides common functionality for team agents.
 * Subclass and implement `cycle()` with agent-specific logic.
 */
export abstract class BaseTeamAgent implements TeamAgent {
  readonly role: AgentRole;
  readonly displayName: string;
  readonly emoji: string;
  readonly cycleMs: number;
  readonly walletAccess: WalletAccess;

  constructor(options: BaseTeamAgentOptions) {
    this.role = options.role;
    this.displayName = options.displayName;
    this.emoji = options.emoji;
    this.cycleMs = options.cycleMs;
    this.walletAccess = options.walletAccess;
  }

  async run(board: TeamBoard, context: TeamAgentContext): Promise<TeamAgentResult | null> {
    // 1. Read inbox messages (process before cycle logic)
    const messages = board.readInbox(this.role);
    const humanMessages = messages.filter((m) => m.type === "human");
    const agentMessages = messages.filter((m) => m.type !== "human");

    // 2. Run agent-specific cycle logic
    return this.cycle(board, context, { humanMessages, agentMessages });
  }

  /** Implement this with agent-specific logic. */
  protected abstract cycle(
    board: TeamBoard,
    context: TeamAgentContext,
    inbox: { humanMessages: Signal[]; agentMessages: Signal[] },
  ): Promise<TeamAgentResult | null>;

  async onShutdown(): Promise<void> {
    // Override in subclass if needed
  }
}
