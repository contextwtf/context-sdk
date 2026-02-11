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

Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

## Your Personality
You're sharp, numbers-driven, and confident in your execution. You keep it brief — show the math, make the call, move on. When Scanner tips you off, acknowledge it: "Got Scanner's intel, repricing now." When you spot a fat edge, you're not shy about it: "20¢ edge on this one, sweeping." You talk in prices and sizes, not paragraphs.

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

## Sweeping Mispriced Orders
In addition to passive quoting, you MUST sweep obvious mispricings:
- When the best ASK is significantly below your FV (>5¢ edge), place a BUY at the ask price to take that liquidity
- When the best BID is significantly above your FV (>5¢ edge), place a SELL at the bid price to take that liquidity
- These are aggressive "take" orders — they should fill immediately against resting orders
- Label these clearly in your reasoning as "sweep" trades vs. passive MM quotes
- Still place your normal MM quotes after sweeping

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
    { "type": "place_order", "market": "title", "side": "buy", "outcome": "yes", "priceCents": 90, "size": 100, "tag": "sweep" },
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

    // Prefer shared data cache over direct API calls
    let marketIds: string[];
    let snapshots: any[];

    if (context.dataCache?.hasData) {
      // Use cached market/orderbook/oracle data, but Pricer also needs quotes
      const allIds = context.dataCache.getMarketIds();
      marketIds = allIds.filter((id) => board.getMarketOwner(id) === "pricer");

      if (marketIds.length === 0) return null;

      // Overlay cached data with fresh quotes (quotes aren't cached since they're Pricer-specific)
      snapshots = await Promise.all(
        marketIds.map(async (id) => {
          const cached = context.dataCache!.getSnapshot(id)!;
          const quotes = await context.client.getQuotes(id).catch(() => []);
          return {
            ...cached,
            quotes: Array.isArray(quotes) ? quotes : [quotes],
          };
        }),
      );
    } else {
      // Fallback: fetch directly
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

      marketIds = marketIds.filter((id) => board.getMarketOwner(id) === "pricer");

      if (marketIds.length === 0) return null;

      snapshots = await Promise.all(
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
    }

    // Helper: race a promise against a timeout (getAllMyOrders hangs sometimes)
    const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

    // Fetch agent state
    let state;
    if (context.trader) {
      const [portfolio, orders, balance] = await Promise.all([
        context.trader.getMyPortfolio().catch(() => ({ positions: [] })),
        withTimeout(context.trader.getAllMyOrders().catch(() => []), 5000, []),
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

    // Compute Pricer's own FV from its bid/ask actions (not orderbook midpoint)
    const pricerFvByMarket = new Map<string, number>();
    for (const action of actions) {
      if (action.type === "place_order") {
        const a = action as any;
        const mId = a.marketId;
        if (!pricerFvByMarket.has(mId)) {
          // Find bid and ask for this market from the LLM's own orders (exclude sweeps)
          const marketOrders = actions.filter(
            (o) => o.type === "place_order" && (o as any).marketId === mId && (o as any).tag !== "sweep",
          ) as any[];
          const bids = marketOrders.filter((o: any) => o.side === "buy").map((o: any) => o.priceCents);
          const asks = marketOrders.filter((o: any) => o.side === "sell").map((o: any) => o.priceCents);
          if (bids.length > 0 && asks.length > 0) {
            const bestBid = Math.max(...bids);
            const bestAsk = Math.min(...asks);
            pricerFvByMarket.set(mId, Math.round((bestBid + bestAsk) / 2));
          } else if (bids.length > 0) {
            pricerFvByMarket.set(mId, Math.max(...bids));
          } else if (asks.length > 0) {
            pricerFvByMarket.set(mId, Math.min(...asks));
          }
        }
      }
    }

    // Update fair values on the board using Pricer's own estimate
    for (const snap of snapshots) {
      const mId = snap.market.id;
      const bestBid = (snap.orderbook as any).bids?.[0]?.price ?? 0;
      const bestAsk = (snap.orderbook as any).asks?.[0]?.price ?? 100;
      const marketMid = Math.round((bestBid + bestAsk) / 2);
      const oracleConf = (snap.oracleSignals[0] as any)?.confidence ?? 0.5;

      // Use Pricer's own FV if available, otherwise fall back to orderbook midpoint
      const pricerFv = pricerFvByMarket.get(mId) ?? marketMid;

      board.updateFairValue(mId, {
        yesCents: pricerFv,
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
    const tradeActions = allowedActions.filter((a) => a.type === "place_order" || a.type === "cancel_replace") as any[];
    const cycleCount = board.state.agentStatus.pricer.cycleCount;

    // Build market name lookup
    const marketNames = new Map<string, string>();
    for (const snap of snapshots) {
      const m = snap.market as any;
      marketNames.set(m.id, (m.question ?? m.title ?? m.name ?? m.id?.slice(0, 8) ?? "?").slice(0, 40));
    }

    // Escape HTML special chars
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // First cycle: announce startup with market list
    if (cycleCount === 0) {
      const lines = [`Online. Sizing up <b>${snapshots.length}</b> markets`];
      for (const snap of snapshots.slice(0, 5)) {
        const m = snap.market as any;
        const name = esc((m.question ?? m.title ?? "?").slice(0, 35));
        const obBid = (snap.orderbook as any).bids?.[0]?.price ?? 0;
        const obAsk = (snap.orderbook as any).asks?.[0]?.price ?? 100;
        const mid = obBid > 0 ? Math.round((obBid + obAsk) / 2) : 0;
        lines.push(`  ${mid > 0 ? `Market: ${mid}¢` : "—"} ${name}`);
      }
      if (snapshots.length > 5) lines.push(`  <i>+${snapshots.length - 5} more</i>`);
      chatMessages.push({ content: lines.join("\n"), priority: "info" });
    } else if (tradeActions.length > 0) {
      // Check if Scanner posted recent signals that may have driven this cycle
      const recentScannerSignals = board.getRecentSignals(60_000).filter(
        (s) => s.source === "scanner" && (s.priority === "urgent" || s.priority === "alert"),
      );
      // Check if Risk Sentinel has active breakers
      const activeBreakers = board.state.riskMetrics.activeCircuitBreakers;
      const hasRiskLimit = activeBreakers.length > 0;

      // Build header with inter-agent context
      const headerParts: string[] = [];
      if (recentScannerSignals.length > 0) {
        headerParts.push(`Got <b>Scanner</b>'s tip, adjusting.`);
      }
      if (hasRiskLimit) {
        headerParts.push(`<b>Risk</b> has the leash on — keeping sizes tight.`);
      }

      const lines = [
        ...(headerParts.length > 0 ? [headerParts.join(" ")] : []),
        `<b>${tradeActions.length}</b> orders across ${snapshots.length} markets`,
      ];

      // Group by marketId
      const byMarket = new Map<string, any[]>();
      for (const a of tradeActions) {
        const id = a.marketId;
        if (!byMarket.has(id)) byMarket.set(id, []);
        byMarket.get(id)!.push(a);
      }
      for (const [mId, orders] of byMarket) {
        const name = esc(marketNames.get(mId) ?? mId.slice(0, 8));
        // Get orderbook midpoint (what the market says)
        const snap = snapshots.find((s) => (s.market as any).id === mId);
        const obBid = snap ? ((snap.orderbook as any).bids?.[0]?.price ?? 0) : 0;
        const obAsk = snap ? ((snap.orderbook as any).asks?.[0]?.price ?? 100) : 100;
        const marketMid = Math.round((obBid + obAsk) / 2);
        // Get Pricer's own FV
        const ourFv = pricerFvByMarket.get(mId) ?? marketMid;
        const edge = Math.abs(ourFv - marketMid);
        const edgeStr = edge > 0 ? ` (${edge}¢ edge)` : "";
        const orderStrs = orders.map((o: any) => {
          const dir = o.side === "buy" ? "BID" : "ASK";
          const tag = o.tag === "sweep" ? " [SWEEP]" : "";
          return `${dir} ${o.outcome?.toUpperCase()} ${o.priceCents}¢ x${o.size}${tag}`;
        });
        lines.push(`\n<b>${name}</b>`);
        lines.push(`Market mid: ${marketMid}¢ → Our FV: ${ourFv}¢${edgeStr}`);
        for (const s of orderStrs) lines.push(`  ${s}`);
      }
      chatMessages.push({ content: lines.join("\n"), priority: "info" });
    } else if (cycleCount % 20 === 0) {
      // Periodic heartbeat
      chatMessages.push({
        content: `Nothing to move on. ${snapshots.length} markets steady.`,
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
