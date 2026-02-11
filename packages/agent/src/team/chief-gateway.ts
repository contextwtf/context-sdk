/**
 * chief-gateway.ts — The event-driven brain of the MM team v2.
 *
 * Key differences from v1 DeskChiefAgent:
 * - Event-driven: waits for events, doesn't run on timer
 * - Attention-based context: full detail for active markets, one-line for background
 * - Directly executes directives (set_fair_value, dispatch_scanner, etc.)
 * - Model selection: Kimi routine, Sonnet escalation
 * - Integrates with fast path: Chief confirms/corrects provisional FVs
 */

import type {
  LlmClient,
  ToolDefinition,
  ChatMessage,
} from "../llm/client.js";
import { createLlmClient } from "../llm/client.js";
import type {
  ChiefDirective,
  LlmConfig,
  QueuedEvent,
  ScannerDispatch,
  TeamEvent,
} from "./types-v2.js";
import type { OrderBookState } from "./order-book-state.js";
import type { EventQueue } from "./event-queue.js";
import type { ChatBridge } from "./chat-bridge.js";
import { computeQuotes, buildPricerParams } from "./pricer-fn.js";
import { riskCheckAll } from "./risk-middleware.js";
import { runInvariants, getViolations, hasCriticalViolation } from "./invariants.js";
import { dispatchScanner } from "./scanner-worker.js";
import { getCoalesceKey, getEventPriority } from "./event-queue.js";

// ─── System Prompt ───

const CHIEF_SYSTEM = `You are the Desk Chief of an automated prediction market making system (v2).

Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

## Your Role
You are the strategic brain. You receive events (market data changes, scanner findings, human messages, fills) and respond with directives. Your job:
1. Set fair values for markets based on available information
2. Dispatch scanner tasks when you need more data
3. Respond to human messages
4. Halt or close markets when appropriate

## Context Structure
You'll receive:
- **Markets Needing Attention** — full context for markets in the current event batch
- **Background Markets** — one-line summaries for stable markets
- **Events Since Last Cycle** — what triggered this cycle
- **Pending Tasks** — scanner tasks still running

## Output Format
Respond with JSON containing your directives:
\`\`\`json
{
  "reasoning": "Brief assessment of the situation...",
  "directives": [
    { "type": "set_fair_value", "marketId": "...", "fairValue": 65, "confidence": 0.8, "reasoning": "..." },
    { "type": "dispatch_scanner", "markets": ["..."], "focus": "Check latest NFP data", "tools": ["web_search"] },
    { "type": "respond_human", "message": "Here's what I see..." },
    { "type": "halt_market", "marketId": "...", "reason": "..." },
    { "type": "close_market", "marketId": "...", "direction": "yes", "confidence": 0.95 }
  ]
}
\`\`\`

## Decision Guidelines
- **Provisional markets** need your immediate attention — confirm or correct the FV
- **Scanner results** give you data to set confident fair values
- **Fills** mean someone traded with us — consider if the market moved
- **Human messages** always get a response — be warm, brief, helpful
- When uncertain, dispatch a scanner rather than guessing
- Always explain your reasoning for FV changes

## Fair Value Setting
- Use ALL available signals: orderbook midpoint, oracle confidence, scanner findings
- Confidence: 0.0 (total guess) to 1.0 (verified fact)
- Higher confidence = tighter spreads, larger sizes (the pricer math handles this)
- If oracle says 90%+ confidence, market is likely resolving — consider close_market

## Model Escalation
You're running on a fast model for routine decisions. The system will automatically
escalate to a stronger model when:
- Conflicting signals between sources
- Large positions at risk
- Human questions requiring research
- New market categories you haven't seen before`;

// ─── Config ───

interface ChiefConfig {
  llm: LlmConfig;
  scannerTools: ToolDefinition[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
}

// ─── ChiefGateway ───

export class ChiefGateway {
  private readonly state: OrderBookState;
  private readonly queue: EventQueue;
  private readonly chatBridge?: ChatBridge;
  private readonly config: ChiefConfig;

  private routineClient: LlmClient;
  private escalationClient: LlmClient;

  private running = false;
  private cycleCount = 0;
  private scannerTaskCounter = 0;

  // Track which events we've already handled (prevent re-processing)
  private handledEventTimestamps = new Set<number>();

  constructor(
    state: OrderBookState,
    queue: EventQueue,
    config: ChiefConfig,
    chatBridge?: ChatBridge,
  ) {
    this.state = state;
    this.queue = queue;
    this.config = config;
    this.chatBridge = chatBridge;

    this.routineClient = createLlmClient(config.llm.routineModel);
    this.escalationClient = createLlmClient(config.llm.escalationModel);
  }

  // ─── Main Event Loop ───

