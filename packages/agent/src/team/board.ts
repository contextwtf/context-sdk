/**
 * TeamBoard — Shared in-memory state for the MM team.
 *
 * All 5 agents read/write to this board. Because all agents run in a single
 * Node.js process, writes are instantly visible (no serialization, no locks).
 *
 * The board replaces file-based message passing — it IS the blackboard.
 */

// ─── Core Types ───

export type AgentRole = "chief" | "scanner" | "pricer" | "risk" | "closer";
export type SignalPriority = "halt" | "override" | "urgent" | "alert" | "info";
export type SignalType = "news" | "score" | "oracle" | "price" | "risk" | "directive" | "human";

export interface Signal {
  id: string;
  source: AgentRole | "human";
  priority: SignalPriority;
  type: SignalType;
  marketIds: string[];
  payload: string;
  data?: Record<string, unknown>;
  timestamp: number;
  expiresAt?: number;
}

export interface HaltState {
  global: boolean;
  markets: Set<string>;
  spreadOverrides: Map<string, number>;
  reason: string;
  since: number;
  setBy: string;
}

export interface RiskMetrics {
  totalExposure: number;
  worstCaseLoss: number;
  capitalUtilization: number;
  sessionPnL: number;
  activeCircuitBreakers: string[];
}

export interface FairValueRecord {
  yesCents: number;
  confidence: number;
  updatedAt: number;
  source?: string;
}

export interface AgentStatus {
  lastCycle: number;
  status: "running" | "idle" | "error" | "stopped";
  error?: string;
  consecutiveErrors: number;
  cycleCount: number;
}

// ─── Board Interface ───

export interface TeamBoardState {
  /** Intelligence signals (Scanner writes, Pricer reads) */
  signals: Signal[];

  /** Risk state (Risk Sentinel writes, everyone reads) */
  halt: HaltState;
  riskMetrics: RiskMetrics;

  /** Market assignments — which agent owns which market (Chief writes, Pricer + Closer read) */
  marketAssignments: Record<string, "pricer" | "closer">;

  /** Fair values (Pricer writes, Closer + Chief read) */
  fairValues: Record<string, FairValueRecord>;

  /** Active directives from Chief */
  directives: Signal[];

  /** Per-agent status (each agent writes its own) */
  agentStatus: Record<AgentRole, AgentStatus>;

  /** Message inboxes (any agent writes to any other's inbox) */
  inboxes: Record<AgentRole, Signal[]>;

  /** Human messages pending processing */
  humanMessages: Signal[];
}

// ─── TeamBoard Class ───

export class TeamBoard {
  readonly state: TeamBoardState;

  constructor() {
    const defaultStatus = (): AgentStatus => ({
      lastCycle: 0,
      status: "idle",
      consecutiveErrors: 0,
      cycleCount: 0,
    });

    this.state = {
      signals: [],
      halt: {
        global: false,
        markets: new Set(),
        spreadOverrides: new Map(),
        reason: "",
        since: 0,
        setBy: "",
      },
      riskMetrics: {
        totalExposure: 0,
        worstCaseLoss: 0,
        capitalUtilization: 0,
        sessionPnL: 0,
        activeCircuitBreakers: [],
      },
      marketAssignments: {},
      fairValues: {},
      directives: [],
      agentStatus: {
        chief: defaultStatus(),
        scanner: defaultStatus(),
        pricer: defaultStatus(),
        risk: defaultStatus(),
        closer: defaultStatus(),
      },
      inboxes: {
        chief: [],
        scanner: [],
        pricer: [],
        risk: [],
        closer: [],
      },
      humanMessages: [],
    };
  }

  // ─── Signal Management ───

  addSignal(signal: Omit<Signal, "id" | "timestamp">): Signal {
    const full: Signal = {
      ...signal,
      id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };
    this.state.signals.push(full);
    return full;
  }

  getRecentSignals(maxAgeMs: number = 120_000, marketId?: string): Signal[] {
    const cutoff = Date.now() - maxAgeMs;
    return this.state.signals.filter((s) => {
      if (s.timestamp < cutoff) return false;
      if (s.expiresAt && s.expiresAt < Date.now()) return false;
      if (marketId && !s.marketIds.includes(marketId)) return false;
      return true;
    });
  }

