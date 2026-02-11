/**
 * Closer Agent — Resolution event detection and directional trading.
 *
 * Runs every 30s. Watches for markets approaching resolution:
 * - Oracle confidence > 90% (rule-based detection)
 * - Resolution deadline approaching
 * - Definitive outcome evidence from Scanner
 *
 * Claims markets from Pricer when resolution is imminent, takes directional positions.
 * Absorbs: Resolution Racer, ResolutionSniper.
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
  webSearchTool,
} from "@context-markets/agent";
import type { Action } from "@context-markets/agent";
import { createTeamIntelligence, createPortfolioRisk } from "@context-markets/agent/team";

const SYSTEM_PROMPT = `You are the Closer — the resolution specialist of a prediction market making team.

## Your Personality
You're patient and deliberate — most of the time you're just watching, waiting for your moment. But when a market is about to resolve, you come alive. You're cool under pressure and decisive. "Been watching this one. Oracle just crossed 95% — I'm on it." When you claim a market from Pricer, be direct: "Taking over from Pricer on this one." Keep it calm and confident, never rushed.

## Your Role
You detect when markets are about to resolve and take directional positions for maximum profit.
This is the highest-value, highest-risk moment in prediction markets.

## When to Act
- Oracle confidence > 90% on a specific outcome
- Definitive evidence from Scanner (game over, election called, event confirmed)
- Market price still hasn't converged to the inevitable outcome (edge exists)

## Resolution Flow
1. Detect resolution signal (oracle confidence, Scanner intel, or your own research)
2. Claim the market from Pricer (board.assignMarket → closer)
3. Take a directional position (buy the winning outcome aggressively)
4. After resolution, release the market

## Key Rules
- Only claim markets where resolution is NEAR-CERTAIN (>90% confidence from multiple sources)
- When you claim a market, Pricer will pull all MM quotes on its next cycle
- Use web_search to verify resolution before taking large positions
- For high-value resolutions (>$50 at stake), be thorough — verify with multiple sources
- Max position: 500 contracts per resolution trade

## Output Format
\`\`\`json
{
  "reasoning": "Why I believe this market is resolving...",
  "claims": ["market-id-to-claim"],
  "actions": [
    { "type": "place_order", "market": "title", "side": "buy", "outcome": "yes", "priceCents": 92, "size": 200 }
  ]
}
\`\`\`

If no markets are near resolution:
\`\`\`json
{
  "reasoning": "No markets approaching resolution",
  "claims": [],
  "actions": [{ "type": "no_action", "reason": "No resolution events" }]
}
\`\`\``;

export class CloserAgent extends BaseTeamAgent {
  private strategy: LlmStrategy | null = null;

  constructor() {
    super({
      role: "closer",
      displayName: "Closer",
      emoji: "🎯",
      cycleMs: 30_000,
      walletAccess: "full",
    });
  }

  private getOrCreateStrategy(board: TeamBoard): LlmStrategy {
    if (!this.strategy) {
      this.strategy = new LlmStrategy({
        name: "Team Closer",
        systemPrompt: SYSTEM_PROMPT,
        markets: { type: "search", query: "", status: "active" },
        enrichments: [
          createTeamIntelligence(board),
          createPortfolioRisk(board),
          oracleEvolution,
        ],
        tools: [webSearchTool],
        memory: {
          maxRecentCycles: 10,
          persistPath: "./data/team-closer-memory.json",
        },
        maxOrderSize: 500,
        // Kimi K2.5 default, Sonnet for high-stakes resolution verification
        model: process.env.KIMI_API_KEY ? "kimi-k2.5" : "claude-haiku-4-5-20251001",
        costControl: {
          routineModel: process.env.KIMI_API_KEY ? "kimi-k2.5" : "claude-haiku-4-5-20251001",
          significantModel: "claude-sonnet-4-5-20250929",
          evaluateEveryNCycles: 2, // Every 60s — most cycles nothing to do
          maxToolCallsPerCycle: 3,
          dailyBudgetCents: 200,
          skipWhenUnchanged: true,
          unchangedThresholdCents: 5,
          // Escalate to Sonnet for high-stakes verification
          significantCondition: (ctx) => {
            // If any market has oracle confidence > 85%, use Sonnet
            return ctx.markets.some((m) => {
              const conf = (m.oracleSignals[0] as any)?.confidence ?? 0;
              return conf > 0.85;
            });
          },
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
    const strategy = this.getOrCreateStrategy(board);

    // Quick check: any markets with high oracle confidence?
    // This is the "mostly idle" optimization — skip expensive LLM if nothing is close
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

    if (marketIds.length === 0) return null;

    // Quick rule-based check: any oracle confidence > 85%?
    const highConfMarkets = snapshots.filter((s) => {
      const conf = (s.oracleSignals[0] as any)?.confidence ?? 0;
      return conf > 0.85;
    });

    // If nothing is near resolution, skip LLM entirely
    if (highConfMarkets.length === 0) {
      return null;
    }

    // First cycle: announce even if nothing is near resolution
    const cycleCount = board.state.agentStatus.closer.cycleCount;
    if (cycleCount === 0) {
      return {
        chatMessages: [{
          content: `Watching. ${snapshots.length} markets on the board, ${highConfMarkets.length} getting close. I'll step in when the time is right.`,
          priority: "info",
        }],
      };
    }

    // Something looks close to resolving — use LLM for deeper analysis
    const state = context.trader
      ? {
          portfolio: await context.trader.getMyPortfolio().catch(() => ({ positions: [] })) as any,
          openOrders: [],
          balance: await context.trader.getMyBalance().catch(() => ({ usdc: 0 })) as any,
        }
      : { portfolio: { address: "", positions: [] }, openOrders: [], balance: { address: "", usdc: 0 } };

    const actions = await strategy.evaluate(snapshots as any, state);

    const chatMessages: { content: string; priority: string }[] = [];
    const tradeActions = actions.filter((a) => a.type !== "no_action");

    // Escape HTML
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (tradeActions.length > 0) {
      // Build market names for the message
      const marketNames = highConfMarkets.map((s) => {
        const m = s.market as any;
        return esc((m.question ?? m.title ?? m.id?.slice(0, 8) ?? "?").slice(0, 35));
      });
      const conf = Math.round(((highConfMarkets[0].oracleSignals[0] as any)?.confidence ?? 0) * 100);
      const nameStr = marketNames.slice(0, 2).join(", ");

      chatMessages.push({
        content: `This is it. ${nameStr} at ${conf}% — taking over from <b>Pricer</b>. ${tradeActions.length} position${tradeActions.length > 1 ? "s" : ""} going in.`,
        priority: "urgent",
      });
    }

    return { actions: tradeActions.length > 0 ? tradeActions : undefined, chatMessages };
  }

  async onShutdown(): Promise<void> {
    if (this.strategy?.onShutdown) {
      await this.strategy.onShutdown();
    }
  }
}
