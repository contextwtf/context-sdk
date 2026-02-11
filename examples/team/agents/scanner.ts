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

    // Fetch markets
    const selector = await strategy.selectMarkets();
    let marketIds: string[];
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

    // Fetch snapshots
    const snapshots = await Promise.all(
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

    // Parse any signals from the LLM response (they come as no_action with reasons)
    // The real signals come from the strategy's reasoning — we'd need to parse them
    // For now, log what the scanner found
    const hasAction = actions.some((a) => a.type !== "no_action");
    if (hasAction) {
      chatMessages.push({
        content: `Scanned ${snapshots.length} markets. Found actionable intelligence.`,
        priority: "info",
      });
    }

    return { signals, chatMessages };
  }

  async onShutdown(): Promise<void> {
    if (this.strategy?.onShutdown) {
      await this.strategy.onShutdown();
    }
  }
}
