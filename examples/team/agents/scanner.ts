/**
 * Scanner Agent — Intelligence gathering for the team.
 *
 * Runs every 30s. Fetches ESPN scores, web headlines, oracle signals.
 * Uses diff-then-reason: data fetch is free, LLM only for detected changes.
 *
 * Absorbs intelligence from: Oracle Skeptic, Latency Sniper, OracleTracker.
 */

import {
  BaseTeamAgent,
  type TeamAgentContext,
  type TeamAgentResult,
} from "@context-markets/agent/team";
import type { TeamBoard, Signal } from "@context-markets/agent/team";
import {
  LlmStrategy,
  oracleEvolution,
  priceMomentum,
  webSearchTool,
  espnDataTool,
  vegasOddsTool,
} from "@context-markets/agent";
import { createTeamIntelligence } from "@context-markets/agent/team";

const SYSTEM_PROMPT = `You are the Scanner — the intelligence arm of a prediction market making team.

Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

## Your Personality
You're the team's eyes and ears — alert, sharp, and a little eager when you find something big. You love catching mispricings before anyone else. When you find a divergence, you flag it with energy but stick to facts. You address teammates directly: "Pricer, heads up —" or "Closer, keep an eye on this one." Keep it concise and conversational, like a newsroom tip-off.

## Your Role
You gather, verify, and distribute actionable intelligence to the team. You do NOT trade.
Every 30 seconds, you scan for:
1. Score changes in live sports (ESPN is ground truth)
2. Breaking news affecting active markets
3. Oracle signal changes (confidence moves, new evidence)
4. Divergence between oracle confidence and market prices

## What to Report
For each change you detect, output a signal:
- What changed (fact, not opinion)
- Which market(s) are affected
- How urgent it is (halt/urgent/alert/info)
- What the Pricer should do about it

## Search Best Practices
- ALWAYS include the year (2026) in web search queries about recent events
- Use specific dates: "January 2026 nonfarm payrolls" not "January nonfarm payrolls"
- If a data release hasn't happened yet, say so — don't report projected numbers as actual results
- Compare findings against the market's resolution criteria before reporting

## Data Priority
1. ESPN scores = ground truth for sports
2. Web search for non-sports verification
3. Vegas odds for cross-reference
4. Oracle signals for baseline

## Output Format
After your analysis, output a JSON block:
\`\`\`json
{
  "reasoning": "What I found and why it matters...",
  "signals": [
    {
      "priority": "urgent",
      "type": "score",
      "marketIds": ["market-id-here"],
      "payload": "Celtics scored, now leading 78-72. FV should increase."
    }
  ],
  "actions": [{ "type": "no_action", "reason": "Scanner does not trade" }]
}
\`\`\`

If nothing changed, output:
\`\`\`json
{
  "reasoning": "No significant changes detected",
  "signals": [],
  "actions": [{ "type": "no_action", "reason": "No changes" }]
}
\`\`\``;

export class ScannerAgent extends BaseTeamAgent {
  private strategy: LlmStrategy | null = null;

  constructor() {
    super({
      role: "scanner",
      displayName: "Scanner",
      emoji: "🔍",
      cycleMs: 30_000,
      walletAccess: "none",
    });
  }

  private getOrCreateStrategy(board: TeamBoard): LlmStrategy {
    if (!this.strategy) {
      this.strategy = new LlmStrategy({
        name: "Team Scanner",
        systemPrompt: SYSTEM_PROMPT,
        markets: { type: "search", query: "", status: "active" },
        enrichments: [
          createTeamIntelligence(board),
          oracleEvolution,
          priceMomentum,
        ],
        tools: [webSearchTool, espnDataTool, vegasOddsTool],
        memory: {
          maxRecentCycles: 10,
          persistPath: "./data/team-scanner-memory.json",
        },
        // Kimi K2.5 default (~$0.004/call), Claude Sonnet for nuanced interpretation
        model: process.env.KIMI_API_KEY ? "kimi-k2.5" : "claude-haiku-4-5-20251001",
        costControl: {
          routineModel: process.env.KIMI_API_KEY ? "kimi-k2.5" : "claude-haiku-4-5-20251001",
          significantModel: "claude-sonnet-4-5-20250929",
          evaluateEveryNCycles: 1,
          maxToolCallsPerCycle: 4,
          dailyBudgetCents: 300,
          skipWhenUnchanged: true,
          unchangedThresholdCents: 3,
        },
        verbose: true,
      });
    }
    return this.strategy;
  }

