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

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env file (same pattern as other scripts)
const envPath = resolve(process.cwd(), ".env");
try {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

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

  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const telegramFallback = process.env.TELEGRAM_BOT_TOKEN;

  if ((telegramFallback || process.env.TELEGRAM_BOT_TOKEN_CHIEF) && telegramChatId) {
    // Collect per-agent tokens (only include ones that are explicitly set)
    const botTokens: Partial<Record<string, string>> = {};
    if (process.env.TELEGRAM_BOT_TOKEN_CHIEF) botTokens.chief = process.env.TELEGRAM_BOT_TOKEN_CHIEF;
    if (process.env.TELEGRAM_BOT_TOKEN_SCANNER) botTokens.scanner = process.env.TELEGRAM_BOT_TOKEN_SCANNER;
    if (process.env.TELEGRAM_BOT_TOKEN_PRICER) botTokens.pricer = process.env.TELEGRAM_BOT_TOKEN_PRICER;
    if (process.env.TELEGRAM_BOT_TOKEN_RISK) botTokens.risk = process.env.TELEGRAM_BOT_TOKEN_RISK;
    if (process.env.TELEGRAM_BOT_TOKEN_CLOSER) botTokens.closer = process.env.TELEGRAM_BOT_TOKEN_CLOSER;

    const hasPerAgent = Object.keys(botTokens).length > 0;

    chatBridge = new TelegramBridge({
      botTokens: hasPerAgent ? botTokens as any : undefined,
      fallbackToken: telegramFallback,
      chatId: telegramChatId,
      verbosity: "normal",
    });

    const mode = hasPerAgent ? `multi-bot (${Object.keys(botTokens).length} agent tokens)` : "single-bot";
    console.log(`[team] Telegram bridge configured (${mode})`);
  } else {
    chatBridge = new ConsoleChatBridge();
    console.log("[team] Using console bridge (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID for Telegram)");
  }

  // ─── Create Agents ───

  const agents = {
    risk: new RiskSentinelAgent({ maxMarketLoss: 1000 }),
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
