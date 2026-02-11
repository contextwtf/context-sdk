/**
 * ChatBridge — Interface for human interaction via Telegram / Discord.
 *
 * The bridge receives human messages from a chat platform and routes them
 * to the TeamRuntime. Agents post updates back through the bridge.
 */

import type { AgentRole } from "./board.js";

// ─── Interface ───

export interface ChatBridge {
  /** Post a normal message to the chat channel. `role` identifies which agent is sending. */
  send(role: AgentRole, prefix: string, content: string): Promise<void>;
  /** Post a high-visibility alert (e.g., @channel mention). `role` identifies which agent sends. */
  alert(role: AgentRole, content: string): Promise<void>;
  /** Register a handler for incoming human messages. */
  onMessage(handler: (content: string, mentionedAgent?: string) => void): void;
  /** Start listening for messages. */
  start(): Promise<void>;
  /** Stop listening. */
  stop(): Promise<void>;
}

// ─── Console Bridge (for development / headless mode) ───

export class ConsoleChatBridge implements ChatBridge {
  private handler?: (content: string, mentionedAgent?: string) => void;

  async send(_role: AgentRole, prefix: string, content: string): Promise<void> {
    console.log(`[chat] ${prefix}: ${content}`);
  }

  async alert(_role: AgentRole, content: string): Promise<void> {
    console.log(`[chat] 🚨 ALERT: ${content}`);
  }

  onMessage(handler: (content: string, mentionedAgent?: string) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    console.log("[chat] Console bridge active (no Telegram)");
  }

  async stop(): Promise<void> {
    // noop
  }

  /** Manually inject a message (for testing). */
  injectMessage(content: string, mentionedAgent?: string): void {
    this.handler?.(content, mentionedAgent);
  }
}
