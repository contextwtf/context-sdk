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
  FastPathAction,
  LlmConfig,
  Quote,
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
import { dispatchScanner, type MarketContext } from "./scanner-worker.js";
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

## Output Format — CRITICAL
Your ENTIRE response must be a single JSON object. No thinking, no explanation, no markdown — ONLY JSON.

{"reasoning":"Brief assessment...","directives":[...]}

Directive types:
- {"type":"set_fair_value","marketId":"0x...","fairValue":65,"confidence":0.8,"reasoning":"..."}
- {"type":"dispatch_scanner","markets":["0x..."],"focus":"Check latest data","tools":["web_search"]}
- {"type":"respond_human","message":"Here's what I see..."}
- {"type":"halt_market","marketId":"0x...","reason":"..."}
- {"type":"close_market","marketId":"0x...","direction":"yes","confidence":0.95}

## Decision Guidelines
- **New markets** → ALWAYS dispatch_scanner immediately. You cannot set informed fair values without knowing what the market is about.
- **Provisional markets** need your immediate attention — confirm or correct the FV
- **Scanner results** → set_fair_value for EACH market that has a suggestedFairValue. This is your primary job: translate research into fair values.
- **Fills** mean someone traded with us — consider if the market moved
- **Human messages** always get a response — be warm, brief, helpful
- When uncertain, dispatch a scanner rather than guessing
- Always explain your reasoning for FV changes
- NEVER return an empty directives array unless you truly have nothing to do (e.g., a tick with no pending work and no scanner results to act on)

