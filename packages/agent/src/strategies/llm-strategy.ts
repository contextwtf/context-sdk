/**
 * LLM Strategy
 *
 * A strategy where the LLM *is* the decision maker. Instead of rules that
 * convert fair value → actions, the LLM receives market context, enrichments,
 * and memory, can call tools (web search, ESPN, Vegas), reasons about what
 * to do, and outputs trading actions directly.
 *
 * The system prompt defines the agent's personality and strategy. Everything
 * else (risk management, execution, fill detection) is handled by the runtime.
 */

import type { Fill } from "@context-markets/sdk";
import type {
  Strategy,
  MarketSelector,
  MarketSnapshot,
  AgentState,
  Action,
  PlaceOrderAction,
  CancelOrderAction,
  NoAction,
} from "../strategy.js";
import {
  type LlmClient,
  type ChatMessage,
  type ToolDefinition,
  createLlmClient,
} from "../llm/client.js";
import {
  type LlmTool,
  type ToolContext,
  builtinTools,
} from "../llm/tools.js";
import {
  type ContextEnrichment,
  type EnrichmentInput,
  oracleEvolution,
  priceMomentum,
} from "../llm/enrichments.js";
import { AgentMemory, type MemoryOptions } from "../llm/memory.js";
import {
  CostController,
  type CostControlOptions,
  type CostContext,
} from "../llm/cost-control.js";

// ─── Types ───

export interface LlmStrategyOptions {
  /** Human-readable strategy name. */
  name: string;
  /** System prompt defining the agent's personality and trading strategy. */
  systemPrompt: string;
  /** Which markets to track. */
  markets: MarketSelector;

  /** Default model. Default: "claude-haiku-4-5-20251001". */
  model?: string;
  /** Custom LLM client. Default: auto-created from model string. */
  llmClient?: LlmClient;

  /** Enrichments computed from existing data, always in context. Default: [oracleEvolution, priceMomentum]. */
  enrichments?: ContextEnrichment[];
  /** Additional tools the LLM can call on-demand. */
  tools?: LlmTool[];
  /** Include built-in tools (web_search, ESPN, Vegas, memory). Default: true. */
  builtinTools?: boolean;

  /** Memory configuration. */
  memory?: MemoryOptions;
  /** Cost control configuration. */
  costControl?: CostControlOptions;

  /** Max contracts per individual order. Orders larger than this are auto-split. */
  maxOrderSize?: number;

  /** Print the LLM's reasoning to console as a running commentary. Default: false. */
  verbose?: boolean;
}

// ─── LLM Strategy ───

export class LlmStrategy implements Strategy {
  readonly name: string;

  private readonly systemPrompt: string;
  private readonly marketSelector: MarketSelector;
  private readonly model: string;
  private readonly client: LlmClient;
  private readonly enrichments: ContextEnrichment[];
  private readonly tools: LlmTool[];
  private readonly memory: AgentMemory;
  private readonly costController: CostController;
  private readonly verbose: boolean;
  private readonly maxOrderSize: number | undefined;

  private cycleNumber = 0;
  private enrichmentHistory: EnrichmentInput[] = [];
  private readonly maxEnrichmentHistory = 20;
  private cachedActions: Action[] = [];
  private hadFillSinceLastEval = false;
  private initialized = false;
  private _lastReasoning = "";

  /** The LLM's reasoning text from the most recent evaluate() call. */
  get lastReasoning(): string {
    return this._lastReasoning;
  }

  /** Extra context to inject into the next evaluate() call (cleared after use). */
  private _injectedContext: string | null = null;

  /** Inject extra context (e.g., human messages) into the next evaluate() call. */
  injectContext(context: string): void {
    this._injectedContext = context;
  }

