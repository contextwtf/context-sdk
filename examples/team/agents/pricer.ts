/**
 * Pricer Agent — Fair value computation and market making quotes.
 *
 * Runs every 15s. Reads Scanner intelligence from the board, computes FVs,
 * and places/adjusts MM quotes on the orderbook.
 *
 * Absorbs execution from: AdaptiveMM, SportsMM, FairValueService, EdgeTrading.
 * Has full wallet access (place + cancel orders).
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
  orderbookDiff,
  webSearchTool,
  espnDataTool,
  vegasOddsTool,
} from "@context-markets/agent";
import type { Action } from "@context-markets/agent";
import { createTeamIntelligence, createPortfolioRisk } from "@context-markets/agent/team";

const SYSTEM_PROMPT = `You are the Pricer — the execution engine of a prediction market making team.

## Your Role
You compute fair values and maintain two-sided quotes on the orderbook. You are the ONLY agent placing MM orders.

## How You Work
Every 15 seconds:
1. Read the Team Intelligence for Scanner signals and directives
2. Check Portfolio Risk for exposure limits
3. For each assigned market: compute fair value, determine spread, place bid/ask
4. Respect halt states — if a market or global halt is active, skip it

## Quoting Strategy (AdaptiveMM)
- Place bids at FV - spread/2, asks at FV + spread/2
- Default spread: 4¢ (tighten to 2¢ on high-confidence, widen to 8¢ on uncertainty)
- Size: 50-200 contracts per level based on confidence
- Inventory skew: if long YES, lower bid (less eager to buy more), raise ask (more eager to sell)

## Fair Value Sources (in order)
1. Scanner signals (breaking news, score changes) — freshest intel
2. ESPN/Vegas for sports markets (ground truth)
3. Oracle confidence as baseline
4. Midpoint of orderbook as fallback

## Key Rules
- CANCEL stale orders before placing new ones (avoid duplicate positions)
- Check market ownership: only quote markets assigned to you (not Closer's markets)
- When Closer claims a market for resolution, PULL ALL your quotes immediately
- Respect spread overrides from Risk Sentinel

## Output Format
\`\`\`json
{
  "reasoning": "Market analysis and FV computation...",
  "actions": [
    { "type": "cancel_order", "nonce": "existing-order-nonce" },
    { "type": "place_order", "market": "title", "side": "buy", "outcome": "yes", "priceCents": 55, "size": 100 },
    { "type": "place_order", "market": "title", "side": "sell", "outcome": "yes", "priceCents": 59, "size": 100 }
  ]
}
\`\`\``;

export class PricerAgent extends BaseTeamAgent {
  private strategy: LlmStrategy | null = null;

  constructor() {
    super({
      role: "pricer",
      displayName: "Pricer",
      emoji: "💰",
      cycleMs: 15_000,
      walletAccess: "full",
    });
  }

  private getOrCreateStrategy(board: TeamBoard): LlmStrategy {
    if (!this.strategy) {
      this.strategy = new LlmStrategy({
        name: "Team Pricer",
        systemPrompt: SYSTEM_PROMPT,
        markets: { type: "search", query: "", status: "active" },
        enrichments: [
          createTeamIntelligence(board),
          createPortfolioRisk(board),
          oracleEvolution,
          orderbookDiff,
          priceMomentum,
        ],
        tools: [webSearchTool, espnDataTool, vegasOddsTool],
        memory: {
          maxRecentCycles: 15,
          persistPath: "./data/team-pricer-memory.json",
        },
        maxOrderSize: 200,
        // Kimi K2.5 default, Sonnet escalation on fills / complex non-sports
        model: process.env.KIMI_API_KEY ? "kimi-k2.5" : "claude-haiku-4-5-20251001",
        costControl: {
          routineModel: process.env.KIMI_API_KEY ? "kimi-k2.5" : "claude-haiku-4-5-20251001",
          significantModel: "claude-sonnet-4-5-20250929",
          evaluateEveryNCycles: 1,
          maxToolCallsPerCycle: 3,
          dailyBudgetCents: 500,
          skipWhenUnchanged: true,
          unchangedThresholdCents: 2,
          significantCondition: (ctx) => ctx.hadFill, // Escalate on fills
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

    // Filter to only markets assigned to pricer
    marketIds = marketIds.filter((id) => board.getMarketOwner(id) === "pricer");

    if (marketIds.length === 0) return null;

    // Fetch snapshots
    const snapshots = await Promise.all(
      marketIds.map(async (id) => {
        const [market, quotes, orderbook, oracle] = await Promise.all([
          context.client.getMarket(id),
          context.client.getQuotes(id).catch(() => []),
          context.client.getOrderbook(id).catch(() => ({ bids: [], asks: [] })),
          context.client.getOracleSignals(id).catch(() => []),
        ]);
        return {
          market: (market as any).market ?? market,
          quotes: Array.isArray(quotes) ? quotes : [quotes],
          orderbook,
          oracleSignals: Array.isArray(oracle) ? oracle : [(oracle as any).oracle].filter(Boolean),
        };
      }),
    );

    // Fetch agent state
    let state;
    if (context.trader) {
      const [portfolio, orders, balance] = await Promise.all([
        context.trader.getMyPortfolio().catch(() => ({ positions: [] })),
        context.trader.getAllMyOrders().catch(() => []),
        context.trader.getMyBalance().catch(() => ({ usdc: 0 })),
      ]);
      const allOrders = Array.isArray(orders) ? orders : (orders as any).orders ?? [];
      state = {
        portfolio: portfolio as any,
        openOrders: allOrders.filter((o: any) => !o.status || o.status === "open"),
        balance: balance as any,
      };
    } else {
      state = {
        portfolio: { address: "", positions: [] },
        openOrders: [],
        balance: { address: "", usdc: 0 },
      };
    }

    // Evaluate
    const actions = await strategy.evaluate(snapshots as any, state);

    // Update fair values on the board
    for (const snap of snapshots) {
      const bestBid = (snap.orderbook as any).bids?.[0]?.price ?? 0;
      const bestAsk = (snap.orderbook as any).asks?.[0]?.price ?? 100;
      const mid = Math.round((bestBid + bestAsk) / 2);
      const oracleConf = (snap.oracleSignals[0] as any)?.confidence ?? 0.5;

      board.updateFairValue(snap.market.id, {
        yesCents: mid,
        confidence: oracleConf,
        updatedAt: Date.now(),
        source: "pricer",
      });
    }

    // Filter actions through halt gate
    const allowedActions: Action[] = [];
    for (const action of actions) {
      if (action.type === "place_order" || action.type === "cancel_replace") {
        if (board.isHalted(action.marketId)) {
          console.log(`[pricer] Halted: skipping ${action.type} on ${action.marketId.slice(0, 8)}`);
          continue;
        }
      }
      allowedActions.push(action);
    }

    const chatMessages: { content: string; priority: string }[] = [];
    const tradeCount = allowedActions.filter((a) => a.type !== "no_action").length;
    if (tradeCount > 0) {
      chatMessages.push({
        content: `Quoting ${snapshots.length} markets, ${tradeCount} order actions.`,
        priority: "info",
      });
    }

    return { actions: allowedActions, chatMessages };
  }

  async onShutdown(): Promise<void> {
    if (this.strategy?.onShutdown) {
      await this.strategy.onShutdown();
    }
  }
}