  /** Prune expired / old signals to prevent unbounded growth. */
  pruneSignals(maxAgeMs: number = 300_000): void {
    const cutoff = Date.now() - maxAgeMs;
    this.state.signals = this.state.signals.filter(
      (s) => s.timestamp >= cutoff && (!s.expiresAt || s.expiresAt >= Date.now()),
    );
    this.state.directives = this.state.directives.filter(
      (d) => d.timestamp >= cutoff,
    );
  }

  // ─── Halt Management ───

  setHalt(global: boolean, reason: string, setBy: string): void {
    this.state.halt = {
      global,
      markets: this.state.halt.markets,
      spreadOverrides: this.state.halt.spreadOverrides,
      reason,
      since: Date.now(),
      setBy,
    };
  }

  haltMarket(marketId: string, reason: string, setBy: string): void {
    this.state.halt.markets.add(marketId);
    this.state.halt.reason = reason;
    this.state.halt.setBy = setBy;
    this.state.halt.since = Date.now();
  }

  clearHalt(): void {
    this.state.halt.global = false;
    this.state.halt.markets.clear();
    this.state.halt.spreadOverrides.clear();
    this.state.halt.reason = "";
  }

  isHalted(marketId?: string): boolean {
    if (this.state.halt.global) return true;
    if (marketId && this.state.halt.markets.has(marketId)) return true;
    return false;
  }

  // ─── Inbox / Messaging ───

  postMessage(from: AgentRole | "human", to: AgentRole, signal: Omit<Signal, "id" | "timestamp" | "source">): void {
    const full: Signal = {
      ...signal,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      source: from,
      timestamp: Date.now(),
    };
    this.state.inboxes[to].push(full);
  }

  readInbox(agent: AgentRole): Signal[] {
    const messages = [...this.state.inboxes[agent]];
    this.state.inboxes[agent] = [];
    return messages;
  }

  // ─── Agent Status ───

  updateAgentStatus(agent: AgentRole, update: Partial<AgentStatus>): void {
    Object.assign(this.state.agentStatus[agent], update);
  }

  markCycleComplete(agent: AgentRole): void {
    const status = this.state.agentStatus[agent];
    status.lastCycle = Date.now();
    status.status = "running";
    status.consecutiveErrors = 0;
    status.cycleCount++;
  }

  markCycleError(agent: AgentRole, error: string): void {
    const status = this.state.agentStatus[agent];
    status.lastCycle = Date.now();
    status.status = "error";
    status.error = error;
    status.consecutiveErrors++;
  }

  // ─── Fair Values ───

  updateFairValue(marketId: string, fv: FairValueRecord): void {
    this.state.fairValues[marketId] = fv;
  }

  getFairValue(marketId: string): FairValueRecord | undefined {
    return this.state.fairValues[marketId];
  }

  // ─── Market Assignments ───

  assignMarket(marketId: string, owner: "pricer" | "closer"): void {
    this.state.marketAssignments[marketId] = owner;
  }

  getMarketOwner(marketId: string): "pricer" | "closer" {
    return this.state.marketAssignments[marketId] ?? "pricer";
  }

  // ─── Snapshot for API / Dashboard ───

  toJSON(): Record<string, unknown> {
    return {
      signals: this.state.signals.slice(-20),
      halt: {
        global: this.state.halt.global,
        markets: [...this.state.halt.markets],
        spreadOverrides: Object.fromEntries(this.state.halt.spreadOverrides),
        reason: this.state.halt.reason,
        since: this.state.halt.since,
        setBy: this.state.halt.setBy,
      },
      riskMetrics: this.state.riskMetrics,
      marketAssignments: this.state.marketAssignments,
      fairValues: this.state.fairValues,
      directives: this.state.directives.slice(-10),
      agentStatus: this.state.agentStatus,
      humanMessages: this.state.humanMessages,
    };
  }
}
