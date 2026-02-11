/**
 * TelegramBridge — grammY-based Telegram bot(s) for the trading desk.
 *
 * v2 architecture: Two bots in one group chat.
 *   - Chief bot: conversational (listens for messages, responds to user)
 *   - Desk bot: activity feed (scanner progress, orders, fast path — send-only)
 *
 * v1 compatibility: Still supports the 5-agent multi-bot mode via ALL_ROLES.
 *
 * Uses HTML parse_mode for reliable formatting (bold, code, etc.).
 * Messages are automatically split at 4096 chars (Telegram limit).
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN=...           (fallback single bot for all roles)
 *   TELEGRAM_BOT_TOKEN_CHIEF=...     (Chief bot — listener)
 *   TELEGRAM_BOT_TOKEN_DESK=...      (Desk bot — activity feed, send-only)
 *   TELEGRAM_BOT_TOKEN_SCANNER=...   (v1 per-agent tokens)
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
  /** Per-role bot tokens. Missing entries fall back to `fallbackToken`. */
  botTokens?: Partial<Record<AgentRole, string>>;
  /** Single bot token used when per-role tokens are not set. */
  fallbackToken?: string;
  chatId: string | number;
  verbosity?: VerbosityLevel;
}

/** Telegram max message length. */
const TG_MAX_LEN = 4096;

/** Roles that need tokens. For v2, only chief + desk are used. */
const V2_ROLES: AgentRole[] = ["chief", "desk"];

const AGENT_MENTIONS: Record<string, AgentRole> = {
  "@scanner": "scanner",
  "@pricer": "pricer",
  "@risk": "risk",
  "@chief": "chief",
  "@closer": "closer",
  "@desk": "desk",
};

// ─── HTML Helpers ───

/** Escape HTML special chars for Telegram HTML parse mode. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Split a message into chunks that fit within Telegram's 4096-char limit.
 * Splits on newlines to avoid breaking mid-line.
 */