  async run(): Promise<void> {
    this.running = true;
    console.log("[chief] Gateway started — waiting for events");

    while (this.running) {
      try {
        // Block until events arrive (or timeout after 30s → heartbeat)
        const events = await this.queue.next(30_000);

        // Check if stopped while waiting
        if (!this.running) break;

        // Filter already-handled events
        const newEvents = events.filter((e) => {
          if (this.handledEventTimestamps.has(e.arrivedAt)) return false;
          this.handledEventTimestamps.add(e.arrivedAt);
          return true;
        });

        // Clean up old timestamps (keep last 1000)
        if (this.handledEventTimestamps.size > 1000) {
          const arr = Array.from(this.handledEventTimestamps).sort();
          const toRemove = arr.slice(0, arr.length - 500);
          for (const t of toRemove) this.handledEventTimestamps.delete(t);
        }

        if (newEvents.length === 0) {
          // Heartbeat — run invariants even when idle
          this.runInvariantCheck();
          continue;
        }

        // Process event batch
        await this.processBatch(newEvents);
        this.cycleCount++;
      } catch (err) {
        console.error("[chief] Event loop error:", err instanceof Error ? err.message : err);
        // Don't crash — continue processing
        await sleep(1000);
      }
    }

    console.log("[chief] Gateway stopped");
  }

  stop(): void {
    this.running = false;
  }

  // ─── Batch Processing ───

  private async processBatch(events: QueuedEvent[]): Promise<void> {
    const startTime = Date.now();
    const eventTypes = events.map((e) => e.event.type);
    console.log(`[chief] Processing ${events.length} events: ${eventTypes.join(", ")}`);

    // Determine if we should escalate to stronger model
    const shouldEscalate = this.shouldEscalate(events);
    const client = shouldEscalate ? this.escalationClient : this.routineClient;
    const modelName = shouldEscalate ? this.config.llm.escalationModel : this.config.llm.routineModel;

    if (shouldEscalate) {
      console.log(`[chief] Escalating to ${modelName}`);
    }

    // Build context
    const activeMarketIds = this.extractMarketIds(events);
    const context = this.buildContext(events, activeMarketIds);

    // Call LLM
    const messages: ChatMessage[] = [
      { role: "user", content: context },
    ];

    try {
      const response = await client.chat({
        model: modelName,
        system: CHIEF_SYSTEM,
        messages,
        maxTokens: 2048,
      });

      // Parse directives
      const directives = this.parseDirectives(response.text);
      console.log(`[chief] ${directives.length} directives from LLM (${Date.now() - startTime}ms)`);

      // Execute directives
      for (const directive of directives) {
        await this.executeDirective(directive);
      }
    } catch (err) {
      console.error(`[chief] LLM call failed:`, err instanceof Error ? err.message : err);
      // On LLM failure, at least handle human messages with a fallback
      for (const event of events) {
        if (event.event.type === "human_message") {
          await this.sendChat(`Sorry, I'm having trouble processing right now. Your message: "${event.event.content}"`);
        }
      }
    }

    // Always run invariants after processing
    this.runInvariantCheck();
  }

  // ─── Escalation Logic ───

  private shouldEscalate(events: QueuedEvent[]): boolean {
    for (const { event } of events) {
      // Human messages needing research
      if (event.type === "human_message") {
        const lower = event.content.toLowerCase();
        if (lower.includes("why") || lower.includes("explain") || lower.includes("research")) {
          return true;
        }
      }

      // Conflicting scanner findings
      if (event.type === "scanner_result" && event.findings.length > 1) {
        const fvs = event.findings
          .map((f) => f.suggestedFairValue)
          .filter((v): v is number => v !== undefined);
        if (fvs.length >= 2) {
          const spread = Math.max(...fvs) - Math.min(...fvs);
          if (spread > 20) return true; // Conflicting signals
        }
      }

      // Large position at risk
      if (event.type === "reprice_needed" && event.urgent) {
        const market = this.state.markets.get(event.marketId);
        if (market) {
          const netPos = Math.abs(market.position.yes - market.position.no);
          if (netPos > 100) return true; // Large position needs careful handling
        }
      }
    }

    return false;
  }

  // ─── Context Building ───

  private buildContext(events: QueuedEvent[], activeMarketIds: string[]): string {
    const sections: string[] = [];

    // Market context (attention-based)
    sections.push(this.state.buildChiefContext(activeMarketIds));

    // Events
    sections.push(`## Events Since Last Cycle`);
    for (const { event, priority } of events) {
      sections.push(`[P${priority}] ${renderEvent(event)}`);
    }

    return sections.join("\n\n");
  }

