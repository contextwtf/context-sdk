/**
 * Desk Chief — Coordinator and strategic oversight.
 *
 * Runs every 60s (+ event-driven wake for human messages).
 * Reads the board, reviews team performance, acknowledges agent activity,
 * issues visible directives, and narrates team coordination.
 *
 * The Chief does NOT trade. It has no wallet access.
 */

import {
  BaseTeamAgent,
  type TeamAgentContext,
  type TeamAgentResult,
} from "@context-markets/agent/team";
import type { TeamBoard, Signal, AgentRole } from "@context-markets/agent/team";
import {
  LlmStrategy,
} from "@context-markets/agent";
import { createTeamIntelligence, createPortfolioRisk } from "@context-markets/agent/team";

const SYSTEM_PROMPT = `You are the Desk Chief of a prediction market making team. You manage 4 trading agents: Scanner (intelligence), Pricer (quoting), Risk Sentinel (risk management), and Closer (resolution trading).

Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

## Your Personality
You're the calm, experienced team lead. You keep things running smoothly and give credit where it's due. "Nice catch, Scanner." "Pricer's on top of it." When things get dicey, you're steady: "Let's take a breath — Risk has us covered." You address agents directly and keep the team focused. When a human asks something, you're warm but efficient — acknowledge, delegate, report back.

## Your Job
Capital allocation and strategic oversight. Every 60 seconds, you:
1. Review the team's aggregate P&L and position across all markets
2. Check if any agent is underperforming or overexposed
3. Adjust capital allocation and risk limits for each agent
4. Assign or reassign markets between agents
5. Route human messages to the appropriate agent
6. Issue strategic directives (e.g., "widen spreads today, news cycle is hot")

## What You Do NOT Do
- Place orders (you have no wallet)
- Compute fair values (that's the Pricer)
- Research markets (that's the Scanner)
- Monitor real-time risk (that's the Risk Sentinel — you're too slow at 60s)

## When Conflicts Arise
- Risk Sentinel overrides everything for safety
- Your directives override Scanner and Pricer for strategy
- Closer has autonomy during resolution events (time-critical)

## Human Message Handling
When you see [HUMAN MESSAGE] in the context:
1. ALWAYS address the human directly in your reasoning — this text will be shown to them in Telegram
2. Answer their question clearly and concisely
3. Route to the appropriate agent if needed
4. Your "reasoning" field IS the response the human sees — make it conversational and helpful

## Output Format
\`\`\`json
{
  "reasoning": "My assessment of the current state...",
  "directives": [
    {
      "target": "pricer",
      "payload": "Widen sports spreads to 6¢ — volatile news night"
    },
    {
      "target": "scanner",
      "payload": "Check nonfarm payrolls result, market may need repricing"
    }
  ],
  "actions": [{ "type": "no_action", "reason": "Chief does not trade" }]
}
\`\`\`

Each directive MUST include a "target" field with the agent name (scanner, pricer, risk, closer) and a "payload" field with the instruction. Keep directives concise and actionable.`;

export class DeskChiefAgent extends BaseTeamAgent {
  private strategy: LlmStrategy | null = null;
  private lastSignalScanAt = 0;

  constructor() {
    super({
      role: "chief",
      displayName: "Desk Chief",
      emoji: "📊",
      cycleMs: 60_000,
      walletAccess: "none",
    });
  }

  private getOrCreateStrategy(board: TeamBoard): LlmStrategy {
    if (!this.strategy) {
      this.strategy = new LlmStrategy({
        name: "Desk Chief",
        systemPrompt: SYSTEM_PROMPT,
        markets: { type: "search", query: "", status: "active" },
        enrichments: [
          createTeamIntelligence(board),
          createPortfolioRisk(board),
        ],
        tools: [], // Chief doesn't need tools — it reads the board
        builtinTools: false,
        memory: {
          maxRecentCycles: 10,
          persistPath: "./data/team-chief-memory.json",
        },
        // Kimi K2.5 default, Sonnet for complex human messages / conflict resolution
        model: process.env.KIMI_API_KEY ? "kimi-k2.5" : "claude-haiku-4-5-20251001",
        costControl: {
          routineModel: process.env.KIMI_API_KEY ? "kimi-k2.5" : "claude-haiku-4-5-20251001",
          significantModel: "claude-sonnet-4-5-20250929",
          evaluateEveryNCycles: 1,
          maxToolCallsPerCycle: 0,
          dailyBudgetCents: 300,
          skipWhenUnchanged: false, // Always review
        },
        verbose: true,
      });
    }
    return this.strategy;
  }

  // ─── Agent Activity Acknowledgement ───