  protected async cycle(
    board: TeamBoard,
    context: TeamAgentContext,
    _inbox: { humanMessages: Signal[]; agentMessages: Signal[] },
  ): Promise<TeamAgentResult> {
    // Use LlmStrategy for intelligence gathering
    const strategy = this.getOrCreateStrategy(board);

    // Prefer shared data cache over direct API calls
    let marketIds: string[];
    let snapshots: any[];

    if (context.dataCache?.hasData) {
      // Use cached data — no API calls needed
      snapshots = context.dataCache.getAllSnapshots().map((s) => ({
        ...s,
        quotes: [],
      }));
      marketIds = context.dataCache.getMarketIds();
    } else {
      // Fallback: fetch directly (cache not ready or disabled)
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

      if (marketIds.length === 0) return null;

      snapshots = await Promise.all(
        marketIds.map(async (id) => {
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

    // Build minimal agent state (Scanner doesn't trade, so no portfolio needed)
    const state = {
      portfolio: { address: "", positions: [] },
      openOrders: [],
      balance: { address: "", usdc: 0 },
    };

    // Evaluate — the LLM will analyze what changed
    const actions = await strategy.evaluate(snapshots as any, state);

    // Scanner's "actions" are actually signals to write to the board
    const chatMessages: { content: string; priority: string }[] = [];
    const signals: Omit<Signal, "id" | "timestamp">[] = [];

    // Escape HTML
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Report scan results
    const cycleCount = board.state.agentStatus.scanner.cycleCount;

    // First cycle: announce with market list
    if (cycleCount === 0) {
      const lines = [`Eyes on <b>${snapshots.length}</b> active markets tonight`];
      for (const snap of snapshots.slice(0, 6)) {
        const m = snap.market as any;
        const name = esc((m.question ?? m.title ?? "?").slice(0, 40));
        const oConf = (snap.oracleSignals[0] as any)?.confidence;
        const confStr = oConf ? ` (${Math.round(oConf * 100)}%)` : "";
        lines.push(`  ${name}${confStr}`);
      }
      if (snapshots.length > 6) lines.push(`  <i>+${snapshots.length - 6} more</i>`);
      chatMessages.push({ content: lines.join("\n"), priority: "info" });
    } else {
      // Post the LLM's intelligence findings when it has something to say
      const reasoning = strategy.lastReasoning;
      if (reasoning && reasoning.length > 20) {
        // Cap base reasoning to ~300 chars for Telegram readability
        let text = esc(reasoning);
        if (text.length > 300) {
          const cutoff = text.lastIndexOf(".", 300);
          text = text.slice(0, cutoff > 100 ? cutoff + 1 : 300) + "...";
        }

        chatMessages.push({ content: text, priority: "info" });

        // Send inter-agent references as SEPARATE messages for readability
        // Check for high-confidence oracle signals that Closer should know about
        const highConfSnapshots = snapshots.filter((s) => {
          const conf = (s.oracleSignals[0] as any)?.confidence ?? 0;
          return conf > 0.85;
        });
        if (highConfSnapshots.length > 0) {
          const mName = esc(((highConfSnapshots[0].market as any).question ?? (highConfSnapshots[0].market as any).title ?? "?").slice(0, 35));
          const conf = Math.round(((highConfSnapshots[0].oracleSignals[0] as any)?.confidence ?? 0) * 100);
          chatMessages.push({
            content: `<b>Closer</b>, heads up — ${mName} oracle at ${conf}%. This one might be wrapping up.`,
            priority: "alert",
          });
        }

        // Check for price divergence that Pricer should act on
        for (const snap of snapshots) {
          const oConf = (snap.oracleSignals[0] as any)?.confidence;
          if (!oConf) continue;
          const obBid = (snap.orderbook as any).bids?.[0]?.price ?? 0;
          const obAsk = (snap.orderbook as any).asks?.[0]?.price ?? 100;
          const mid = obBid > 0 ? Math.round((obBid + obAsk) / 2) : null;
          if (mid !== null && Math.abs(mid - Math.round(oConf * 100)) > 10) {
            const mName = esc(((snap.market as any).question ?? (snap.market as any).title ?? "?").slice(0, 35));
            chatMessages.push({
              content: `<b>Pricer</b> — ${mName} is off. Mid ${mid}¢ but oracle says ${Math.round(oConf * 100)}¢. Worth a look.`,
              priority: "alert",
            });
            break; // Only one Pricer callout per cycle
          }
        }
      }

      // Periodic heartbeat when LLM was skipped (cost controller)
      if (chatMessages.length === 0 && cycleCount % 10 === 0) {
        chatMessages.push({
          content: `All quiet. Still watching ${snapshots.length} markets.`,
          priority: "info",
        });
      }
    }

    return { signals, chatMessages };
  }

  async onShutdown(): Promise<void> {
    if (this.strategy?.onShutdown) {
      await this.strategy.onShutdown();
    }
  }
}