  private extractMarketIds(events: QueuedEvent[]): string[] {
    const ids = new Set<string>();
    for (const { event } of events) {
      if ("marketId" in event && event.marketId) {
        ids.add(event.marketId);
      }
      if (event.type === "data_refresh") {
        for (const s of event.snapshots) {
          const id = (s.market as Record<string, any>).id;
          if (id) ids.add(id);
        }
      }
      if (event.type === "scanner_result") {
        for (const f of event.findings) {
          ids.add(f.marketId);
        }
      }
    }
    return Array.from(ids);
  }

  // ─── Directive Parsing ───

  private parseDirectives(text: string): ChiefDirective[] {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/\{[\s\S]*"directives"[\s\S]*\}/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);

      // Send reasoning to chat if present
      if (parsed.reasoning && this.chatBridge) {
        // Don't send reasoning for every cycle — only when notable
        if (this.cycleCount % 5 === 0 || parsed.directives?.length > 0) {
          const reasoning = parsed.reasoning.slice(0, 300);
          this.sendChat(reasoning).catch(() => {});
        }
      }

      const directives: ChiefDirective[] = [];

      for (const d of parsed.directives ?? []) {
        switch (d.type) {
          case "set_fair_value":
            if (d.marketId && typeof d.fairValue === "number") {
              directives.push({
                type: "set_fair_value",
                marketId: d.marketId,
                fairValue: d.fairValue,
                confidence: d.confidence ?? 0.5,
                reasoning: d.reasoning ?? "",
              });
            }
            break;

          case "dispatch_scanner":
            if (d.markets && d.focus) {
              const taskId = `scan-${++this.scannerTaskCounter}`;
              directives.push({
                type: "dispatch_scanner",
                dispatch: {
                  taskId,
                  markets: d.markets,
                  focus: d.focus,
                  tools: d.tools ?? ["web_search"],
                  maxToolCalls: this.config.llm.maxToolCallsPerCycle,
                  timeout: 30_000,
                },
              });
            }
            break;

          case "respond_human":
            if (d.message) {
              directives.push({ type: "respond_human", message: d.message });
            }
            break;

          case "halt_market":
            if (d.marketId) {
              directives.push({
                type: "halt_market",
                marketId: d.marketId,
                reason: d.reason ?? "Chief directive",
              });
            }
            break;

          case "close_market":
            if (d.marketId && d.direction) {
              directives.push({
                type: "close_market",
                marketId: d.marketId,
                direction: d.direction,
                confidence: d.confidence ?? 0.9,
              });
            }
            break;
        }
      }

