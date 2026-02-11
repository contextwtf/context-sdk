/**
 * run-team.ts — Entry point for the Agentic MM Team.
 *
 * Wires up all 5 agents + TeamRuntime + ChatBridge and starts the team.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY=sk-ant-...     (required — LLM calls)
 *   CONTEXT_API_KEY=ctx_pk_...       (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...        (required for live mode)
 *   TAVILY_API_KEY=tvly-...          (required — web search)
 *   ODDS_API_KEY=...                 (optional — Vegas odds)
 *   TELEGRAM_BOT_TOKEN=...           (optional — enables Telegram)
 *   TELEGRAM_CHAT_ID=...             (optional — Telegram group chat)
 *   DRY_RUN=true                     (default: true)
 *
 * Usage:
 *   npx tsx examples/team/run-team.ts
 *   DRY_RUN=false npx tsx examples/team/run-team.ts
 */

import type { Hex } from "viem";
import { TeamRuntime, ConsoleChatBridge, type ChatBridge } from "@context-markets/agent/team";
import { RiskSentinelAgent } from "./agents/risk-sentinel.js";
import { ScannerAgent } from "./agents/scanner.js";
import { PricerAgent } from "./agents/pricer.js";
import { CloserAgent } from "./agents/closer.js";
import { DeskChiefAgent } from "./agents/desk-chief.js";
import { TelegramBridge } from "./telegram-bridge.js";

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = process.env.CONTEXT_PRIVATE_KEY as Hex | undefined;
  const dryRun = process.env.DRY_RUN !== "false";

  const traderConfig =
    apiKey && privateKey
      ? { apiKey, signer: { privateKey } as const }
      : undefined;

  if (!traderConfig && !dryRun) {
    console.error("Live mode requires CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required");
    process.exit(1);
  }

  // ─── Set Up Chat Bridge ───

  let chatBridge: ChatBridge;

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    chatBridge = new TelegramBridge({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      verbosity: "normal",
    });
    console.log("[team] Telegram bridge configured");
  } else {
    chatBridge = new ConsoleChatBridge();
    console.log("[team] Using console bridge (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID for Telegram)");
  }

  // ─── Create Agents ───

  const agents = {
    risk: new RiskSentinelAgent(),
    scanner: new ScannerAgent(),
    pricer: new PricerAgent(),
    closer: new CloserAgent(),
    chief: new DeskChiefAgent(),
  };

  // ─── Create Runtime ───

  const runtime = new TeamRuntime({
    trader: traderConfig,
    agents,
    chatBridge,
    dryRun,
  });

  // ─── Wire Chat → Runtime ───

  chatBridge.onMessage((content, mentionedAgent) => {
    console.log(`[human] ${content}${mentionedAgent ? ` (→ ${mentionedAgent})` : ""}`);
    runtime.routeHumanMessage(content, mentionedAgent as any);
  });

  // ─── Start ───

  console.log("╔══════════════════════════════════════╗");
  console.log("║   Context Markets — MM Trading Team  ║");
  console.log("╠══════════════════════════════════════╣");
  console.log(`║  Mode:    ${dryRun ? "DRY RUN (no orders)" : "🔴 LIVE TRADING"}          ║`);
  console.log(`║  Agents:  5 (Chief, Scanner, Pricer,  ║`);
  console.log(`║           Risk, Closer)               ║`);
  console.log(`║  Chat:    ${process.env.TELEGRAM_BOT_TOKEN ? "Telegram" : "Console"}                     ║`);
  console.log(`║  Search:  ${process.env.TAVILY_API_KEY ? "Enabled" : "DISABLED"}                    ║`);
  console.log(`║  Vegas:   ${process.env.ODDS_API_KEY ? "Enabled" : "Disabled"}                    ║`);
  console.log(`║  LLM:     ${process.env.KIMI_API_KEY ? "Kimi K2.5" : "Claude Haiku"}                  ║`);
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  console.log("Agent cycles:");
  console.log("  🛡️  Risk Sentinel:  10s (pure rule-based)");
  console.log("  💰 Pricer:          15s (LLM + AdaptiveMM)");
  console.log("  🔍 Scanner:         30s (LLM + web search)");
  console.log("  🎯 Closer:          30s (LLM, mostly idle)");
  console.log("  📊 Desk Chief:      60s (LLM coordinator)");
  console.log("");
  console.log("Press Ctrl+C to stop\n");

  await chatBridge.start();
  await runtime.start();
}

main().catch(console.error);