function splitMessage(text: string): string[] {
  if (text.length <= TG_MAX_LEN) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > TG_MAX_LEN) {
    // Find last newline before the limit
    let splitAt = remaining.lastIndexOf("\n", TG_MAX_LEN);
    if (splitAt <= 0) {
      // No good newline — hard split at limit
      splitAt = TG_MAX_LEN;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt + 1); // +1 to skip the newline
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

// ─── TelegramBridge ───

export class TelegramBridge implements ChatBridge {
  /** One bot instance per unique token. */
  private bots = new Map<string, BotType>();
  /** Maps each role to its bot token. */
  private roleTokens = new Map<AgentRole, string>();
  private readonly chatId: number;
  private verbosity: VerbosityLevel;
  private handler?: (content: string, mentionedAgent?: string) => void;
  /** The token whose bot handles incoming messages (Chief's token). */
  private listenerToken: string | null = null;

  constructor(options: TelegramBridgeOptions) {
    this.chatId = typeof options.chatId === "string" ? Number(options.chatId) : options.chatId;
    this.verbosity = options.verbosity ?? "normal";

    const perRole = options.botTokens ?? {};
    const fallback = options.fallbackToken;

    // Resolve which token each role uses — only require tokens for roles that are provided or fallback
    for (const role of V2_ROLES) {
      const token = perRole[role] ?? fallback;
      if (token) {
        this.roleTokens.set(role, token);
      }
    }

    // Also resolve any v1 roles that have explicit tokens
    for (const role of ["scanner", "pricer", "risk", "closer"] as AgentRole[]) {
      const token = perRole[role] ?? fallback;
      if (token) {
        this.roleTokens.set(role, token);
      }
    }

    if (this.roleTokens.size === 0) {
      throw new Error("No bot tokens configured. Set TELEGRAM_BOT_TOKEN or per-role tokens.");
    }

    // Chief's token is the listener (falls back to any available token)
    this.listenerToken = this.roleTokens.get("chief") ?? fallback ?? null;
  }

  private getBot(role: AgentRole): BotType | undefined {
    const token = this.roleTokens.get(role);
    return token ? this.bots.get(token) : undefined;
  }

  async send(role: AgentRole, prefix: string, content: string): Promise<void> {
    const bot = this.getBot(role);
    if (!bot) {
      // Fall back to chief bot if the requested role isn't configured
      const chiefBot = this.getBot("chief");
      if (!chiefBot) {
        console.warn(`[telegram] No bot for role "${role}" and no chief fallback`);
        return;
      }
      // Send with prefix to identify the source
      return this.sendViaBot(chiefBot, prefix, content, false);
    }

    // In two-bot mode: chief messages are conversational, desk messages are activity
    // Chief bot sends without prefix (its display name is "Chief")
    // Desk bot sends without prefix (its display name is the activity feed)
    const isOwnBot = this.roleTokens.get(role) !== this.roleTokens.get("chief");
    return this.sendViaBot(bot, prefix, content, isOwnBot);
  }

  private async sendViaBot(bot: BotType, prefix: string, content: string, skipPrefix: boolean): Promise<void> {
    // Verbosity filter
    if (this.verbosity === "quiet") {
      const lower = content.toLowerCase();
      const isHalt = lower.includes("halt") || lower.includes("🛑");
      const isAlert = lower.includes("🚨");
      if (!isHalt && !isAlert) return;
    }

    // Build HTML message
    const html = skipPrefix
      ? content
      : `<b>${escapeHtml(prefix)}</b>\n${content}`;

    // Split if needed
    const chunks = splitMessage(html);

    for (const chunk of chunks) {
      try {
        await bot.api.sendMessage(this.chatId, chunk, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      } catch {
        // Fallback to plain text
        const plain = chunk
          .replace(/<b>/g, "").replace(/<\/b>/g, "")
          .replace(/<i>/g, "").replace(/<\/i>/g, "")
          .replace(/<code>/g, "").replace(/<\/code>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        try {
          await bot.api.sendMessage(this.chatId, plain, { disable_web_page_preview: true });
        } catch (err) {
          console.error("[telegram] Failed to send:", (err as Error).message?.slice(0, 200));
        }
      }
    }
  }

  async alert(role: AgentRole, content: string): Promise<void> {
    const bot = this.getBot(role) ?? this.getBot("chief");
    if (!bot) return;

    const chunks = splitMessage(content);
    for (const chunk of chunks) {
      try {
        await bot.api.sendMessage(this.chatId, chunk, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      } catch {
        try {
          await bot.api.sendMessage(this.chatId, chunk, { disable_web_page_preview: true });
        } catch (err) {
          console.error("[telegram] Failed to send alert:", (err as Error).message?.slice(0, 200));
        }
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
    const listenerBot = this.listenerToken ? this.bots.get(this.listenerToken) : undefined;
    if (listenerBot) {
      listenerBot.command("status", () => this.handler?.("/status"));
      listenerBot.command("positions", () => this.handler?.("/positions"));
      listenerBot.command("pnl", () => this.handler?.("/pnl"));
      listenerBot.command("markets", () => this.handler?.("/markets"));
      listenerBot.command("ignore", (ctx: any) => {
        const text = ctx.message?.text ?? "";
        const breaker = text.replace(/^\/ignore\s*/, "").trim();
        if (!breaker) {
          this.send("chief", "Chief", "Usage: /ignore <breaker>").catch(() => {});
          return;
        }
        this.handler?.(`/ignore ${breaker}`);
      });
      listenerBot.command("unignore", (ctx: any) => {
        const text = ctx.message?.text ?? "";
        const breaker = text.replace(/^\/unignore\s*/, "").trim();
        if (!breaker) {
          this.send("chief", "Chief", "Usage: /unignore <breaker>").catch(() => {});
          return;
        }
        this.handler?.(`/unignore ${breaker}`);
      });
      listenerBot.command("halt", () => this.handler?.("halt"));
      listenerBot.command("resume", () => this.handler?.("resume"));
      listenerBot.command("verbose", () => {
        this.verbosity = "verbose";
        this.send("chief", "Chief", "Verbose mode.").catch(() => {});
      });
      listenerBot.command("normal", () => {
        this.verbosity = "normal";
        this.send("chief", "Chief", "Normal mode.").catch(() => {});
      });
      listenerBot.command("quiet", () => {
        this.verbosity = "quiet";
        this.send("chief", "Chief", "Quiet mode — only halts and alerts.").catch(() => {});
      });

      // Handle all text messages
      listenerBot.on("message:text", (ctx: any) => {
        const text = ctx.message.text;
        if (!text || text.startsWith("/")) return;

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

    // Start bots — only the listener bot needs polling, desk is send-only
    const listenerToken = this.listenerToken;
    const roleEntries = Array.from(this.roleTokens.entries());

    for (const [token, bot] of this.bots) {
      const isListener = token === listenerToken;
      const roles = roleEntries.filter(([_, t]) => t === token).map(([r]) => r);
      const roleLabel = roles.join("+");

      bot.catch((err: Error) => {
        console.error(`[telegram] Bot error (${roleLabel}, non-fatal):`, err.message?.slice(0, 200));
      });

      if (isListener) {
        // Listener bot: start long polling
        bot.start({
          onStart: async () => {
            try {
              const me = await bot.api.getMe();
              console.log(`[telegram] Chief bot started: @${me.username} (polling)`);
            } catch {
              console.log(`[telegram] Chief bot started (polling)`);
            }
          },
        }).catch((err: Error) => {
          console.error("[telegram] Chief bot polling failed (non-fatal):", err.message?.slice(0, 200));
        });
      } else {
        // Send-only bots: just verify the token works, don't start polling
        bot.api.getMe().then((me: any) => {
          console.log(`[telegram] Desk bot ready: @${me.username} (send-only)`);
        }).catch((err: Error) => {
          console.error(`[telegram] Desk bot token check failed:`, err.message?.slice(0, 200));
        });
      }
    }
  }

  async stop(): Promise<void> {
    for (const [token, bot] of this.bots) {
      try {
        // Only stop bots that were started with polling
        if (token === this.listenerToken) {
          await bot.stop();
        }
      } catch {}
    }
    this.bots.clear();
    console.log("[telegram] All bots stopped");
  }
}
