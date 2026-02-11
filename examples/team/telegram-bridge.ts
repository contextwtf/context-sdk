/**
 * TelegramBridge — grammY-based Telegram bot(s) for the trading desk.
 *
 * One group chat = "The Trading Desk". Supports two modes:
 *   - Multi-bot: each agent has its own bot token → feels like 5 people in a group chat
 *   - Single-bot: one token for all agents → messages prefixed with agent emoji + name
 *
 * Uses HTML parse_mode for reliable formatting (bold, code, etc.).
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN=...           (fallback single bot for all agents)
 *   TELEGRAM_BOT_TOKEN_CHIEF=...     (per-agent bot tokens)
 *   TELEGRAM_BOT_TOKEN_SCANNER=...
 *   TELEGRAM_BOT_TOKEN_PRICER=...
 *   TELEGRAM_BOT_TOKEN_RISK=...
 *   TELEGRAM_BOT_TOKEN_CLOSER=...
 *   TELEGRAM_CHAT_ID=...             (group chat ID)
 */

import type { ChatBridge } from "@context-markets/agent/team";
import type { AgentRole } from "@context-markets/agent/team";

// grammY types — imported dynamically to avoid hard dependency
type BotType = any;

export type VerbosityLevel = "quiet" | "normal" | "verbose";

export interface TelegramBridgeOptions {
  /** Per-agent bot tokens. Missing entries fall back to `fallbackToken`. */
  botTokens?: Partial<Record<AgentRole, string>>;
  /** Single bot token used when per-agent tokens are not set. */
  fallbackToken?: string;
  chatId: string | number;
  verbosity?: VerbosityLevel;
}

const AGENT_MENTIONS: Record<string, AgentRole> = {
  "@scanner": "scanner",
  "@pricer": "pricer",
  "@risk": "risk",
  "@chief": "chief",
  "@closer": "closer",
};

/** All 5 agent roles in the order we initialize bots. */
const ALL_ROLES: AgentRole[] = ["chief", "scanner", "pricer", "risk", "closer"];

