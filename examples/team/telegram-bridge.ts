/**
 * TelegramBridge — grammY-based Telegram bot for the trading desk.
 *
 * One group chat = "The Trading Desk". Bot posts as each agent using emoji
 * prefixes. Privacy mode disabled so the bot sees all messages.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN=...    (from @BotFather)
 *   TELEGRAM_CHAT_ID=...      (group chat ID)
 */

import type { ChatBridge } from "@context-markets/agent/team";
import type { AgentRole } from "@context-markets/agent/team";

// grammY types — imported dynamically to avoid hard dependency
type BotType = any;

export type VerbosityLevel = "quiet" | "normal" | "verbose";

export interface TelegramBridgeOptions {
  botToken: string;
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

export class TelegramBridge implements ChatBridge {
  private bot: BotType | null = null;
  private readonly botToken: string;
  private readonly chatId: string | number;
  private verbosity: VerbosityLevel;
  private handler?: (content: string, mentionedAgent?: string) => void;

  constructor(options: TelegramBridgeOptions) {
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.verbosity = options.verbosity ?? "normal";
  }

  async send(prefix: string, content: string): Promise<void> {
    if (!this.bot) return;

    // Verbosity filter: quiet mode only shows halts + human responses
    if (this.verbosity === "quiet") {
      const isHalt = content.toLowerCase().includes("halt");
      const isHumanResponse = prefix.includes("Chief") && content.toLowerCase().includes("justin");
      if (!isHalt && !isHumanResponse) return;
    }

    try {
      await this.bot.api.sendMessage(this.chatId, `${prefix}: ${content}`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      // Fallback without markdown if parsing fails
      try {
        await this.bot.api.sendMessage(this.chatId, `${prefix}: ${content}`);
      } catch {
        console.error("[telegram] Failed to send message:", err);
      }
    }
  }

  async alert(content: string): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.sendMessage(this.chatId, content);
    } catch (err) {
      console.error("[telegram] Failed to send alert:", err);
    }
  }

  onMessage(handler: (content: string, mentionedAgent?: string) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    // Dynamic import to avoid requiring grammY as a hard dependency
    const { Bot } = await import("grammy");
    this.bot = new Bot(this.botToken);

    // Register command handlers
    this.bot.command("status", () => this.handler?.("/status"));
    this.bot.command("positions", () => this.handler?.("/positions"));
    this.bot.command("pnl", () => this.handler?.("/pnl"));
    this.bot.command("markets", () => this.handler?.("/markets"));
    this.bot.command("halt", () => this.handler?.("halt"));
    this.bot.command("resume", () => this.handler?.("resume"));
    this.bot.command("verbose", () => {
      this.verbosity = "verbose";
      this.send("📊 Chief", "Switched to verbose mode.").catch(() => {});
    });
    this.bot.command("normal", () => {
      this.verbosity = "normal";
      this.send("📊 Chief", "Switched to normal mode.").catch(() => {});
    });
    this.bot.command("quiet", () => {
      this.verbosity = "quiet";
      this.send("📊 Chief", "Switched to quiet mode.").catch(() => {});
    });

    // Handle all text messages (privacy mode disabled)
    this.bot.on("message:text", (ctx) => {
      const text = ctx.message.text;
      if (!text || text.startsWith("/")) return; // Commands already handled

      // Check for @agent mentions
      let mentionedAgent: string | undefined;
      for (const [mention, role] of Object.entries(AGENT_MENTIONS)) {
        if (text.toLowerCase().includes(mention)) {
          mentionedAgent = role;
          break;
        }
      }

      this.handler?.(text, mentionedAgent);
    });

    // Start polling
    this.bot.start({
      onStart: () => console.log("[telegram] Bot started, listening for messages"),
    });
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      console.log("[telegram] Bot stopped");
    }
  }
}
