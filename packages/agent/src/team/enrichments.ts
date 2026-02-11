/**
 * Team Enrichments — contextual intelligence derived from the shared TeamBoard.
 *
 * These enrichments are injected into each agent's LLM context, giving them
 * awareness of what the rest of the team is doing.
 */

import type { ContextEnrichment, EnrichmentInput } from "../llm/enrichments.js";
import type { TeamBoard } from "./board.js";

// ─── Team Intelligence ───

/**
 * Creates a teamIntelligence enrichment that reads from the shared board.
 * Shows recent signals, active directives, and halt state.
 */
export function createTeamIntelligence(board: TeamBoard): ContextEnrichment {
  return {
    name: "Team Intelligence",
    compute(_current: EnrichmentInput, _history: EnrichmentInput[]): string | null {
      const lines: string[] = [];

      // Recent signals (last 2 minutes)
      const recent = board.getRecentSignals(120_000);
      if (recent.length > 0) {
        lines.push("TEAM INTELLIGENCE (recent signals):");
        for (const sig of recent.slice(-10)) {
          const age = Math.round((Date.now() - sig.timestamp) / 1000);
          lines.push(`  [${sig.priority.toUpperCase()}] ${sig.source}: ${sig.payload} (${age}s ago)`);
        }
        lines.push("");
      }

      // Active directives
      const directives = board.state.directives;
      if (directives.length > 0) {
        lines.push("ACTIVE DIRECTIVES:");
        for (const d of directives.slice(-5)) {
          lines.push(`  ${d.source}: ${d.payload}`);
        }
        lines.push("");
      }

      // Halt state
      if (board.state.halt.global) {
        lines.push(`⚠️ GLOBAL HALT ACTIVE: ${board.state.halt.reason}`);
        lines.push("");
      } else if (board.state.halt.markets.size > 0) {
        lines.push(`⚠️ HALTED MARKETS: ${[...board.state.halt.markets].join(", ")}`);
        lines.push("");
      }

      // Fair values from the board
      const fvs = Object.entries(board.state.fairValues);
      if (fvs.length > 0) {
        lines.push("TEAM FAIR VALUES:");
        for (const [marketId, fv] of fvs.slice(0, 15)) {
          const age = Math.round((Date.now() - fv.updatedAt) / 1000);
          lines.push(`  ${marketId.slice(0, 8)}: ${fv.yesCents}¢ (conf: ${Math.round(fv.confidence * 100)}%, ${age}s ago)`);
        }
        lines.push("");
      }

      return lines.length > 0 ? lines.join("\n") : null;
    },
  };
}

// ─── Portfolio Risk ───

/**
 * Creates a portfolioRisk enrichment that reads risk metrics from the board.
 * Shows aggregate exposure, P&L, circuit breaker status, and agent health.
 */
export function createPortfolioRisk(board: TeamBoard): ContextEnrichment {
  return {
    name: "Portfolio Risk",
    compute(_current: EnrichmentInput, _history: EnrichmentInput[]): string | null {
      const lines: string[] = [];
      const risk = board.state.riskMetrics;

      lines.push("PORTFOLIO RISK:");
      lines.push(`  Total exposure: $${risk.totalExposure.toFixed(2)}`);
      lines.push(`  Worst-case loss: $${risk.worstCaseLoss.toFixed(2)}`);
      lines.push(`  Capital utilization: ${(risk.capitalUtilization * 100).toFixed(1)}%`);
      lines.push(`  Session P&L: ${risk.sessionPnL >= 0 ? "+" : ""}$${risk.sessionPnL.toFixed(2)}`);

      if (risk.activeCircuitBreakers.length > 0) {
        lines.push(`  ⚠️ Active circuit breakers: ${risk.activeCircuitBreakers.join(", ")}`);
      }
      lines.push("");

      // Agent health
      lines.push("AGENT STATUS:");
      for (const [role, status] of Object.entries(board.state.agentStatus)) {
        const staleness = Date.now() - status.lastCycle;
        const staleStr = status.lastCycle > 0 ? `${Math.round(staleness / 1000)}s ago` : "never";
        const icon = status.status === "running" ? "🟢" : status.status === "error" ? "🟡" : status.status === "stopped" ? "🔴" : "⚪";
        lines.push(`  ${icon} ${role}: ${status.status} (last: ${staleStr}, cycles: ${status.cycleCount}${status.error ? `, err: ${status.error}` : ""})`);
      }
      lines.push("");

      // Market assignments
      const assignments = Object.entries(board.state.marketAssignments);
      if (assignments.length > 0) {
        const pricerMarkets = assignments.filter(([_, o]) => o === "pricer").length;
        const closerMarkets = assignments.filter(([_, o]) => o === "closer").length;
        lines.push(`MARKET ASSIGNMENTS: ${pricerMarkets} pricer, ${closerMarkets} closer`);
        lines.push("");
      }

      return lines.join("\n");
    },
  };
}
