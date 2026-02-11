/**
 * TeamRuntime — Orchestrates 5 agents on independent timers with a shared board.
 *
 * Key design decisions:
 * - Single Node.js process, shared in-memory TeamBoard
 * - Each agent gets its own setInterval loop + event-driven wake-ups
 * - Risk Sentinel has a process-level watchdog (TeamRuntime monitors it directly)
 * - Pre-execution halt gate: checked before EVERY order, not just at cycle start
 * - 3 consecutive errors → agent stopped + human alert
 * - wake(role) triggers an immediate cycle; timer resets after wake to avoid double-taps
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
import { SharedDataCache } from "./data-cache.js";

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
  /** Shared data cache poll interval (ms). Default: 30000. Set 0 to disable. */
  cachePollIntervalMs?: number;
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
  readonly dataCache: SharedDataCache | null;

  private running = false;
  private intervals = new Map<AgentRole, ReturnType<typeof setInterval>>();
  private riskWatchdog: ReturnType<typeof setInterval> | null = null;
  /** Per-agent mutex — prevents concurrent cycles from wake() + timer overlap. */
  private agentRunning = new Map<AgentRole, boolean>();
  private unsubscribeSignalListener?: () => void;

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

    // Create shared data cache (unless explicitly disabled with 0)
    const cachePollMs = options.cachePollIntervalMs ?? 30_000;
    if (cachePollMs > 0) {
      this.dataCache = new SharedDataCache({
        client: this.client,
        pollIntervalMs: cachePollMs,
      });
    } else {
      this.dataCache = null;
    }
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

    // Start shared data cache (if enabled)
    if (this.dataCache) {
      this.dataCache.start();
    }

    // Wire up board event listener for automatic wake-ups
    this.setupBoardEventListener();

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
      await this.chatBridge.send("chief", "📊 Chief", "Team online. All agents starting cycles.");
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    console.log("[team] Stop requested — shutting down all agents");

    // Unsubscribe board event listener
    if (this.unsubscribeSignalListener) {
      this.unsubscribeSignalListener();
      this.unsubscribeSignalListener = undefined;
    }

    // Clear all intervals
    for (const [role, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();

    if (this.riskWatchdog) {
      clearInterval(this.riskWatchdog);
      this.riskWatchdog = null;
    }

    // Stop shared data cache
    if (this.dataCache) {
      this.dataCache.stop();
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
      await this.chatBridge.send("chief", "📊 Chief", "Team offline. All agents stopped.").catch(() => {});
    }

    console.log("[team] Shutdown complete");
  }

  // ─── Event-Driven Wake-ups ───

  /**
   * Trigger an immediate cycle for the specified agent.
   * Safe to call concurrently — uses a per-agent mutex to prevent overlapping cycles.
   * Resets the agent's timer so you don't get a timer cycle shortly after a wake.
   */
  wake(role: AgentRole): void {
    if (!this.running) return;

    const agent = this.agents[role];
    if (!agent) return;

    // Check if agent is stopped
    const status = this.board.state.agentStatus[role];
    if (status.status === "stopped") return;

    // Skip if a cycle is already running for this agent
    if (this.agentRunning.get(role)) {
      console.log(`[team] wake(${role}) skipped — cycle already in progress`);
      return;
    }

    console.log(`[team] wake(${role}) — triggering immediate cycle`);

    // Run the cycle immediately
    this.runAgentCycle(role, agent);

    // Reset the timer so we don't get a double-tap
    this.resetTimer(role, agent);
  }

  /** Reset an agent's interval timer (called after wake to avoid double-tap). */
  private resetTimer(role: AgentRole, agent: TeamAgent): void {
    const existing = this.intervals.get(role);
    if (existing) {
      clearInterval(existing);
    }

    const interval = setInterval(() => {
      if (!this.running) return;
      this.runAgentCycle(role, agent);
    }, agent.cycleMs);

    this.intervals.set(role, interval);
  }

  /** Wire up board.onSignal to automatically wake agents based on signal routing. */
  private setupBoardEventListener(): void {
    this.unsubscribeSignalListener = this.board.onSignal((signal, target) => {
      // If the signal was posted to a specific agent's inbox, wake that agent
      if (target) {
        this.wake(target);
        return;
      }

      // For broadcast signals (addSignal, not postMessage), route by content:
      // - "halt" priority → always wake risk
      if (signal.priority === "halt") {
        this.wake("risk");
      }

      // - Scanner urgent news → wake pricer
      if (signal.source === "scanner" && signal.priority === "urgent") {
        this.wake("pricer");
      }

      // - Human signal type → wake chief
      if (signal.type === "human") {
        this.wake("chief");
      }

      // - Risk signal → wake pricer (to adjust quotes)
      if (signal.source === "risk" && signal.priority === "urgent") {
        this.wake("pricer");
      }
    });
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
    // Per-agent mutex — skip if already running (wake + timer overlap)
    if (this.agentRunning.get(role)) {
      return;
    }

    // Pre-execution halt gate — skip if globally halted (Risk Sentinel always runs)
    if (this.board.isHalted() && role !== "risk") {
      return;
    }

    this.agentRunning.set(role, true);

    try {
      const result = await agent.run(this.board, {
        client: this.client,
        trader: this.trader,
        dryRun: this.dryRun,
        dataCache: this.dataCache,
      });

      // Process results
      if (result) {
        await this.processResult(role, result);
      } else {
        console.log(`[team] ${role} returned null`);
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
    } finally {
      this.agentRunning.set(role, false);
    }
  }

  private async processResult(role: AgentRole, result: TeamAgentResult): Promise<void> {
    // Debug: log what we received
    const chatCount = result.chatMessages?.length ?? 0;
    const sigCount = result.signals?.length ?? 0;
    const actCount = result.actions?.length ?? 0;
    if (chatCount > 0 || sigCount > 0 || actCount > 0) {
      console.log(`[team] ${role} result: ${actCount} actions, ${sigCount} signals, ${chatCount} chatMessages`);
    }

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
    if (result.chatMessages && result.chatMessages.length > 0 && this.chatBridge) {
      for (const msg of result.chatMessages) {
        const agent = this.agents[role as AgentRole];
        const prefix = `${agent.emoji} ${agent.displayName}`;
        console.log(`[chat] ${prefix}: ${msg.content.slice(0, 80)}`);
        await this.chatBridge.send(role, prefix, msg.content).catch((err: unknown) =>
          console.error(`[team] Chat send error:`, err),
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
      await this.chatBridge.alert("risk",
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
        this.chatBridge.send("chief", "📊 Chief", "Human triggered halt. All trading stopped.").catch(() => {});
      }
      return;
    }

    if (lower.includes("resume") || lower.includes("clear halt")) {
      this.board.clearHalt();
      if (this.chatBridge) {
        this.chatBridge.send("chief", "📊 Chief", "Halt cleared. Resuming trading.").catch(() => {});
      }
      return;
    }

    // /ignore <breaker> — suppress a circuit breaker's chat alerts
    if (lower.startsWith("/ignore ")) {
      const breaker = content.slice(8).trim().toLowerCase();
      this.board.state.suppressedBreakers.add(breaker);
      if (this.chatBridge) {
        this.chatBridge.send("risk", "🛡️ Risk Sentinel",
          `Suppressed <b>${breaker}</b> alerts. Still tracking, just won't ping you. Use /unignore ${breaker} to re-enable.`
        ).catch(() => {});
      }
      return;
    }

    // /unignore <breaker> — re-enable a circuit breaker's chat alerts
    if (lower.startsWith("/unignore ")) {
      const breaker = content.slice(10).trim().toLowerCase();
      this.board.state.suppressedBreakers.delete(breaker);
      if (this.chatBridge) {
        this.chatBridge.send("risk", "🛡️ Risk Sentinel",
          `Re-enabled <b>${breaker}</b> alerts.`
        ).catch(() => {});
      }
      return;
    }

    // Instant ack — fires before the LLM cycle so the human sees a response immediately
    if (this.chatBridge) {
      this.chatBridge.send("chief", "📊 Desk Chief", "Got it, looking into this...").catch(() => {});
    }

    // Route to mentioned agent or Chief by default
    const target = mentionedAgent ?? "chief";
    // postMessage with "urgent" priority will trigger board.onSignal → wake(target)
    this.board.postMessage("human", target, signal);
  }
}