/** Escape HTML special chars for Telegram HTML parse mode. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class TelegramBridge implements ChatBridge {
  /** One bot instance per unique token. In single-bot mode all roles map to the same bot. */
  private bots = new Map<string, BotType>();
  /** Maps each agent role to its bot token. */
  private roleTokens = new Map<AgentRole, string>();
  private readonly chatId: number;
  private verbosity: VerbosityLevel;
  private handler?: (content: string, mentionedAgent?: string) => void;
  /** The token whose bot handles incoming messages (Chief's token, or fallback). */
  private listenerToken: string | null = null;
  /** Whether we're running in multi-bot mode (separate tokens per agent). */
  private multiBot = false;

  constructor(options: TelegramBridgeOptions) {
    this.chatId = typeof options.chatId === "string" ? Number(options.chatId) : options.chatId;
    this.verbosity = options.verbosity ?? "normal";

    const perAgent = options.botTokens ?? {};
    const fallback = options.fallbackToken;

    // Resolve which token each role uses
    let uniqueTokens = new Set<string>();
    for (const role of ALL_ROLES) {
      const token = perAgent[role] ?? fallback;
      if (!token) {
        throw new Error(`No bot token for role "${role}". Set TELEGRAM_BOT_TOKEN_${role.toUpperCase()} or TELEGRAM_BOT_TOKEN.`);
      }
      this.roleTokens.set(role, token);
      uniqueTokens.add(token);
    }

    this.multiBot = uniqueTokens.size > 1;

    // Chief's token is the listener
    this.listenerToken = this.roleTokens.get("chief")!;
  }

  private getBot(role: AgentRole): BotType | undefined {
    const token = this.roleTokens.get(role);
    return token ? this.bots.get(token) : undefined;
  }

  async send(role: AgentRole, prefix: string, content: string): Promise<void> {
    const bot = this.getBot(role);
    if (!bot) {
      console.warn(`[telegram] send() called but no bot for role "${role}"`);
      return;
    }

    // Verbosity filter: quiet mode only shows halts + human responses
    if (this.verbosity === "quiet") {
      const isHalt = content.toLowerCase().includes("halt");
      const isHumanResponse = prefix.includes("Chief") && content.toLowerCase().includes("justin");
      if (!isHalt && !isHumanResponse) return;
    }

    // In multi-bot mode the bot's display name IS the agent, so skip the bold prefix.
    // In single-bot mode we need the prefix to distinguish agents.
    const html = this.multiBot
      ? content
      : `<b>${escapeHtml(prefix)}</b>\n${content}`;

    try {
      await bot.api.sendMessage(this.chatId, html, { parse_mode: "HTML" });
    } catch {
      // Fallback to plain text if HTML parsing fails
      try {
        const plain = this.multiBot ? content : `${prefix}\n${content}`;
        await bot.api.sendMessage(this.chatId, plain);
      } catch (err) {
        console.error("[telegram] Failed to send:", (err as Error).message?.slice(0, 200));
      }
    }
  }

  async alert(role: AgentRole, content: string): Promise<void> {
    // Alerts always go through the Risk Sentinel bot
    const bot = this.getBot(role);
    if (!bot) return;
    try {
      await bot.api.sendMessage(this.chatId, content, { parse_mode: "HTML" });
    } catch {
      try {
        await bot.api.sendMessage(this.chatId, content);
      } catch (err) {
        console.error("[telegram] Failed to send alert:", err);
      }
    }
  }

  onMessage(handler: (content: string, mentionedAgent?: string) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    const { Bot } = await import("grammy");

    // Create one Bot instance per unique token
    const uniqueTokens = new Set(this.roleTokens.values());
    for (const token of uniqueTokens) {
      const bot = new Bot(token);
      this.bots.set(token, bot);
    }

    // Register command/message handlers ONLY on the Chief (listener) bot
    const listenerBot = this.bots.get(this.listenerToken!);
    if (listenerBot) {
      listenerBot.command("status", () => this.handler?.("/status"));
      listenerBot.command("positions", () => this.handler?.("/positions"));
      listenerBot.command("pnl", () => this.handler?.("/pnl"));
      listenerBot.command("markets", () => this.handler?.("/markets"));
      listenerBot.command("ignore", (ctx) => {
        const text = ctx.message?.text ?? "";
        const breaker = text.replace(/^\/ignore\s*/, "").trim();
        if (!breaker) {
          this.send("chief", "📊 Desk Chief", "Usage: /ignore <breaker> (e.g., /ignore exposure)").catch(() => {});
          return;
        }
        this.handler?.(`/ignore ${breaker}`);
      });
      listenerBot.command("unignore", (ctx) => {
        const text = ctx.message?.text ?? "";
        const breaker = text.replace(/^\/unignore\s*/, "").trim();
        if (!breaker) {
          this.send("chief", "📊 Desk Chief", "Usage: /unignore <breaker> (e.g., /unignore exposure)").catch(() => {});
          return;
        }
        this.handler?.(`/unignore ${breaker}`);
      });
      listenerBot.command("halt", () => this.handler?.("halt"));
      listenerBot.command("resume", () => this.handler?.("resume"));
      listenerBot.command("verbose", () => {
        this.verbosity = "verbose";
        this.send("chief", "📊 Desk Chief", "Switched to verbose mode.").catch(() => {});
      });
      listenerBot.command("normal", () => {
        this.verbosity = "normal";
        this.send("chief", "📊 Desk Chief", "Switched to normal mode.").catch(() => {});
      });
      listenerBot.command("quiet", () => {
        this.verbosity = "quiet";
        this.send("chief", "📊 Desk Chief", "Switched to quiet mode.").catch(() => {});
      });

      // Handle all text messages (privacy mode disabled)
      listenerBot.on("message:text", (ctx) => {
        const text = ctx.message.text;
        if (!text || text.startsWith("/")) return;

        // Check for @agent mentions
        let mentionedAgent: string | undefined;
        for (const [mention, mentionRole] of Object.entries(AGENT_MENTIONS)) {
          if (text.toLowerCase().includes(mention)) {
            mentionedAgent = mentionRole;
            break;
          }
        }

        this.handler?.(text, mentionedAgent);
      });
    }

    // Start all bots
    const modeLabel = this.multiBot
      ? `multi-bot (${this.bots.size} bots)`
      : "single-bot";

    for (const [token, bot] of this.bots) {
      const isListener = token === this.listenerToken;
      bot.catch((err: Error) => {
        console.error("[telegram] Bot error (non-fatal):", err.message?.slice(0, 200));
      });
      bot.start({
        onStart: () => {
          if (isListener) {
            console.log(`[telegram] Listener bot started (${modeLabel})`);
          } else {
            console.log(`[telegram] Agent bot started`);
          }
        },
      }).catch((err: Error) => {
        console.error("[telegram] Bot polling failed (non-fatal):", err.message?.slice(0, 200));
      });
    }
  }

  async stop(): Promise<void> {
    for (const bot of this.bots.values()) {
      try {
        await bot.stop();
      } catch {}
    }
    this.bots.clear();
    console.log("[telegram] All bots stopped");
  }
}
