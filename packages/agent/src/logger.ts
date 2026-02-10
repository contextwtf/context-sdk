import type { Action, MarketSnapshot, AgentState } from "./strategy.js";
import type { Fill } from "@context-markets/sdk";
import type { RiskCheckResult } from "./risk.js";

export interface LogEntry {
  timestamp: string;
  cycle: number;
  type: "cycle_start" | "evaluation" | "risk_check" | "execution" | "fill" | "error" | "shutdown";
  data: unknown;
}

export class TradeLogger {
  private entries: LogEntry[] = [];
  private cycle = 0;
  private readonly maxEntries = 1000;

  nextCycle(): number {
    return ++this.cycle;
  }

  get currentCycle(): number {
    return this.cycle;
  }

  logCycleStart(markets: MarketSnapshot[]): void {
    this.log("cycle_start", {
      marketsCount: markets.length,
      markets: markets.map((m) => ({
        id: m.market.id,
        title: m.market.title,
        bestBid: m.orderbook.bids[0]?.price,
        bestAsk: m.orderbook.asks[0]?.price,
      })),
    });
  }

  logEvaluation(actions: Action[]): void {
    this.log("evaluation", {
      actionsCount: actions.length,
      actions: actions.map((a) => {
        if (a.type === "no_action") return { type: a.type, reason: a.reason };
        if (a.type === "cancel_order") return { type: a.type, nonce: a.nonce };
        return {
          type: a.type,
          marketId: a.marketId,
          outcome: a.outcome,
          side: a.side,
          priceCents: a.priceCents,
          size: a.size,
        };
      }),
    });
  }

  logRiskCheck(result: RiskCheckResult): void {
    this.log("risk_check", {
      allowed: result.allowed.length,
      blocked: result.blocked.length,
      blockedReasons: result.blocked.map((b) => ({
        action: b.action.type,
        reason: b.reason,
      })),
    });
  }

  logExecution(action: Action, result: unknown): void {
    this.log("execution", {
      action: action.type,
      result,
    });
  }

  logFill(fill: Fill): void {
    this.log("fill", {
      marketId: fill.order.marketId,
      nonce: fill.order.nonce,
      outcome: fill.order.outcome,
      side: fill.order.side,
      fillSize: fill.fillSize,
      type: fill.type,
      previousFilledSize: fill.previousFilledSize,
      currentFilledSize: fill.currentFilledSize,
    });
  }

  logError(error: unknown, context?: string): void {
    this.log("error", {
      context,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  logShutdown(state: AgentState): void {
    this.log("shutdown", {
      openOrders: state.openOrders?.length ?? 0,
      positions: state.portfolio?.positions?.length ?? 0,
      balance: state.balance?.usdc ?? 0,
    });
  }

  getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  private log(type: LogEntry["type"], data: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      cycle: this.cycle,
      type,
      data,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Console output
    const prefix = `[${entry.timestamp}] [cycle:${this.cycle}]`;
    switch (type) {
      case "cycle_start":
        console.log(`${prefix} --- Cycle ${this.cycle} ---`);
        break;
      case "evaluation":
        console.log(
          `${prefix} Strategy: ${(data as { actionsCount: number }).actionsCount} actions`,
        );
        break;
      case "risk_check": {
        const rc = data as { allowed: number; blocked: number; blockedReasons: { action: string; reason: string }[] };
        if (rc.blocked > 0) {
          console.warn(
            `${prefix} Risk: ${rc.blocked} blocked, ${rc.allowed} allowed`,
          );
          for (const b of rc.blockedReasons) {
            console.warn(`${prefix}   BLOCKED: ${b.action} — ${b.reason}`);
          }
        } else {
          console.log(`${prefix} Risk: ${rc.allowed} allowed`);
        }
        break;
      }
      case "execution":
        console.log(
          `${prefix} Executed: ${(data as { action: string }).action}`,
        );
        break;
      case "fill": {
        const f = data as { marketId: string; fillSize: number; type: string; outcome: string; side: string };
        console.log(
          `${prefix} [fill] ${f.type} fill: ${f.fillSize} ${f.outcome}/${f.side} on ${f.marketId.slice(0, 8)}...`,
        );
        break;
      }
      case "error":
        console.error(
          `${prefix} ERROR: ${(data as { message: string }).message}`,
        );
        break;
      case "shutdown":
        console.log(`${prefix} Shutting down`);
        break;
    }
  }
}