  /**
   * Scan recent board signals since last Chief cycle and produce
   * concise acknowledgement lines for what other agents have reported.
   */
  private acknowledgeAgentActivity(board: TeamBoard): string[] {
    const sinceMs = Date.now() - this.lastSignalScanAt;
    // On first cycle, look back 2 minutes; otherwise since last scan
    const lookbackMs = this.lastSignalScanAt === 0 ? 120_000 : Math.max(sinceMs, 15_000);
    const recentSignals = board.getRecentSignals(lookbackMs);
    this.lastSignalScanAt = Date.now();

    if (recentSignals.length === 0) return [];

    const lines: string[] = [];

    // Group signals by source agent
    const bySource = new Map<string, Signal[]>();
    for (const sig of recentSignals) {
      if (sig.source === "chief" || sig.source === "human") continue;
      const key = sig.source;
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key)!.push(sig);
    }

    // Scanner findings
    const scannerSigs = bySource.get("scanner") ?? [];
    if (scannerSigs.length > 0) {
      const urgent = scannerSigs.filter((s) => s.priority === "urgent" || s.priority === "halt");
      if (urgent.length > 0) {
        const firstPayload = urgent[0].payload.slice(0, 80);
        lines.push(`Good catch, Scanner — ${urgent.length} urgent signal${urgent.length > 1 ? "s" : ""}: ${firstPayload}`);
      } else {
        const types = Array.from(new Set(scannerSigs.map((s) => s.type))).join(", ");
        lines.push(`Scanner's been busy — ${scannerSigs.length} signal${scannerSigs.length > 1 ? "s" : ""} (${types}). Pricer's on it.`);
      }
    }

    // Risk Sentinel alerts
    const riskSigs = bySource.get("risk") ?? [];
    if (riskSigs.length > 0) {
      const halts = riskSigs.filter((s) => s.priority === "halt" || s.priority === "override");
      if (halts.length > 0) {
        lines.push(`Risk pulled the brake — ${halts.length} halt${halts.length > 1 ? "s" : ""}. ${halts[0].payload.slice(0, 80)}`);
      } else {
        lines.push(`Risk flagged ${riskSigs.length} thing${riskSigs.length > 1 ? "s" : ""} — nothing critical, keeping an eye on it.`);
      }
    }

    // Closer activity
    const closerSigs = bySource.get("closer") ?? [];
    if (closerSigs.length > 0) {
      const resolutions = closerSigs.filter((s) => s.type === "oracle" || s.priority === "urgent");
      if (resolutions.length > 0) {
        lines.push(`Closer's got ${resolutions.length > 1 ? "a few" : "one"} in the crosshairs — resolution looks close.`);
      }
    }

    // Pricer activity (only mention if notable)
    const pricerSigs = bySource.get("pricer") ?? [];
    if (pricerSigs.length > 0) {
      const urgentPricer = pricerSigs.filter((s) => s.priority === "urgent" || s.priority === "halt");
      if (urgentPricer.length > 0) {
        lines.push(`Pricer flagged ${urgentPricer.length} urgent condition${urgentPricer.length > 1 ? "s" : ""}.`);
      }
    }

