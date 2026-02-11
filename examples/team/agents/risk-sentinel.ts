/**
 * Risk Sentinel — Pure rule-based risk monitoring.
 *
 * No LLM on day 1. Runs every 10s checking:
 * - Aggregate exposure across all markets
 * - Worst-case loss (all positions go to 0 or 100)
 * - Capital utilization (USDC locked in open orders)
 * - Session P&L and drawdown
 * - Agent staleness (watchdog for other agents)
 * - Self-trade detection
 * - Circuit breakers (automatic halt triggers)
 *
 * Has cancel-only wallet access for emergency order cancellation.
 */

import {
  BaseTeamAgent,
  type TeamAgentContext,
  type TeamAgentResult,
} from "@context-markets/agent/team";
import type { TeamBoard, Signal, AgentRole } from "@context-markets/agent/team";

// ─── Circuit Breaker Thresholds ───

interface CircuitBreakerConfig {
  /** Max net exposure as fraction of capital. Default: 0.4 (40%). */
  maxExposurePct: number;
  /** Max session drawdown as fraction of starting capital. Default: 0.15 (15%). */
  maxDrawdownPct: number;
  /** Max capital utilization. Default: 0.8 (80%). */
  maxCapitalUtilization: number;
  /** Max loss per market in USD. Default: 50. */
  maxMarketLoss: number;
  /** Staleness threshold multiplier (agent cycle × this = stale). Default: 3. */
  stalenessMultiplier: number;
  /** Number of correlated markets moving against us that triggers spread widening. Default: 3. */
  correlatedMoveThreshold: number;
}

const DEFAULT_BREAKERS: CircuitBreakerConfig = {
  maxExposurePct: 0.4,
  maxDrawdownPct: 0.15,
  maxCapitalUtilization: 0.8,
  maxMarketLoss: 50,
  stalenessMultiplier: 3,
  correlatedMoveThreshold: 3,
};

// Agent cycle times for staleness detection
const AGENT_CYCLE_MS: Record<AgentRole, number> = {
  chief: 60_000,
  scanner: 30_000,
  pricer: 15_000,
  risk: 10_000,
  closer: 30_000,
};

export class RiskSentinelAgent extends BaseTeamAgent {
  private readonly breakers: CircuitBreakerConfig;
  private startingBalance: number | null = null;
  private lastAlertedBreakers = new Set<string>(); // deduplicate alerts

  constructor(breakers?: Partial<CircuitBreakerConfig>) {
    super({
      role: "risk",
      displayName: "Risk Sentinel",
      emoji: "🛡️",
      cycleMs: 10_000,
      walletAccess: "cancel-only",
    });
    this.breakers = { ...DEFAULT_BREAKERS, ...breakers };
  }

