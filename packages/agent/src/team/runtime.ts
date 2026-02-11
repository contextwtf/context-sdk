/**
 * TeamRuntime — Orchestrates 5 agents on independent timers with a shared board.
 *
 * Key design decisions:
 * - Single Node.js process, shared in-memory TeamBoard
 * - Each agent gets its own setInterval loop
 * - Risk Sentinel has a process-level watchdog (TeamRuntime monitors it directly)
 * - Pre-execution halt gate: checked before EVERY order, not just at cycle start
 * - 3 consecutive errors → agent stopped + human alert
 */

import type { Hex } from "viem";
import { ContextClient, ContextTrader, type ContextTraderOptions } from "@context-markets/sdk";
import {
  TeamBoard,
  type AgentRole,
  type Signal,
} from "./board.js";
import type { TeamAgent, TeamAgentResult } from "./agent.js";
import type { ChatBridge } from "./chat-bridge.js";

// ─── Types ───

export interface TeamRuntimeOptions {
  /** Trader credentials — shared wallet for all agents. */
  trader?: ContextTraderOptions;
  /** The 5 team agents. */
  agents: Record<AgentRole, TeamAgent>;
  /** Chat bridge for Telegram / Discord. Optional for headless mode. */
  chatBridge?: ChatBridge;
  /** If true, agents evaluate but never execute orders. Default: false. */
  dryRun?: boolean;
  /** Max consecutive errors before stopping an agent. Default: 3. */
  maxConsecutiveErrors?: number;
  /** Risk Sentinel staleness threshold (ms). Default: 30000. */
  riskWatchdogThresholdMs?: number;
}

// ─── TeamRuntime ───

export class TeamRuntime {
  readonly board: TeamBoard;
  private readonly client: ContextClient;
  private readonly trader: ContextTrader | null;
  private readonly agents: Record<AgentRole, TeamAgent>;
  private readonly chatBridge?: ChatBridge;
  private readonly dryRun: boolean;
  private readonly maxConsecutiveErrors: number;
  private readonly riskWatchdogThresholdMs: number;

  private running = false;
  private intervals = new Map<AgentRole, ReturnType<typeof setInterval>>();
  private riskWatchdog: ReturnType<typeof setInterval> | null = null;

  constructor(options: TeamRuntimeOptions) {
    this.board = new TeamBoard();

    if (options.trader) {
      this.trader = new ContextTrader(options.trader);
      this.client = this.trader;
    } else {
      this.trader = null;
      this.client = new ContextClient();
    }

    this.agents = options.agents;
    this.chatBridge = options.chatBridge;
    this.dryRun = options.dryRun ?? false;
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? 3;
    this.riskWatchdogThresholdMs = options.riskWatchdogThresholdMs ?? 30_000;
  }

