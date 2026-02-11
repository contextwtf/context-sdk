/**
 * Desk Chief — Coordinator and strategic oversight.
 *
 * Runs every 60s. Reads the board, reviews team performance, adjusts
 * capital allocation, routes human messages, and issues directives.
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
When you receive a human message:
1. Interpret the intent
2. Route to the appropriate agent if needed
3. Respond with what you're doing about it

## Output Format
\`\`\`json
{
  "reasoning": "My assessment of the current state...",
  "directives": [
    {
      "priority": "alert",
      "type": "directive",
      "marketIds": [],
      "payload": "Widen sports spreads to 6¢ — volatile news night"
    }
  ],
  "actions": [{ "type": "no_action", "reason": "Chief does not trade" }]
}
\`\`\``;

export class DeskChiefAgent extends BaseTeamAgent {
  private strategy: LlmStrategy | null = null;

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

  protected async cycle(
    board: TeamBoard,
    context: TeamAgentContext,
    inbox: { humanMessages: Signal[]; agentMessages: Signal[] },
  ): Promise<TeamAgentResult> {
    const chatMessages: { content: string; priority: string }[] = [];

    // Handle human messages first
    for (const msg of inbox.humanMessages) {
      chatMessages.push({
        content: `Received from human: "${msg.payload}". Processing...`,
        priority: "info",
      });

      // Route to appropriate agent if it's a query
      const lower = msg.payload.toLowerCase();
      if (lower.includes("position") || lower.includes("exposure")) {
        board.postMessage("chief", "risk", {
          priority: "urgent",
          type: "directive",
          marketIds: [],
          payload: `Human asked: ${msg.payload}`,
        });
      } else if (lower.includes("market") || lower.includes("scan")) {
        board.postMessage("chief", "scanner", {
          priority: "urgent",
          type: "directive",
          marketIds: [],
          payload: `Human asked: ${msg.payload}`,
        });
      }
    }

    // Run LLM for strategic assessment
    const strategy = this.getOrCreateStrategy(board);

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

    if (marketIds.length === 0) {
      return { chatMessages };
    }

    // Fetch minimal snapshots for strategic overview
    const snapshots = await Promise.all(
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

    const state = {
      portfolio: { address: "", positions: [] },
      openOrders: [],
      balance: { address: "", usdc: 0 },
    };

    await strategy.evaluate(snapshots as any, state);

    // Periodic status report
    const cycleCount = board.state.agentStatus.chief.cycleCount;
    if (cycleCount > 0 && cycleCount % 5 === 0) {
      const pnl = board.state.riskMetrics.sessionPnL;
      const activeMarkets = Object.keys(board.state.fairValues).length;
      const breakers = board.state.riskMetrics.activeCircuitBreakers;

      chatMessages.push({
        content: `Status: ${activeMarkets} markets active, P&L ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}${breakers.length > 0 ? `, ⚠️ ${breakers.length} breakers` : ""}`,
        priority: "info",
      });
    }

    return { chatMessages };
  }

  async onShutdown(): Promise<void> {
    if (this.strategy?.onShutdown) {
      await this.strategy.onShutdown();
    }
  }
}
