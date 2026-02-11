/**
 * run-team-v2.ts — Entry point for the event-driven MM Team v2.
 *
 * Key differences from v1:
 * - One smart coordinator (Chief) with specialized functions, not five independent agents
 * - Event-driven, not timer-driven
 * - Fast path handles mechanical responses in <100ms
 * - Chief only runs when events arrive
 *
 * Env vars:
 *   ANTHROPIC_API_KEY=sk-ant-...     (required for escalation model)
 *   KIMI_API_KEY=...                 (required for routine model)
 *   CONTEXT_API_KEY=ctx_pk_...       (required for live mode)
 *   CONTEXT_PRIVATE_KEY=0x...        (required for live mode)
 *   TAVILY_API_KEY=tvly-...          (optional — web search for scanner)
 *   TELEGRAM_BOT_TOKEN=...           (optional — enables Telegram)
 *   TELEGRAM_CHAT_ID=...             (optional — Telegram group chat)
 *   DRY_RUN=true                     (default: true)
 *
 * Usage:
 *   npx tsx examples/team/run-team-v2.ts
 *   DRY_RUN=false npx tsx examples/team/run-team-v2.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env file
const envPath = resolve(process.cwd(), ".env");
try {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

import type { Hex } from "viem";
import { ConsoleChatBridge, RuntimeV2, type ChatBridge } from "@context-markets/agent/team";
import { TelegramBridge } from "./telegram-bridge.js";

// ─── Scanner Tool Definitions ───

const SCANNER_TOOLS = [
  {
    name: "web_search",
    description: "Search the web for current information about a topic. Use for scores, news, data releases.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
];

// ─── Scanner Tool Executor ───

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "web_search") {
    const query = input.query as string;
    if (!process.env.TAVILY_API_KEY) {
      return "Web search not available — TAVILY_API_KEY not set";
    }
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          max_results: 5,
          include_answer: true,
        }),
      });
      const data = await response.json() as any;
      const answer = data.answer ?? "";
      const results = (data.results ?? [])
        .slice(0, 3)
        .map((r: any) => `- ${r.title}: ${r.content?.slice(0, 200)}`)
        .join("\n");
      return `Answer: ${answer}\n\nResults:\n${results}`;
    } catch (err) {
      return `Search error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return `Unknown tool: ${name}`;
}

// ─── Main ───

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

  // Need at least one LLM API key
  if (!process.env.KIMI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.error("KIMI_API_KEY or ANTHROPIC_API_KEY is required");
    process.exit(1);
  }

  // ─── Set Up Chat Bridge ───

  let chatBridge: ChatBridge;

  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const chiefToken = process.env.TELEGRAM_BOT_TOKEN_CHIEF ?? process.env.TELEGRAM_BOT_TOKEN;
  const deskToken = process.env.TELEGRAM_BOT_TOKEN_DESK ?? process.env.TELEGRAM_BOT_TOKEN_SCANNER;

  if (chiefToken && telegramChatId) {
    chatBridge = new TelegramBridge({
      botTokens: {
        chief: chiefToken,
        ...(deskToken ? { desk: deskToken } : {}),
      } as any,
      fallbackToken: chiefToken,
      chatId: telegramChatId,
      verbosity: "normal",
    });
    console.log(`[team-v2] Telegram: Chief + ${deskToken ? "Desk" : "single-bot"}`);
  } else {
    chatBridge = new ConsoleChatBridge();
    console.log("[team-v2] Using console bridge (set TELEGRAM_BOT_TOKEN_CHIEF + TELEGRAM_CHAT_ID for Telegram)");
  }

  // ─── Determine Models ───

  const routineModel = process.env.KIMI_API_KEY ? "kimi-k2.5" : "claude-haiku-4-5-20251001";
  const escalationModel = "claude-sonnet-4-5-20250929";

  // ─── Create Runtime ───

  const runtime = new RuntimeV2({
    trader: traderConfig,
    chatBridge,
    dryRun,
    riskLimits: {
      maxPositionPerMarket: 500,
      maxTotalExposure: 0.80,
      maxCapitalUtilization: 0.80,
      maxLossPerMarket: 50,
      maxDailyLoss: 100,
      minSpread: 2,
      maxSpread: 30,
      minSize: 5,
    },
    cachePollIntervalMs: 30_000,
    reconcileIntervalMs: 30_000,
    heartbeatIntervalMs: 30_000,
    fastPathConfig: {
      tier1Threshold: 2,
      tier2Threshold: 8,
      tier3Threshold: 20,
      skewFactor: 0.5,
      minSize: 5,
      defaultMaxSize: 100,
    },
    llmConfig: {
      routineModel,
      escalationModel,
      maxToolCallsPerCycle: 4,
      dailyBudgetCents: 300,
    },
    scannerTools: SCANNER_TOOLS as any,
    executeTool,
  });

  // ─── Banner ───

  const W = 40;
  const pad = (label: string, val: string) => {
    const content = `  ${label}${val}`;
    return `║${content.padEnd(W - 2)}║`;
  };
  console.log(`╔${"═".repeat(W - 2)}╗`);
  console.log(pad("", "Context Markets — MM Team v2"));
  console.log(`╠${"═".repeat(W - 2)}╣`);
  console.log(pad("Mode:      ", dryRun ? "DRY RUN (no orders)" : "LIVE TRADING"));
  console.log(pad("Arch:      ", "Event-driven"));
  console.log(pad("Fast Path: ", "<100ms mechanical"));
  console.log(pad("Chief:     ", "Event-triggered LLM"));
  console.log(pad("Chat:      ", chiefToken ? (deskToken ? "Telegram (2-bot)" : "Telegram") : "Console"));
  console.log(pad("Search:    ", process.env.TAVILY_API_KEY ? "Enabled" : "DISABLED"));
  console.log(pad("Routine:   ", routineModel));
  console.log(pad("Escalate:  ", escalationModel.slice(0, 22)));
  console.log(`╚${"═".repeat(W - 2)}╝`);
  console.log("");
  console.log("Components:");
  console.log("  FastPath       — Mechanical response (<100ms)");
  console.log("  EventQueue     — Priority queue with coalescing");
  console.log("  ChiefGateway   — Event-driven LLM brain");
  console.log("  ScannerWorker  — Stateless research dispatch");
  console.log("  Reconciliation — Platform state sync (30s)");
  console.log("  SharedDataCache — Market data polling (30s)");
  console.log("");
  console.log("Press Ctrl+C to stop\n");

  // ─── Start ───

  await runtime.start();
}

main().catch(console.error);