  constructor(options: LlmStrategyOptions) {
    this.name = options.name;
    this.systemPrompt = options.systemPrompt;
    this.marketSelector = options.markets;
    this.model = options.model ?? "claude-haiku-4-5-20251001";
    this.client = options.llmClient ?? createLlmClient(this.model);

    this.enrichments = options.enrichments ?? [oracleEvolution, priceMomentum];

    // Build tool list — deduplicate by name (user tools override builtins)
    const extraTools = options.tools ?? [];
    const includeBuiltins = options.builtinTools ?? true;
    const allTools = includeBuiltins ? [...builtinTools, ...extraTools] : extraTools;
    const seen = new Set<string>();
    this.tools = [];
    // Iterate in reverse so user tools win over builtins with the same name
    for (let i = allTools.length - 1; i >= 0; i--) {
      const name = allTools[i].definition.name;
      if (!seen.has(name)) {
        seen.add(name);
        this.tools.unshift(allTools[i]);
      }
    }

    this.memory = new AgentMemory(options.memory);
    this.costController = new CostController(options.costControl);
    this.maxOrderSize = options.maxOrderSize;
    this.verbose = options.verbose ?? false;
  }

  async selectMarkets(): Promise<MarketSelector> {
    return this.marketSelector;
  }

  async evaluate(markets: MarketSnapshot[], state: AgentState): Promise<Action[]> {
    this.cycleNumber++;

    // Load memory on first cycle
    if (!this.initialized) {
      await this.memory.load();
      this.initialized = true;
    }

    // 1. Cost controller — should we call the LLM this cycle?
    const costCtx: CostContext = {
      markets,
      state,
      cycleNumber: this.cycleNumber,
      hadFill: this.hadFillSinceLastEval,
    };

    if (!this.costController.shouldEvaluate(costCtx)) {
      console.log(`[llm-strategy] Cycle ${this.cycleNumber}: skipped (cost controller)`);
      return this.cachedActions;
    }

    this.hadFillSinceLastEval = false;

    // 2. Run enrichments
    const enrichmentInput: EnrichmentInput = {
      cycle: this.cycleNumber,
      timestamp: Date.now(),
      markets,
      state,
    };

    const enrichmentTexts: string[] = [];
    for (const enrichment of this.enrichments) {
      try {
        const text = enrichment.compute(enrichmentInput, this.enrichmentHistory);
        if (text) enrichmentTexts.push(text);
      } catch (err) {
        console.error(`[llm-strategy] Enrichment "${enrichment.name}" error:`, err);
      }
    }

    // Store in rolling history
    this.enrichmentHistory.push(enrichmentInput);
    if (this.enrichmentHistory.length > this.maxEnrichmentHistory) {
      this.enrichmentHistory.shift();
    }

    // 3. Build context message
    const contextMessage = this.buildContext(markets, state, enrichmentTexts);

    // 4. Select model
    const model = this.costController.selectModel(costCtx);

    // 5. Build messages
    const messages: ChatMessage[] = [
      // Memory context as conversation history
      ...this.memory.getContextMessages(),
      // Current cycle as user message
      { role: "user", content: contextMessage },
    ];

    // Tool definitions
    const toolDefs: ToolDefinition[] = this.tools.map((t) => t.definition);

    // 6. Call LLM with tool loop
    const toolContext: ToolContext = { markets, state, memory: this.memory };
    let totalUsage = { inputTokens: 0, outputTokens: 0 };
    let toolCallCount = 0;
    const maxToolCalls = this.costController.maxToolCalls;

    try {
      let response = await this.client.chat({
        model,
        system: this.systemPrompt,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        maxTokens: 4096,
      });

      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;

      // Print initial thinking
      if (this.verbose && response.text) {
        this.narrate(response.text);
      }

      // Tool loop
      while (response.hasToolCalls && toolCallCount < maxToolCalls) {
        // Add assistant message to conversation
        messages.push(response.message);

        // Execute tool calls, stopping at the limit
        const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
        for (const call of response.toolCalls) {
          if (toolCallCount >= maxToolCalls) {
            // Budget exhausted — return a polite refusal for remaining calls
            toolResults.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: "[Tool call limit reached — please output your trading decisions now.]",
            });
            continue;
          }

          toolCallCount++;
          const tool = this.tools.find((t) => t.definition.name === call.name);

          if (this.verbose) {
            const args = Object.entries(call.input).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
            console.log(`\n\x1b[33m  [tool] ${call.name}(${args})\x1b[0m`);
          }

          let result: string;
          if (tool) {
            try {
              result = await tool.execute(call.input, toolContext);
            } catch (err) {
              result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else {
            result = `Unknown tool: ${call.name}`;
          }

          if (this.verbose) {
            const preview = result.split("\n").slice(0, 6).join("\n");
            const truncated = result.split("\n").length > 6 ? "\n    ..." : "";
            console.log(`\x1b[2m    ${preview.replace(/\n/g, "\n    ")}${truncated}\x1b[0m`);
          }

          console.log(`[llm-strategy] Tool: ${call.name} (${toolCallCount}/${maxToolCalls})`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: result,
          });
        }

        // Add tool results as user message
        messages.push({ role: "user", content: toolResults });

        // If we've hit the tool limit, do one final call WITHOUT tools to force a decision
        const atLimit = toolCallCount >= maxToolCalls;

        if (atLimit) {
          messages.push({
            role: "user",
            content: "Your tool budget for this cycle is exhausted. Based on the research above, output your trading decisions now as a JSON block with \"reasoning\" and \"actions\" fields. If you don't want to trade, use {\"reasoning\": \"...\", \"actions\": [{\"type\": \"no_action\", \"reason\": \"...\"}]}.",
          });
        }

        response = await this.client.chat({
          model,
          system: this.systemPrompt,
          messages,
          tools: atLimit ? undefined : (toolDefs.length > 0 ? toolDefs : undefined),
          maxTokens: 4096,
        });

        totalUsage.inputTokens += response.usage.inputTokens;
        totalUsage.outputTokens += response.usage.outputTokens;

        // Print thinking after tool results
        if (this.verbose && response.text) {
          this.narrate(response.text);
        }
      }

      // 7. Parse actions from final response
      const actions = this.parseActions(response.text, markets);

      // 8. Record cost
      this.costController.recordEvaluation(this.cycleNumber, markets, totalUsage);

      // 9. Update memory
      const actionSummaries = actions
        .filter((a) => a.type !== "no_action")
        .map((a) => this.summarizeAction(a));
      const reasoning = this.extractReasoning(response.text);
      this._lastReasoning = reasoning;

      this.memory.addCycle({
        cycle: this.cycleNumber,
        timestamp: Date.now(),
        marketSummary: `${markets.length} markets, ${state.openOrders.length} open orders`,
        actions: actionSummaries,
        reasoning,
      });

      // Save memory periodically
      if (this.cycleNumber % 5 === 0) {
        await this.memory.save().catch((err) =>
          console.error("[llm-strategy] Memory save error:", err),
        );
      }

      // 10. Cache for skip cycles — only keep cancels and no_action.
      //     place_order actions are already on the book; replaying them
      //     creates duplicates.
      this.cachedActions = actions.filter((a) => a.type !== "place_order");

      const actionCount = actions.filter((a) => a.type !== "no_action").length;
      console.log(
        `[llm-strategy] Cycle ${this.cycleNumber}: ${actionCount} actions, ${toolCallCount} tool calls, ${totalUsage.inputTokens + totalUsage.outputTokens} tokens (${model})`,
      );

      return actions;
    } catch (err) {
      console.error(`[llm-strategy] LLM call failed:`, err);
      return [{ type: "no_action", reason: "LLM call failed" }];
    }
  }

  onFill(fill: Fill): void {
    this.hadFillSinceLastEval = true;

    const title = (fill.order as any).marketTitle
      || (fill.order as any).marketId?.slice(0, 8)
      || "unknown";

    this.memory.addTrade({
      timestamp: Date.now(),
      marketId: fill.order.marketId,
      marketTitle: title,
      outcome: fill.order.outcome as "yes" | "no",
      side: fill.order.side as "buy" | "sell",
      size: fill.fillSize,
      priceCents: fill.order.price ?? 0,
      type: fill.type as "full" | "partial",
    });
  }

  async onShutdown(): Promise<void> {
    await this.memory.save();
  }

  // ─── Context Building ───

  private buildContext(
    markets: MarketSnapshot[],
    state: AgentState,
    enrichmentTexts: string[],
  ): string {
    const now = new Date();
    const parts: string[] = [];

    parts.push(`=== CYCLE ${this.cycleNumber} — ${now.toLocaleDateString()} ${now.toLocaleTimeString()} ===`);
    parts.push("");

    // Portfolio
    parts.push("YOUR PORTFOLIO:");
    parts.push(`  Balance: ${formatCents(state.balance.usdc)} USDC`);

    const positions = state.portfolio.positions?.filter((p: any) => p.size > 0) ?? [];
    if (positions.length > 0) {
      parts.push("  Positions:");
      for (const pos of positions) {
        const market = markets.find((m) => m.market.id === pos.marketId);
        const title = market?.market.title || (market?.market as any)?.question || pos.marketId.slice(0, 8);
        const mid = market ? getMid(market) : 0;
        const pnl = mid > 0 ? ((mid - pos.avgPrice) * pos.size / 100) : 0;
        const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
        parts.push(`    - "${title}" — ${pos.size} ${pos.outcome.toUpperCase()} @ avg ${pos.avgPrice}¢ (mid: ${mid}¢, ${pnlStr})`);
      }
    } else {
      parts.push("  Positions: none");
    }
    parts.push("");

    // Open orders
    if (state.openOrders.length > 0) {
      parts.push("OPEN ORDERS:");
      for (const order of state.openOrders.slice(0, 20)) {
        const market = markets.find((m) => m.market.id === order.marketId);
        const title = market?.market.title || (market?.market as any)?.question || order.marketId.slice(0, 8);
        parts.push(`    - ${order.side.toUpperCase()} ${order.size} ${order.outcome.toUpperCase()} "${title}" @ ${order.price}¢ [nonce: ${order.nonce}]`);
      }
      if (state.openOrders.length > 20) {
        parts.push(`    ... and ${state.openOrders.length - 20} more`);
      }
      parts.push("");
    }

    // Markets
    parts.push(`MARKETS (${markets.length} active):`);
    for (let i = 0; i < markets.length; i++) {
      const snap = markets[i];
      const title = snap.market.title || (snap.market as any).question || "Untitled";
      const bestBid = snap.orderbook.bids[0]?.price ?? "—";
      const bestAsk = snap.orderbook.asks[0]?.price ?? "—";

      // Oracle info
      const oracle = snap.oracleSignals[0];
      const oracleStr = oracle
        ? `${Math.round(((oracle as any).confidence ?? (oracle as any).probability ?? 0) * 100)}%`
        : "none";

      // Fair value
      const fvStr = snap.fairValue
        ? `FV: ${snap.fairValue.yesCents}¢`
        : "";

      parts.push(`  ${i + 1}. "${title}" — Bid ${bestBid}¢ / Ask ${bestAsk}¢ — Oracle: ${oracleStr}${fvStr ? ` — ${fvStr}` : ""}`);
    }
    parts.push("");

    // Enrichments
    if (enrichmentTexts.length > 0) {
      parts.push("ENRICHMENTS:");
      parts.push("");
      for (const text of enrichmentTexts) {
        parts.push(text);
      }
      parts.push("");
    }

    // Memory context
    const memoryStr = this.memory.getContextString();
    if (memoryStr) {
      parts.push(memoryStr);
    }

    // Risk constraints — so the LLM knows its limits
    if (this.maxOrderSize) {
      parts.push("RISK LIMITS:");
      parts.push(`  Max order size: ${this.maxOrderSize} contracts (larger orders will be auto-split)`);
      parts.push("");
    }

    // Injected context (e.g., human messages)
    if (this._injectedContext) {
      parts.push("INCOMING MESSAGES:");
      parts.push(this._injectedContext);
      parts.push("");
      this._injectedContext = null; // Clear after use
    }

    parts.push("What would you like to do? Use tools for research if needed, then output your decisions as a JSON block.");

    return parts.join("\n");
  }

  // ─── Action Parsing ───

  private parseActions(text: string, markets: MarketSnapshot[]): Action[] {
    // Check for explicit "no action" signals first
    const lower = text.toLowerCase();
    const noActionPhrases = [
      "no action", "do nothing", "skip this cycle", "i'll observe",
      "i will observe", "watch and wait", "no trades", "stand pat",
      "remain on the sidelines", "no positions",
    ];
    if (noActionPhrases.some((p) => lower.includes(p)) && !lower.includes('"actions"')) {
      return [{ type: "no_action", reason: "LLM chose no action" }];
    }

    // Strategy 1: Fenced code block (greedy match inside fences)
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fencedMatch) {
      const result = this.tryParseJsonActions(fencedMatch[1].trim(), markets);
      if (result) return result;
    }

    // Strategy 2: Find the outermost { ... } containing "actions"
    const actionsIdx = text.indexOf('"actions"');
    if (actionsIdx !== -1) {
      // Walk backwards to find the opening brace
      let braceStart = text.lastIndexOf("{", actionsIdx);
      if (braceStart !== -1) {
        // Walk forward to find matching closing brace
        let depth = 0;
        for (let i = braceStart; i < text.length; i++) {
          if (text[i] === "{") depth++;
          else if (text[i] === "}") depth--;
          if (depth === 0) {
            const result = this.tryParseJsonActions(text.slice(braceStart, i + 1), markets);
            if (result) return result;
            break;
          }
        }
      }
    }

    // Strategy 3: Find a bare JSON array of actions
    const arrayMatch = text.match(/\[\s*\{[\s\S]*?"type"\s*:\s*"(?:place_order|cancel_order|no_action)"[\s\S]*?\]\s*/);
    if (arrayMatch) {
      const result = this.tryParseJsonActions(arrayMatch[0], markets);
      if (result) return result;
    }

    // Log a snippet of what we couldn't parse for debugging
    const snippet = text.slice(0, 200).replace(/\n/g, " ");
    console.warn(`[llm-strategy] Could not parse actions from LLM response: "${snippet}..."`);
    return [{ type: "no_action", reason: "Could not parse actions from response" }];
  }

  private tryParseJsonActions(jsonStr: string, markets: MarketSnapshot[]): Action[] | null {
    try {
      const parsed = JSON.parse(jsonStr);
      const rawActions = Array.isArray(parsed) ? parsed : (parsed.actions ?? null);

      if (!Array.isArray(rawActions)) return null;

      const actions: Action[] = [];
      for (const raw of rawActions) {
        const resolved = this.resolveAction(raw, markets);
        if (!resolved) continue;

        // Auto-split oversized orders into chunks
        if (resolved.type === "place_order" && this.maxOrderSize && resolved.size > this.maxOrderSize) {
          let remaining = resolved.size;
          while (remaining > 0) {
            const chunk = Math.min(remaining, this.maxOrderSize);
            actions.push({ ...resolved, size: chunk });
            remaining -= chunk;
          }
        } else {
          actions.push(resolved);
        }
      }

      return actions.length > 0 ? actions : [{ type: "no_action", reason: "No valid actions parsed" }];
    } catch {
      return null;
    }
  }

  private resolveAction(raw: any, markets: MarketSnapshot[]): Action | null {
    if (raw.type === "no_action") {
      return { type: "no_action", reason: raw.reason } as NoAction;
    }

    if (raw.type === "cancel_order") {
      if (!raw.nonce) {
        // Try to match by description
        const nonce = this.resolveOrderNonce(raw.description || raw.market, markets);
        if (!nonce) return null;
        return { type: "cancel_order", nonce } as CancelOrderAction;
      }
      return { type: "cancel_order", nonce: raw.nonce } as CancelOrderAction;
    }

    if (raw.type === "place_order") {
      // Resolve market reference to marketId
      const marketId = this.resolveMarketId(raw.market || raw.marketId, markets);
      if (!marketId) {
        console.warn(`[llm-strategy] Could not resolve market: ${raw.market || raw.marketId}`);
        return null;
      }

      const outcome = (raw.outcome || "yes").toLowerCase();
      const side = (raw.side || "buy").toLowerCase();
      const priceCents = raw.priceCents ?? raw.price;
      const size = raw.size ?? raw.quantity;

      if (!priceCents || !size) {
        console.warn("[llm-strategy] Missing price or size in place_order");
        return null;
      }

      // Clamp price to valid range (1-99). LLMs sometimes output 0 or 100.
      const clampedPrice = Math.max(1, Math.min(99, Math.round(Number(priceCents))));

      return {
        type: "place_order",
        marketId,
        outcome: outcome as "yes" | "no",
        side: side as "buy" | "sell",
        priceCents: clampedPrice,
        size: Math.round(Number(size)),
      } as PlaceOrderAction;
    }

    return null;
  }

  /** Resolve a market reference (title substring, partial ID) to a marketId. */
  private resolveMarketId(ref: string | undefined, markets: MarketSnapshot[]): string | null {
    if (!ref) return null;

    // Direct ID match
    const direct = markets.find((m) => m.market.id === ref);
    if (direct) return direct.market.id;

    // Title substring match (case-insensitive)
    const lower = ref.toLowerCase();
    const titleMatch = markets.find((m) => {
      const title = (m.market.title || (m.market as any).question || "").toLowerCase();
      return title.includes(lower) || lower.includes(title.slice(0, 20));
    });
    if (titleMatch) return titleMatch.market.id;

    // Partial ID match
    const partialId = markets.find((m) => m.market.id.startsWith(ref) || ref.startsWith(m.market.id.slice(0, 8)));
    if (partialId) return partialId.market.id;

    return null;
  }

  /** Resolve order description to a nonce. */
  private resolveOrderNonce(_description: string | undefined, _markets: MarketSnapshot[]): string | null {
    // Basic implementation — in practice, the LLM should use the nonce directly
    return null;
  }

  // ─── Helpers ───

  private extractReasoning(text: string): string {
    // Priority 1: Extract the "reasoning" field from JSON (most reliable)
    const reasoningMatch = text.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (reasoningMatch) {
      return reasoningMatch[1]
        .replace(/\\n/g, " ")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .slice(0, 500);
    }

    // Priority 2: Extract prose before the JSON block (if there's meaningful text)
    const jsonIdx = text.indexOf("```");
    if (jsonIdx > 30) {
      return text.slice(0, jsonIdx).trim().slice(0, 500);
    }
    const braceIdx = text.indexOf('{"');
    if (braceIdx > 30) {
      return text.slice(0, braceIdx).trim().slice(0, 500);
    }

    // Priority 3: Strip any markdown code fences and JSON artifacts from the text
    let cleaned = text
      .replace(/```json\s*[\s\S]*?```/g, "")  // Remove fenced JSON blocks
      .replace(/```[\s\S]*?```/g, "")           // Remove any fenced blocks
      .replace(/\{[\s\S]*?"(?:actions|signals|directives)"[\s\S]*\}/g, "") // Remove JSON objects
      .trim();

    if (cleaned.length > 10) {
      return cleaned.slice(0, 500);
    }

    return text.slice(0, 500);
  }

  /** Print the LLM's reasoning as styled narration. */
  private narrate(text: string): void {
    // Strip JSON blocks for readability — we show actions separately
    const reasoning = this.extractReasoning(text);
    if (!reasoning) return;

    const lines = reasoning.split("\n");
    console.log(`\n\x1b[36m  ${this.name}:\x1b[0m`);
    for (const line of lines) {
      if (line.trim()) {
        console.log(`\x1b[37m  ${line}\x1b[0m`);
      }
    }
    console.log("");
  }

  private summarizeAction(action: Action): string {
    switch (action.type) {
      case "place_order":
        return `${action.side} ${action.size} ${action.outcome} @ ${action.priceCents}¢ (${action.marketId.slice(0, 8)})`;
      case "cancel_order":
        return `cancel ${action.nonce}`;
      case "cancel_replace":
        return `cancel_replace ${action.cancelNonce} → ${action.side} ${action.size} ${action.outcome} @ ${action.priceCents}¢`;
      case "no_action":
        return `no_action: ${action.reason || ""}`;
      default:
        return "unknown action";
    }
  }
}

// ─── Utilities ───

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getMid(snap: MarketSnapshot): number {
  const bestBid = snap.orderbook.bids[0]?.price ?? 0;
  const bestAsk = snap.orderbook.asks[0]?.price ?? 100;
  return Math.round((bestBid + bestAsk) / 2);
}