## Fair Value Setting
- Use ALL available signals: orderbook midpoint, oracle confidence, scanner findings
- When scanner findings include suggestedFairValue, USE IT to set_fair_value with appropriate confidence
- Confidence: 0.0 (total guess) to 1.0 (verified fact). Scanner confidence maps roughly to your FV confidence.
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
  onAction?: (action: FastPathAction) => void;
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
  /** Collect FV updates within a cycle to send as one batched desk message. */
  private cycleFvUpdates: Array<{ name: string; fv: number; conf: number; reasoning: string; bid: string; ask: string }> = [];

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

        if (events.length === 0) {
          // Heartbeat — run invariants even when idle
          this.runInvariantCheck();
          continue;
        }

        // Process event batch (queue.next() already drains + coalesces — no dedup needed)
        await this.processBatch(events);
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

    // Reset batched FV updates for this cycle
    this.cycleFvUpdates = [];

    try {
      const response = await client.chat({
        model: modelName,
        system: CHIEF_SYSTEM,
        messages,
        maxTokens: 8192,
      });

      // Parse directives
      const directives = this.parseDirectives(response.text);
      console.log(`[chief] ${directives.length} directives from LLM (${Date.now() - startTime}ms)`);

      // Execute directives
      for (const directive of directives) {
        await this.executeDirective(directive);
      }

      // Flush batched FV updates as one desk message
      if (this.cycleFvUpdates.length > 0) {
        this.flushFvUpdates();
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

      // Scanner results with actual findings — always escalate for FV decisions
      if (event.type === "scanner_result" && event.findings.length > 0) {
        return true;
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
    const jsonStr = extractDirectivesJson(text);
    if (!jsonStr) {
      if (text.length > 0) {
        console.log(`[chief] No JSON directives found in response (${text.length} chars). First 200: ${text.slice(0, 200)}`);
        console.log(`[chief] Last 300: ${text.slice(-300)}`);
      }
      return [];
    }

    try {
      const parsed = JSON.parse(jsonStr);

      const rawDirs = parsed.directives ?? [];

      // Send reasoning to Chief bot when there are notable directives
      if (parsed.reasoning && this.chatBridge && parsed.directives?.length > 0) {
        const reasoning = parsed.reasoning.slice(0, 500);
        this.sendChat(reasoning).catch(() => {});
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
              // Resolve truncated market IDs from LLM
              const resolvedMarkets = (d.markets as string[]).map((id) => this.resolveMarketId(id));
              // Scale timeout and tool calls by number of markets
              const marketCount = resolvedMarkets.length;
              const maxToolCalls = Math.max(this.config.llm.maxToolCallsPerCycle, marketCount * 2);
              const timeout = Math.max(60_000, marketCount * 10_000);
              directives.push({
                type: "dispatch_scanner",
                dispatch: {
                  taskId,
                  markets: resolvedMarkets,
                  focus: d.focus,
                  tools: d.tools ?? ["web_search"],
                  maxToolCalls,
                  timeout,
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
    } catch (err) {
      console.log(`[chief] JSON parse error: ${err instanceof Error ? err.message : err}`);
      console.log(`[chief] Attempted to parse: ${jsonStr.slice(0, 300)}`);
      return [];
    }
  }

  // ─── Directive Execution ───

  private async executeDirective(directive: ChiefDirective): Promise<void> {
    switch (directive.type) {
      case "set_fair_value": {
        const { fairValue, confidence, reasoning } = directive;
        const marketId = this.resolveMarketId(directive.marketId);
        const market = this.state.markets.get(marketId);
        const marketName = market?.name ?? marketId.slice(0, 8);
        const shortName = marketName.length > 40 ? marketName.slice(0, 37) + "..." : marketName;
        console.log(`[chief] Set FV: ${marketId.slice(0, 8)} → ${fairValue}¢ (conf: ${(confidence * 100).toFixed(0)}%) — ${reasoning}`);

        this.state.setFairValue(marketId, fairValue, confidence, "chief");

        // Compute and validate new quotes
        let bidStr = "—";
        let askStr = "—";
        if (market && !this.state.isHalted(marketId)) {
          const quotes = computeQuotes(buildPricerParams(
            fairValue,
            confidence,
            market.position,
            this.state.limits,
          ));
          console.log(`[chief] Quotes for ${marketId}: ${quotes.map(q => `${q.side} ${q.priceCents}¢ x${q.size}`).join(", ")}`);

          const riskState = {
            markets: this.state.markets,
            balance: this.state.balance,
            totalExposure: this.state.totalExposure,
            sessionPnL: this.state.sessionPnL,
          };
          const { decisions, spreadOk } = riskCheckAll(quotes, marketId, riskState, this.state.limits);

          if (!spreadOk.allow) {
            console.log(`[chief] Risk: spread rejected for ${marketId}: ${spreadOk.reason}`);
          } else {
            const validQuotes = quotes.map((q, i) => {
              const d = decisions[i];
              if (d.allow) return q;
              if (d.suggested?.size) return { ...q, size: d.suggested.size };
              return null;
            }).filter((q): q is NonNullable<typeof q> => q !== null);

            if (validQuotes.length > 0) {
              const bid = validQuotes.find((q) => q.side === "buy") ?? null;
              const ask = validQuotes.find((q) => q.side === "sell") ?? null;
              bidStr = bid ? `${bid.priceCents}¢ x${bid.size}` : "—";
              askStr = ask ? `${ask.priceCents}¢ x${ask.size}` : "—";

              this.state.setQuotes(
                marketId,
                bid ? { price: bid.priceCents, size: bid.size } : null,
                ask ? { price: ask.priceCents, size: ask.size } : null,
              );

              if (this.config.onAction) {
                this.config.onAction({
                  type: "cancel_replace",
                  marketId,
                  quotes: validQuotes,
                });
              }
            }
          }
        }

        // Batch for desk activity message
        this.cycleFvUpdates.push({
          name: shortName,
          fv: fairValue,
          conf: Math.round(confidence * 100),
          reasoning: reasoning.slice(0, 120),
          bid: bidStr,
          ask: askStr,
        });
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

        // Build market contexts so scanner knows what to search for
        const marketContexts = dispatch.markets
          .map((id) => {
            const m = this.state.markets.get(id);
            if (!m) {
              console.log(`[chief] Scanner dispatch: no state for market ${id.slice(0, 10)}`);
              return null;
            }
            return { id: m.id, name: m.name, resolutionCriteria: m.resolutionCriteria, category: m.category };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);
        console.log(`[chief] Scanner contexts: ${marketContexts.length}/${dispatch.markets.length} — ${marketContexts.map(c => `"${c.name}"`).join(", ")}`);

        // Desk activity: scanner dispatched
        const scanMarketNames = marketContexts.map((c) => {
          const n = c.name.length > 35 ? c.name.slice(0, 32) + "..." : c.name;
          return `  ${n}`;
        }).join("\n");
        this.sendDesk(
          `🔍 <b>${dispatch.taskId}</b> dispatched\n${scanMarketNames}`
        ).catch(() => {});

        // Fire and forget — result comes back as scanner_result event
        dispatchScanner(
          dispatch,
          this.routineClient,
          this.config.scannerTools,
          this.config.executeTool,
          marketContexts,
        ).then((result) => {
          this.state.completePendingTask(dispatch.taskId);
          const event: TeamEvent = {
            type: "scanner_result",
            taskId: result.taskId,
            findings: result.findings,
          };
          this.queue.push(event, getEventPriority(event), getCoalesceKey(event));
          console.log(`[scanner] ${result.taskId}: ${result.findings.length} findings in ${result.durationMs}ms`);

          // Desk activity: scanner returned
          const durationSec = Math.round(result.durationMs / 1000);
          if (result.findings.length > 0) {
            const findingLines = result.findings.map((f) => {
              const mkt = this.state.markets.get(f.marketId);
              const name = mkt?.name ?? f.marketId.slice(0, 8);
              const shortName = name.length > 30 ? name.slice(0, 27) + "..." : name;
              const fvStr = f.suggestedFairValue !== undefined ? ` → ${f.suggestedFairValue}¢` : "";
              return `  ${shortName}${fvStr}`;
            }).join("\n");
            this.sendDesk(
              `📡 <b>${result.taskId}</b> returned (${durationSec}s)\n${findingLines}`
            ).catch(() => {});
          } else {
            this.sendDesk(
              `📡 <b>${result.taskId}</b> — no findings (${durationSec}s)`
            ).catch(() => {});
          }
        }).catch((err) => {
          this.state.completePendingTask(dispatch.taskId, "failed");
          console.error(`[scanner] ${dispatch.taskId} failed:`, err instanceof Error ? err.message : err);
          this.sendDesk(`⚠️ <b>${dispatch.taskId}</b> failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 100)}`).catch(() => {});
        });
        break;
      }

      case "respond_human": {
        console.log(`[chief] Human response: ${directive.message.slice(0, 80)}`);
        await this.sendChat(directive.message);
        break;
      }

      case "halt_market": {
        const haltId = this.resolveMarketId(directive.marketId);
        const haltMkt = this.state.markets.get(haltId);
        const haltName = haltMkt?.name ?? haltId.slice(0, 8);
        console.log(`[chief] Halt market: ${haltId.slice(0, 8)} — ${directive.reason}`);
        this.state.haltMarket(haltId, directive.reason);
        await this.sendChat(`🛑 <b>Market halted</b>\n${haltName}\n${directive.reason}`);
        break;
      }

      case "close_market": {
        const closeId = this.resolveMarketId(directive.marketId);
        console.log(`[chief] Close market: ${closeId.slice(0, 8)} → ${directive.direction} (conf: ${(directive.confidence * 100).toFixed(0)}%)`);
        this.state.setMarketStatus(closeId, "closing");
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
      const critLines: string[] = [];
      for (const v of critical) {
        console.log(`[invariants] CRITICAL: ${v.rule} — ${v.details} ${v.marketId ? `(${v.marketId})` : ""}`);
        const mktName = v.marketId ? (this.state.markets.get(v.marketId)?.name ?? v.marketId.slice(0, 8)) : "";
        critLines.push(`  ${v.rule}${mktName ? ` (${mktName.slice(0, 25)})` : ""}`);

        const event: TeamEvent = {
          type: "invariant_violation",
          rule: v.rule,
          severity: v.severity,
          details: v.details ?? "",
          marketId: v.marketId,
        };
        this.queue.push(event, 0, getCoalesceKey(event));
      }
      this.sendDesk(`🚨 <b>${critical.length} critical violation${critical.length > 1 ? "s" : ""}</b>\n${critLines.join("\n")}`).catch(() => {});
    } else if (warnings.length > 0) {
      console.log(`[invariants] ${warnings.length} warnings`);
    }
  }

  // ─── ID Resolution ───

  /** Resolve a possibly-truncated market ID to the full ID in state. */
  private resolveMarketId(id: string): string {
    // Exact match
    if (this.state.markets.has(id)) return id;
    // Prefix match (LLM often truncates hex IDs)
    for (const key of this.state.markets.keys()) {
      if (key.startsWith(id)) return key;
    }
    return id; // Return as-is if no match (will fail gracefully downstream)
  }

  // ─── Chat ───

  /** Send a message as Chief (conversational bot). */
  private async sendChat(message: string): Promise<void> {
    if (this.chatBridge) {
      try {
        await this.chatBridge.send("chief", "Chief", message);
      } catch (err) {
        console.error("[chief] Chat send error:", err);
      }
    }
    console.log(`[chief] ${message.slice(0, 100)}`);
  }

  /** Send a message as Desk (activity feed bot). */
  private async sendDesk(message: string): Promise<void> {
    if (this.chatBridge) {
      try {
        await this.chatBridge.send("desk", "Desk", message);
      } catch (err) {
        console.error("[desk] Activity send error:", err);
      }
    }
  }

  /** Flush batched FV updates as a single desk message. */
  private flushFvUpdates(): void {
    const updates = this.cycleFvUpdates;
    if (updates.length === 0) return;

    // Sort by FV descending for readability
    updates.sort((a, b) => b.fv - a.fv);

    const lines = updates.map((u) => {
      return `  <b>${u.fv}¢</b> ${u.name} (${u.conf}%)\n    ${u.bid} / ${u.ask}`;
    });

    const header = updates.length === 1
      ? `📊 <b>Fair value updated</b>`
      : `📊 <b>${updates.length} fair values set</b>`;

    this.sendDesk(`${header}\n${lines.join("\n")}`).catch(() => {});
  }
}

// ─── Helpers ───

function renderEvent(event: TeamEvent): string {
  switch (event.type) {
    case "data_refresh":
      return `data_refresh: ${event.snapshots.length} market snapshots`;
    case "human_message":
      return `human_message from ${event.from}: "${event.content.slice(0, 80)}"`;
    case "scanner_result": {
      const findingLines = event.findings.map((f) => {
        const fvStr = f.suggestedFairValue !== undefined ? ` → suggested FV: ${f.suggestedFairValue}¢` : "";
        const dataStr = Object.keys(f.data).length > 0 ? ` | data: ${JSON.stringify(f.data).slice(0, 200)}` : "";
        return `  - ${f.marketId}: [${f.type}] confidence=${f.confidence} source="${f.source}"${fvStr}${dataStr}`;
      });
      return `scanner_result (${event.taskId}): ${event.findings.length} findings\n${findingLines.join("\n")}`;
    }
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
      return `new_market: "${event.name}" (${event.marketId})`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract JSON containing "directives" from LLM output. Tries multiple patterns. */
function extractDirectivesJson(text: string): string | null {
  // 1. Code fence: ```json ... ```
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // 2. Plain code fence: ``` ... ```
  const plainFenceMatch = text.match(/```\s*([\s\S]*?)```/);
  if (plainFenceMatch) {
    const inner = plainFenceMatch[1].trim();
    if (inner.startsWith("{")) return inner;
  }

  // 3. Raw JSON with "directives" key
  const directivesMatch = text.match(/(\{"reasoning"[\s\S]*?"directives"\s*:\s*\[[\s\S]*?\]\s*\})/);
  if (directivesMatch) {
    try {
      JSON.parse(directivesMatch[1]);
      return directivesMatch[1];
    } catch {
      // Not valid JSON, try next strategy
    }
  }

  // 4. Last JSON object in the text (walk backwards from last brace)
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace >= 0) {
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === "}") depth++;
      if (text[i] === "{") depth--;
      if (depth === 0) {
        const candidate = text.slice(i, lastBrace + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed.directives || parsed.reasoning) return candidate;
        } catch {
          // Not valid JSON
        }
        break;
      }
    }
  }

  // 5. Try the whole text
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.directives || parsed.reasoning) return text.trim();
  } catch {
    // Not JSON
  }

  return null;
}