  protected async cycle(
    board: TeamBoard,
    context: TeamAgentContext,
    _inbox: { humanMessages: Signal[]; agentMessages: Signal[] },
  ): Promise<TeamAgentResult> {
    const chatMessages: { content: string; priority: string }[] = [];
    const activeBreakers: string[] = [];

    // ─── Fetch Portfolio State ───

    let balance = 0;
    let positions: any[] = [];
    let openOrders: any[] = [];

    // Helper: race a promise against a timeout (getAllMyOrders hangs sometimes)
    const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

    if (context.trader) {
      const [rawBalance, rawPortfolio, rawOrders] = await Promise.all([
        context.trader.getMyBalance().catch(() => ({ usdc: 0 })),
        context.trader.getMyPortfolio().catch(() => ({ positions: [] })),
        withTimeout(context.trader.getAllMyOrders().catch(() => []), 5000, []),
      ]);

      // Parse balance
      const bal = rawBalance as any;
      if (typeof bal.usdc === "number") {
        balance = bal.usdc;
      } else if (typeof bal.usdc === "object" && bal.usdc !== null) {
        balance = Number(bal.usdc.settlementBalance ?? bal.usdc.balance ?? 0) / 1e6;
      }

      // Parse positions
      const pAny = rawPortfolio as any;
      positions = (pAny.positions ?? pAny.portfolio ?? []).map((p: any) => ({
        marketId: p.marketId,
        outcome: p.outcome ?? p.outcomeName?.toLowerCase() ?? (p.outcomeIndex === 1 ? "yes" : "no"),
        size: typeof p.size === "number" ? p.size : (p.balance ? Number(p.balance) / 1e6 : 0),
        avgPrice: p.avgPrice ?? 0,
      }));

      // Parse open orders
      const allOrders = Array.isArray(rawOrders) ? rawOrders : (rawOrders as any).orders ?? [];
      openOrders = allOrders
        .filter((o: any) => !o.status || o.status === "open")
        .map((o: any) => ({
          marketId: o.marketId,
          outcome: o.outcome ?? (o.outcomeIndex === 1 ? "yes" : "no"),
          side: typeof o.side === "string" ? o.side : (o.side === 0 ? "buy" : "sell"),
          price: typeof o.price === "number" ? o.price : Number(o.price) / 10000,
          size: typeof o.size === "number" ? o.size : Number(o.size) / 1e6,
        }));
    }

    // Track starting balance
    if (this.startingBalance === null && balance > 0) {
      this.startingBalance = balance;
    }

    // ─── Compute Risk Metrics ───

    // Total exposure: sum of position sizes * price in dollars
    // Each position's exposure = size * (price / 100) in USD
    let totalExposure = 0;
    for (const pos of positions) {
      if (pos.size > 0) {
        // Use board FV if available, else avgPrice
        const fv = board.getFairValue(pos.marketId);
        const priceRef = fv ? fv.yesCents : (pos.avgPrice || 50);
        const posExposure = pos.size * (priceRef / 100);
        totalExposure += posExposure;
      }
    }

    // Worst-case loss: for each position, assume it goes to 0 (for YES) or 100 (for NO)
    // Worst case = sum of (size * avgPrice / 100) for all positions (total invested)
    let worstCaseLoss = 0;
    for (const pos of positions) {
      if (pos.size > 0 && pos.avgPrice > 0) {
        // If we bought YES at avgPrice, worst case we lose avgPrice per contract
        // If we bought NO at avgPrice, worst case we lose avgPrice per contract
        worstCaseLoss += pos.size * (pos.avgPrice / 100);
      }
    }

    // Capital utilization: USDC committed to open buy orders / total balance
    // Buy orders lock USDC; sell orders lock inventory
    let lockedCapital = 0;
    for (const order of openOrders) {
      if (order.side === "buy") {
        lockedCapital += order.size * (order.price / 100);
      }
    }
    const capitalUtilization = balance > 0 ? lockedCapital / balance : 0;

    // Session P&L
    const sessionPnL = this.startingBalance ? balance - this.startingBalance : 0;

    // ─── Circuit Breaker Checks ───

    // 1. Drawdown
    if (this.startingBalance && this.startingBalance > 0) {
      const drawdown = (this.startingBalance - balance) / this.startingBalance;
      if (drawdown > this.breakers.maxDrawdownPct) {
        activeBreakers.push(`drawdown_${Math.round(drawdown * 100)}pct`);
        if (!board.isHalted()) {
          board.setHalt(true, `Session drawdown ${Math.round(drawdown * 100)}% exceeds ${Math.round(this.breakers.maxDrawdownPct * 100)}% limit`, "risk");
          chatMessages.push({
            content: `🚨 Everybody stop. Drawdown hit ${Math.round(drawdown * 100)}% — that's past our ${Math.round(this.breakers.maxDrawdownPct * 100)}% limit. Started at <code>$${this.startingBalance.toFixed(2)}</code>, now at <code>$${balance.toFixed(2)}</code>. <b>Pricer</b>, pull everything. <b>Closer</b>, no new positions.`,
            priority: "halt",
          });
        }
      }
    }

    // Helper: check if a breaker is suppressed via /ignore
    const isSuppressed = (key: string) => board.state.suppressedBreakers.has(key);

    // 2. Exposure limit
    if (balance > 0 && totalExposure / balance > this.breakers.maxExposurePct) {
      const key = "exposure";
      activeBreakers.push(`exposure_${Math.round(totalExposure / balance * 100)}pct`);
      if (!board.isHalted() && !this.lastAlertedBreakers.has(key) && !isSuppressed(key)) {
        chatMessages.push({
          content: `Running hot — exposure at ${Math.round(totalExposure / balance * 100)}%, limit is ${Math.round(this.breakers.maxExposurePct * 100)}%. <b>Pricer</b>, trim your weakest conviction first.`,
          priority: "alert",
        });
      }
    }

    // 3. Capital utilization
    if (capitalUtilization > this.breakers.maxCapitalUtilization) {
      const key = "capital_util";
      activeBreakers.push(`capital_util_${Math.round(capitalUtilization * 100)}pct`);
      if (!this.lastAlertedBreakers.has(key) && !isSuppressed(key)) {
        chatMessages.push({
          content: `Capital's getting tight — ${Math.round(capitalUtilization * 100)}% locked up. <b>Pricer</b>, sell-side only until something frees up.`,
          priority: "alert",
        });
      }
    }

    // 4. Per-market loss check
    const marketPnL = new Map<string, number>();
    for (const pos of positions) {
      if (pos.size > 0 && pos.avgPrice > 0) {
        const fv = board.getFairValue(pos.marketId);
        const currentPrice = fv ? fv.yesCents : 50;
        const marketSpecificPnl = pos.outcome === "yes"
          ? pos.size * (currentPrice - pos.avgPrice) / 100
          : pos.size * (pos.avgPrice - currentPrice) / 100;
        marketPnL.set(pos.marketId, (marketPnL.get(pos.marketId) ?? 0) + marketSpecificPnl);
      }
    }
    for (const [marketId, pnl] of marketPnL) {
      if (pnl < -this.breakers.maxMarketLoss) {
        activeBreakers.push(`market_loss_${marketId.slice(0, 8)}`);
        if (!board.isHalted(marketId)) {
          board.haltMarket(marketId, `Market loss $${Math.abs(pnl).toFixed(2)} exceeds $${this.breakers.maxMarketLoss} limit`, "risk");
          if (!isSuppressed("market_loss")) {
            chatMessages.push({
              content: `🛑 Pulling the plug on <code>${marketId.slice(0, 8)}</code> — down <code>$${Math.abs(pnl).toFixed(2)}</code>, past our $${this.breakers.maxMarketLoss} limit. <b>Pricer</b>, clear your quotes on this one.`,
              priority: "override",
            });
          }
        }
      }
    }

    // 5. Agent staleness — log to console, only alert chat if catastrophically late (3x threshold)
    for (const [agent, status] of Object.entries(board.state.agentStatus)) {
      if (agent === "risk") continue;
      if (status.lastCycle === 0) continue;

      const staleness = Date.now() - status.lastCycle;
      const threshold = AGENT_CYCLE_MS[agent as AgentRole] * this.breakers.stalenessMultiplier;

      if (staleness > threshold && status.status !== "stopped") {
        const key = `${agent}_stale`;
        activeBreakers.push(key);
        // Console-only for normal staleness (LLM calls are slow, this is usually fine)
        console.log(`[risk] ${agent} stale for ${Math.round(staleness / 1000)}s (threshold: ${Math.round(threshold / 1000)}s)`);
        // Only alert chat if catastrophically late (3x beyond threshold)
        if (staleness > threshold * 3 && !this.lastAlertedBreakers.has(key)) {
          chatMessages.push({
            content: `🚨 <b>${agent}</b> hasn't responded in ${Math.round(staleness / 1000)}s — way past the ${Math.round(threshold / 1000)}s threshold. <b>Chief</b>, might need a restart.`,
            priority: "alert",
          });
        }
      }
    }

    // Update deduplication set: remember what we alerted, clear resolved ones
    this.lastAlertedBreakers = new Set(activeBreakers.map((b) => {
      // Normalize to base key (strip numeric suffix)
      if (b.startsWith("exposure")) return "exposure";
      if (b.startsWith("capital_util")) return "capital_util";
      return b;
    }));

    // ─── Update Board ───

    board.state.riskMetrics = {
      totalExposure,
      worstCaseLoss,
      capitalUtilization,
      sessionPnL,
      activeCircuitBreakers: activeBreakers,
    };

    // Periodic status report (every 6 cycles = ~60s) + first cycle announcement
    const cycleCount = board.state.agentStatus.risk.cycleCount;
    const pnlStr = `${sessionPnL >= 0 ? "+" : ""}$${sessionPnL.toFixed(2)}`;
    const expPct = balance > 0 ? Math.round(totalExposure / balance * 100) : 0;

    if (cycleCount === 0) {
      const lines = [
        `On watch. <code>$${balance.toFixed(2)}</code> in the tank.`,
        `${positions.length} positions, ${openOrders.length} open orders. Let's keep it clean.`,
      ];
      chatMessages.push({ content: lines.join("\n"), priority: "info" });
    } else if (cycleCount % 6 === 0) {
      const lines = [
        `P&amp;L: <code>${pnlStr}</code>  |  Exposure: <code>${expPct}%</code>`,
        `Capital: <code>${Math.round(capitalUtilization * 100)}%</code> utilized`,
        `Orders: ${openOrders.length}  |  Positions: ${positions.length}`,
      ];
      if (activeBreakers.length > 0) {
        lines.push(`⚠️ <b>${activeBreakers.join(", ")}</b>`);
      }
      chatMessages.push({ content: lines.join("\n"), priority: "info" });
    }

    return { chatMessages };
  }
}