      return directives;
    } catch {
      return [];
    }
  }

  // ─── Directive Execution ───

  private async executeDirective(directive: ChiefDirective): Promise<void> {
    switch (directive.type) {
      case "set_fair_value": {
        const { marketId, fairValue, confidence, reasoning } = directive;
        console.log(`[chief] Set FV: ${marketId} → ${fairValue}¢ (conf: ${(confidence * 100).toFixed(0)}%) — ${reasoning}`);

        this.state.setFairValue(marketId, fairValue, confidence, "chief");

        // Compute and validate new quotes
        const market = this.state.markets.get(marketId);
        if (market && !this.state.isHalted(marketId)) {
          const quotes = computeQuotes(buildPricerParams(
            fairValue,
            confidence,
            market.position,
            this.state.limits,
          ));

          const riskState = {
            markets: this.state.markets,
            balance: this.state.balance,
            totalExposure: this.state.totalExposure,
            sessionPnL: this.state.sessionPnL,
          };
          const { decisions, spreadOk } = riskCheckAll(quotes, marketId, riskState, this.state.limits);

          if (spreadOk.allow) {
            // Apply risk adjustments
            const validQuotes = quotes.map((q, i) => {
              const d = decisions[i];
              if (d.allow) return q;
              if (d.suggested?.size) return { ...q, size: d.suggested.size };
              return null;
            }).filter((q): q is NonNullable<typeof q> => q !== null);

            if (validQuotes.length > 0) {
              // Update state with new quotes
              const bid = validQuotes.find((q) => q.side === "buy") ?? null;
              const ask = validQuotes.find((q) => q.side === "sell") ?? null;
              this.state.setQuotes(
                marketId,
                bid ? { price: bid.priceCents, size: bid.size } : null,
                ask ? { price: ask.priceCents, size: ask.size } : null,
              );

              // Emit reprice_needed so runtime executes the orders
              const event: TeamEvent = {
                type: "reprice_needed",
                marketId,
                reason: `Chief set FV ${fairValue}¢`,
                urgent: false,
              };
              // Don't push to queue (we're already processing) — just update state
            }
          }
        }
        break;
      }

      case "dispatch_scanner": {
        const { dispatch } = directive;
        console.log(`[chief] Dispatch scanner: ${dispatch.taskId} — ${dispatch.focus}`);

        // Track pending task
        this.state.addPendingTask({
          id: dispatch.taskId,
          type: "research",
          markets: dispatch.markets,
        });

        // Fire and forget — result comes back as scanner_result event
        dispatchScanner(
          dispatch,
          this.routineClient,
          this.config.scannerTools,
          this.config.executeTool,
        ).then((result) => {
          this.state.completePendingTask(dispatch.taskId);
          const event: TeamEvent = {
            type: "scanner_result",
            taskId: result.taskId,
            findings: result.findings,
          };
          this.queue.push(event, getEventPriority(event), getCoalesceKey(event));
          console.log(`[scanner] ${result.taskId}: ${result.findings.length} findings in ${result.durationMs}ms`);
        }).catch((err) => {
          this.state.completePendingTask(dispatch.taskId, "failed");
          console.error(`[scanner] ${dispatch.taskId} failed:`, err instanceof Error ? err.message : err);
        });
        break;
      }

      case "respond_human": {
        console.log(`[chief] Human response: ${directive.message.slice(0, 80)}`);
        await this.sendChat(directive.message);
        break;
      }

      case "halt_market": {
        console.log(`[chief] Halt market: ${directive.marketId} — ${directive.reason}`);
        this.state.haltMarket(directive.marketId, directive.reason);
        await this.sendChat(`Market halted: ${directive.marketId} — ${directive.reason}`);
        break;
      }

      case "close_market": {
        console.log(`[chief] Close market: ${directive.marketId} → ${directive.direction} (conf: ${(directive.confidence * 100).toFixed(0)}%)`);
        this.state.setMarketStatus(directive.marketId, "closing");
        // Closing logic: take directional position. For now, just update state.
        // Full closing execution would go through RuntimeV2.
        break;
      }
    }
  }

  // ─── Invariant Check ───

  private runInvariantCheck(): void {
    const results = runInvariants(
      {
        markets: this.state.markets,
        balance: this.state.balance,
        totalExposure: this.state.totalExposure,
        capitalUtilization: this.state.capitalUtilization,
        sessionPnL: this.state.sessionPnL,
        haltedByHuman: this.state.haltedByHuman,
      },
      this.state.limits,
    );

    this.state.lastInvariantResults = results;
    this.state.lastInvariantAt = Date.now();

    const violations = getViolations(results);

    if (violations.length === 0) {
      if (this.cycleCount % 10 === 0) {
        console.log(`[invariants] All pass (${results.length} checks)`);
      }
      return;
    }

    const critical = violations.filter((v) => v.severity === "critical");
    const warnings = violations.filter((v) => v.severity === "warning");

    if (critical.length > 0) {
      console.log(`[invariants] ${critical.length} CRITICAL, ${warnings.length} warnings`);
      for (const v of critical) {
        console.log(`[invariants] CRITICAL: ${v.rule} — ${v.details} ${v.marketId ? `(${v.marketId})` : ""}`);

        // Push critical violations as events for next cycle
        const event: TeamEvent = {
          type: "invariant_violation",
          rule: v.rule,
          severity: v.severity,
          details: v.details ?? "",
          marketId: v.marketId,
        };
        this.queue.push(event, 0, getCoalesceKey(event));
      }
    } else if (warnings.length > 0) {
      console.log(`[invariants] ${warnings.length} warnings`);
    }
  }

  // ─── Chat ───

  private async sendChat(message: string): Promise<void> {
    if (this.chatBridge) {
      try {
        await this.chatBridge.send("chief" as any, "Chief", message);
      } catch (err) {
        console.error("[chief] Chat send error:", err);
      }
    }
    console.log(`[chief] ${message.slice(0, 100)}`);
  }
}

// ─── Helpers ───

function renderEvent(event: TeamEvent): string {
  switch (event.type) {
    case "data_refresh":
      return `data_refresh: ${event.snapshots.length} market snapshots`;
    case "human_message":
      return `human_message from ${event.from}: "${event.content.slice(0, 80)}"`;
    case "scanner_result":
      return `scanner_result (${event.taskId}): ${event.findings.length} findings`;
    case "tick":
      return `tick at ${new Date(event.timestamp).toLocaleTimeString()}`;
    case "fill":
      return `fill: ${event.side} ${event.size} @ ${event.priceCents}¢ on ${event.marketId}`;
    case "oracle_change":
      return `oracle_change: ${event.marketId} conf ${(event.previousConfidence * 100).toFixed(0)}% → ${(event.newConfidence * 100).toFixed(0)}%`;
    case "invariant_violation":
      return `invariant_violation [${event.severity}]: ${event.rule} — ${event.details}`;
    case "reprice_needed":
      return `reprice_needed${event.urgent ? " (URGENT)" : ""}: ${event.marketId} — ${event.reason}`;
    case "new_market":
      return `new_market: ${event.name} (${event.marketId})`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