  // ─── Lifecycle ───

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[team] Starting MM team (dryRun=${this.dryRun})`);
    console.log(`[team] Agents: ${Object.keys(this.agents).join(", ")}`);

    // Register shutdown handlers
    const onSignal = () => this.stop();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    // Start each agent on its own timer
    for (const [role, agent] of Object.entries(this.agents) as [AgentRole, TeamAgent][]) {
      this.startAgent(role, agent);
    }

    // Start Risk Sentinel watchdog — monitors the monitor
    this.startRiskWatchdog();

    // Start signal pruning (every 60s)
    this.intervals.set("chief" as AgentRole, setInterval(() => {
      this.board.pruneSignals(300_000);
    }, 60_000));

    // Announce to chat
    if (this.chatBridge) {
      await this.chatBridge.send("📊 Chief", "Team online. All agents starting cycles.");
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    console.log("[team] Stop requested — shutting down all agents");

    // Clear all intervals
    for (const [role, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();

    if (this.riskWatchdog) {
      clearInterval(this.riskWatchdog);
      this.riskWatchdog = null;
    }

    // Cancel all open orders on shutdown
    if (this.trader && !this.dryRun) {
      try {
        const orders = await this.trader.getAllMyOrders();
        const openOrders = (Array.isArray(orders) ? orders : (orders as any).orders ?? [])
          .filter((o: any) => !o.status || o.status === "open");

        if (openOrders.length > 0) {
          console.log(`[team] Cancelling ${openOrders.length} open orders...`);
          const nonces = openOrders.map((o: any) => o.nonce);
          const BATCH_SIZE = 20;
          for (let i = 0; i < nonces.length; i += BATCH_SIZE) {
            const batch = nonces.slice(i, i + BATCH_SIZE);
            await this.trader.bulkCancelOrders(batch);
          }
        }
      } catch (err) {
        console.error("[team] Error cancelling orders on shutdown:", err);
      }
    }

    // Notify agents
    for (const agent of Object.values(this.agents)) {
      if (agent.onShutdown) {
        await agent.onShutdown().catch((err: unknown) =>
          console.error(`[team] Agent ${agent.role} shutdown error:`, err),
        );
      }
    }

    if (this.chatBridge) {
      await this.chatBridge.send("📊 Chief", "Team offline. All agents stopped.").catch(() => {});
    }

    console.log("[team] Shutdown complete");
  }

  // ─── Agent Loop ───

  private startAgent(role: AgentRole, agent: TeamAgent): void {
    const cycleMs = agent.cycleMs;

    console.log(`[team] Starting ${role} (cycle: ${cycleMs / 1000}s)`);
    this.board.updateAgentStatus(role, { status: "running", lastCycle: Date.now() });

    // Run first cycle immediately
    this.runAgentCycle(role, agent);

    // Then on interval
    const interval = setInterval(() => {
      if (!this.running) return;
      this.runAgentCycle(role, agent);
    }, cycleMs);

    this.intervals.set(role, interval);
  }

  private async runAgentCycle(role: AgentRole, agent: TeamAgent): Promise<void> {
    // Pre-execution halt gate — skip if globally halted (Risk Sentinel always runs)
    if (this.board.isHalted() && role !== "risk") {
      return;
    }

    try {
      const result = await agent.run(this.board, {
        client: this.client,
        trader: this.trader,
        dryRun: this.dryRun,
      });

      // Process results
      if (result) {
        await this.processResult(role, result);
      }

      // Mark cycle complete
      this.board.markCycleComplete(role);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[team] ${role} cycle error:`, errorMsg);
      this.board.markCycleError(role, errorMsg);

      // Check consecutive errors
      const status = this.board.state.agentStatus[role];
      if (status.consecutiveErrors >= this.maxConsecutiveErrors) {
        await this.handleAgentFailure(role, `${this.maxConsecutiveErrors} consecutive errors: ${errorMsg}`);
      }
    }
  }

  private async processResult(role: AgentRole, result: TeamAgentResult): Promise<void> {
    // Add signals to the board
    if (result.signals) {
      for (const signal of result.signals) {
        this.board.addSignal(signal);
      }
    }

    // Execute trading actions (only Pricer and Closer)
    if (result.actions && this.trader && !this.dryRun) {
      for (const action of result.actions) {
        // Per-order halt gate — check before EVERY order, not just at cycle start
        if (action.type === "place_order" || action.type === "cancel_replace") {
          if (this.board.isHalted(action.marketId)) {
            console.log(`[team] HALTED: skipping ${action.type} on ${action.marketId.slice(0, 8)}`);
            continue;
          }
        }

        try {
          switch (action.type) {
            case "place_order":
              await this.trader.placeOrder({
                marketId: action.marketId,
                outcome: action.outcome,
                side: action.side,
                priceCents: action.priceCents,
                size: action.size,
              });
              break;
            case "cancel_order":
              await this.trader.cancelOrder(action.nonce as Hex);
              break;
            case "cancel_replace":
              await this.trader.cancelReplace(action.cancelNonce as Hex, {
                marketId: action.marketId,
                outcome: action.outcome,
                side: action.side,
                priceCents: action.priceCents,
                size: action.size,
              });
              break;
          }
        } catch (err) {
          console.error(`[team] ${role} execution error:`, err instanceof Error ? err.message : err);
        }
      }
    } else if (result.actions && this.dryRun) {
      const tradeActions = result.actions.filter((a) => a.type !== "no_action");
      if (tradeActions.length > 0) {
        console.log(`[team] DRY RUN ${role}: would execute ${tradeActions.length} actions`);
      }
    }

    // Post chat messages
    if (result.chatMessages && this.chatBridge) {
      for (const msg of result.chatMessages) {
        const agent = this.agents[role as AgentRole];
        const prefix = `${agent.emoji} ${agent.displayName}`;
        await this.chatBridge.send(prefix, msg.content).catch((err: unknown) =>
          console.error(`[team] Chat error:`, err),
        );
      }
    }
  }

  // ─── Failure Handling ───

  private async handleAgentFailure(role: AgentRole, reason: string): Promise<void> {
    console.error(`[team] AGENT FAILURE: ${role} — ${reason}`);

    // Stop the failed agent
    const interval = this.intervals.get(role);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(role);
    }
    this.board.updateAgentStatus(role, { status: "stopped" });

    // Severity-based response
    if (role === "risk") {
      // Critical: Risk Sentinel down → global halt
      await this.emergencyHalt(`Risk Sentinel failed: ${reason}`);
    } else if (role === "pricer") {
      // Critical: No one placing orders → cancel all + halt trading
      await this.emergencyHalt(`Pricer failed: ${reason}`);
    } else {
      // Scanner/Closer/Chief down → degraded but continue
      console.warn(`[team] ${role} is down — team continues in degraded mode`);
    }

    // Alert human
    if (this.chatBridge) {
      const severity = role === "risk" || role === "pricer" ? "🚨" : "⚠️";
      await this.chatBridge.alert(
        `${severity} AGENT DOWN: ${role} — ${reason}. ${role === "risk" || role === "pricer" ? "GLOBAL HALT triggered." : "Team continues in degraded mode."}`
      );
    }
  }

  private async emergencyHalt(reason: string): Promise<void> {
    console.error(`[team] 🚨 EMERGENCY HALT: ${reason}`);

    // 1. Set halt flag (instant)
    this.board.setHalt(true, reason, "runtime");

    // 2. Cancel all existing orders
    if (this.trader && !this.dryRun) {
      try {
        const orders = await this.trader.getAllMyOrders();
        const openOrders = (Array.isArray(orders) ? orders : (orders as any).orders ?? [])
          .filter((o: any) => !o.status || o.status === "open");

        if (openOrders.length > 0) {
          const nonces = openOrders.map((o: any) => o.nonce);
          const BATCH_SIZE = 20;
          for (let i = 0; i < nonces.length; i += BATCH_SIZE) {
            const batch = nonces.slice(i, i + BATCH_SIZE);
            await this.trader.bulkCancelOrders(batch);
          }
          console.log(`[team] Cancelled ${openOrders.length} orders`);
        }
      } catch (err) {
        console.error("[team] Error cancelling orders during halt:", err);
      }
    }

    // 3. Alert team
    this.board.addSignal({
      source: "risk",
      priority: "halt",
      type: "risk",
      marketIds: [],
      payload: `🚨 EMERGENCY HALT: ${reason}. All orders cancelled.`,
    });
  }

  // ─── Risk Sentinel Watchdog ───

  private startRiskWatchdog(): void {
    // Grace period: don't check until Risk Sentinel has completed at least one cycle
    const startTime = Date.now();
    const gracePeriodMs = 60_000; // 60s grace for startup (API calls, first LLM evals)

    // Check every 10s if Risk Sentinel is alive
    this.riskWatchdog = setInterval(() => {
      if (!this.running) return;

      // Skip during startup grace period
      if (Date.now() - startTime < gracePeriodMs) return;

      const riskStatus = this.board.state.agentStatus.risk;
      // Only check if Risk Sentinel has completed at least one cycle
      if (riskStatus.cycleCount === 0) return;

      const staleness = Date.now() - riskStatus.lastCycle;

      if (staleness > this.riskWatchdogThresholdMs) {
        console.error(`[team] Risk Sentinel stale for ${Math.round(staleness / 1000)}s — triggering emergency halt`);
        this.emergencyHalt(`Risk Sentinel unresponsive for ${Math.round(staleness / 1000)}s`);
      }
    }, 10_000);
  }

  // ─── Human Message Handling ───

  /** Route a human message to the appropriate agent. */
  routeHumanMessage(content: string, mentionedAgent?: AgentRole): void {
    const signal: Omit<Signal, "id" | "timestamp" | "source"> = {
      priority: "urgent",
      type: "human",
      marketIds: [],
      payload: content,
    };

    // Check for emergency keywords
    const lower = content.toLowerCase();
    if (lower.includes("halt") || lower.includes("stop") || lower.includes("emergency")) {
      this.board.setHalt(true, `Human: ${content}`, "human");
      if (this.chatBridge) {
        this.chatBridge.send("📊 Chief", "Human triggered halt. All trading stopped.").catch(() => {});
      }
      return;
    }

    if (lower.includes("resume") || lower.includes("clear halt")) {
      this.board.clearHalt();
      if (this.chatBridge) {
        this.chatBridge.send("📊 Chief", "Halt cleared. Resuming trading.").catch(() => {});
      }
      return;
    }

    // Route to mentioned agent or Chief by default
    const target = mentionedAgent ?? "chief";
    this.board.postMessage("human", target, signal);
  }
}