    return lines;
  }

  // ─── Directive Parsing ───

  /**
   * Parse directives from the LLM output and format as agent-directed chat messages.
   * Also posts them to the board for the target agent.
   */
  private processDirectives(
    board: TeamBoard,
    strategy: LlmStrategy,
  ): { content: string; priority: string }[] {
    const chatMessages: { content: string; priority: string }[] = [];
    const reasoning = strategy.lastReasoning ?? "";

    // Try to extract directives from JSON in the reasoning
    const jsonMatch = reasoning.match(/```json\s*([\s\S]*?)```/) ?? reasoning.match(/\{[\s\S]*"directives"[\s\S]*\}/);
    if (!jsonMatch) return chatMessages;

    try {
      const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
      const directives = parsed.directives ?? [];

      for (const dir of directives) {
        const target = dir.target as AgentRole | undefined;
        const payload = dir.payload as string | undefined;
        if (!payload) continue;

        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const targetLabel = target ? `<b>${target.charAt(0).toUpperCase() + target.slice(1)}</b>: ` : "";

        chatMessages.push({
          content: `${targetLabel}${esc(payload)}`,
          priority: dir.priority ?? "info",
        });

        // Post directive to the board for the target agent
        if (target && ["scanner", "pricer", "risk", "closer"].includes(target)) {
          board.postMessage("chief", target as AgentRole, {
            priority: (dir.priority as any) ?? "alert",
            type: "directive",
            marketIds: dir.marketIds ?? [],
            payload,
          });

          // Also store in the board's directives list
          board.addSignal({
            source: "chief",
            priority: (dir.priority as any) ?? "alert",
            type: "directive",
            marketIds: dir.marketIds ?? [],
            payload: `[→ ${target}] ${payload}`,
          });
        }
      }
    } catch {
      // JSON parse failed — no directives to extract
    }

    return chatMessages;
  }

  // ─── Team Narrative ───

  /**
   * Build a brief narrative of current team state. Only produced when
   * there is something meaningful to report (avoids noise).
   */
  private buildTeamNarrative(board: TeamBoard, marketCount: number): string | null {
    const parts: string[] = [];

    // Agent health
    const agents = board.state.agentStatus;
    const agentEntries = Object.entries(agents) as [string, typeof agents[AgentRole]][];
    const running = agentEntries.filter(([, s]) => s.status === "running" || s.cycleCount > 0);
    const errored = agentEntries.filter(([, s]) => s.status === "error");

    if (errored.length > 0) {
      parts.push(`${errored.map(([n]) => n).join(", ")} in error state`);
    }

    // Markets & quoting
    const fvCount = Object.keys(board.state.fairValues).length;
    if (fvCount > 0) {
      parts.push(`Pricer quoting ${fvCount} market${fvCount > 1 ? "s" : ""}`);
    }

    // Closer claims
    const closerMarkets = Object.entries(board.state.marketAssignments)
      .filter(([, owner]) => owner === "closer").length;
    if (closerMarkets > 0) {
      parts.push(`Closer claimed ${closerMarkets} for resolution`);
    }

    // Risk state
    const risk = board.state.riskMetrics;
    if (risk.activeCircuitBreakers.length > 0) {
      parts.push(`${risk.activeCircuitBreakers.length} circuit breaker${risk.activeCircuitBreakers.length > 1 ? "s" : ""} active`);
    }
    if (board.state.halt.global) {
      parts.push("GLOBAL HALT active");
    }

    if (parts.length === 0) {
      // Nothing notable — only report agent count + markets
      if (running.length > 0 && marketCount > 0) {
        return `Team's looking good. ${running.length} agents running, ${marketCount} markets covered.`;
      }
      return null;
    }

    return parts.join(". ") + ".";
  }

  // ─── Main Cycle ───

  protected async cycle(
    board: TeamBoard,
    context: TeamAgentContext,
    inbox: { humanMessages: Signal[]; agentMessages: Signal[] },
  ): Promise<TeamAgentResult> {
    const chatMessages: { content: string; priority: string }[] = [];
    const hasHumanMessages = inbox.humanMessages.length > 0;

    // ── 1. Thinking indicator for human messages ──
    // Emit instant acknowledgement before LLM runs
    if (hasHumanMessages) {
      const first = inbox.humanMessages[0].payload;
      const preview = first.length > 50 ? first.slice(0, 50) + "..." : first;
      chatMessages.push({
        content: `On it — "${preview}"`,
        priority: "info",
      });
    }

    // ── 2. Route human messages to appropriate agents ──
    for (const msg of inbox.humanMessages) {
      const lower = msg.payload.toLowerCase();
      if (lower.includes("position") || lower.includes("exposure") || lower.includes("risk")) {
        board.postMessage("chief", "risk", {
          priority: "urgent",
          type: "directive",
          marketIds: [],
          payload: `Human asked: ${msg.payload}`,
        });
      } else if (lower.includes("market") || lower.includes("scan") || lower.includes("news")) {
        board.postMessage("chief", "scanner", {
          priority: "urgent",
          type: "directive",
          marketIds: [],
          payload: `Human asked: ${msg.payload}`,
        });
      } else if (lower.includes("price") || lower.includes("quote") || lower.includes("spread")) {
        board.postMessage("chief", "pricer", {
          priority: "urgent",
          type: "directive",
          marketIds: [],
          payload: `Human asked: ${msg.payload}`,
        });
      }
    }

    // ── 3. Acknowledge recent agent activity ──
    const ackLines = this.acknowledgeAgentActivity(board);
    if (ackLines.length > 0) {
      chatMessages.push({
        content: ackLines.join("\n"),
        priority: "info",
      });
    }

    // ── 4. Run LLM for strategic assessment ──
    const strategy = this.getOrCreateStrategy(board);

    // Inject human messages directly into context so LLM sees and responds to them
    if (hasHumanMessages) {
      const humanContext = inbox.humanMessages
        .map((m) => `[HUMAN MESSAGE]: ${m.payload}`)
        .join("\n");
      strategy.injectContext(humanContext);
    }

    // Prefer shared data cache over direct API calls
    let marketIds: string[];
    let snapshots: any[];

    if (context.dataCache?.hasData) {
      snapshots = context.dataCache.getAllSnapshots().map((s) => ({
        ...s,
        quotes: [],
      }));
      marketIds = context.dataCache.getMarketIds();
    } else {
      const selector = await strategy.selectMarkets();
      if (selector.type === "ids") {
        marketIds = selector.ids;
      } else {
        const result = await context.client.searchMarkets({
          query: selector.query,
          status: selector.status,
        });
        marketIds = result.markets.map((m: { id: string }) => m.id);
      }

      if (marketIds.length === 0) {
        return { chatMessages };
      }

      snapshots = await Promise.all(
        marketIds.slice(0, 20).map(async (id) => {
          const [market, orderbook, oracle] = await Promise.all([
            context.client.getMarket(id),
            context.client.getOrderbook(id).catch(() => ({ bids: [], asks: [] })),
            context.client.getOracleSignals(id).catch(() => []),
          ]);
          return {
            market: (market as any).market ?? market,
            quotes: [],
            orderbook,
            oracleSignals: Array.isArray(oracle) ? oracle : [(oracle as any).oracle].filter(Boolean),
          };
        }),
      );
    }

    if (marketIds.length === 0) {
      return { chatMessages };
    }

    const state = {
      portfolio: { address: "", positions: [] },
      openOrders: [],
      balance: { address: "", usdc: 0 },
    };

    await strategy.evaluate(snapshots as any, state);

    // ── 5a. Post human-directed response from LLM reasoning ──
    if (hasHumanMessages) {
      const reasoning = strategy.lastReasoning ?? "";
      if (reasoning.length > 10) {
        // Extract meaningful response — strip JSON artifacts
        let response = reasoning
          .replace(/```json[\s\S]*?```/g, "")
          .replace(/\{[\s\S]*"directives"[\s\S]*\}/g, "")
          .trim();
        // Cap length for Telegram
        if (response.length > 400) {
          const cutoff = response.lastIndexOf(".", 400);
          response = response.slice(0, cutoff > 100 ? cutoff + 1 : 400) + "...";
        }
        if (response.length > 10) {
          chatMessages.push({
            content: response,
            priority: "urgent",
          });
        }
      }
    }

    // ── 5b. Parse and emit directives from LLM output ──
    const directiveMessages = this.processDirectives(board, strategy);
    chatMessages.push(...directiveMessages);

    // ── 6. Team status & narrative ──
    const cycleCount = board.state.agentStatus.chief.cycleCount;
    if (cycleCount === 0) {
      // First cycle: full team online announcement
      const statusEntries = Object.entries(board.state.agentStatus) as [string, typeof board.state.agentStatus[AgentRole]][];
      const agentLines = statusEntries
        .map(([name, s]) => `  ${s.cycleCount > 0 ? "+" : "..."} ${name}: ${s.status}`)
        .join("\n");
      chatMessages.push({
        content: `<b>Team Online</b> — ${marketIds.length} active markets\n${agentLines}`,
        priority: "info",
      });
    } else if (cycleCount % 5 === 0) {
      // Periodic full status report
      const pnl = board.state.riskMetrics.sessionPnL;
      const pnlStr = `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
      const activeMarkets = Object.keys(board.state.fairValues).length;
      const breakers = board.state.riskMetrics.activeCircuitBreakers;
      const exposure = board.state.riskMetrics.totalExposure;

      const lines = [
        `<b>Team Status</b> (cycle ${cycleCount})`,
        `Markets: ${activeMarkets}  |  P&amp;L: <code>${pnlStr}</code>  |  Exposure: <code>$${exposure.toFixed(0)}</code>`,
      ];
      if (breakers.length > 0) {
        lines.push(`Active breakers: ${breakers.join(", ")}`);
      }

      // Append brief narrative
      const narrative = this.buildTeamNarrative(board, marketIds.length);
      if (narrative) lines.push(narrative);

      chatMessages.push({ content: lines.join("\n"), priority: "info" });
    } else {
      // Non-reporting cycles: short narrative only if something notable
      const narrative = this.buildTeamNarrative(board, marketIds.length);
      if (narrative && (ackLines.length > 0 || directiveMessages.length > 0)) {
        // Only narrate when we already acknowledged something — avoid noise
        chatMessages.push({ content: narrative, priority: "info" });
      }
    }

    return { chatMessages };
  }

  async onShutdown(): Promise<void> {
    if (this.strategy?.onShutdown) {
      await this.strategy.onShutdown();
    }
  }
}
