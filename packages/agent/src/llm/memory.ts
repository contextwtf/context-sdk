/**
 * Agent Memory System
 *
 * Provides persistent memory for LLM-powered strategies:
 * - Recent cycle records (snapshots summary, actions, reasoning)
 * - Trade journal (fill history with P&L tracking)
 * - Working memory (LLM-accessible key-value store via tools)
 * - Disk persistence (optional)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChatMessage } from "./client.js";

// ─── Types ───

export interface MemoryOptions {
  /** How many recent cycles to keep in context. Default: 10. */
  maxRecentCycles?: number;
  /** Max trade journal entries. Default: 100. */
  maxTradeJournal?: number;
  /** File path for disk persistence. Omit for in-memory only. */
  persistPath?: string;
}

export interface CycleRecord {
  cycle: number;
  timestamp: number;
  /** Brief summary of market state this cycle. */
  marketSummary: string;
  /** Actions the LLM decided to take. */
  actions: string[];
  /** The LLM's reasoning for its decisions. */
  reasoning: string;
}

export interface TradeRecord {
  timestamp: number;
  marketId: string;
  marketTitle: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  size: number;
  priceCents: number;
  type: "full" | "partial";
}

interface MemoryState {
  recentCycles: CycleRecord[];
  tradeJournal: TradeRecord[];
  workingMemory: Record<string, string>;
}

// ─── AgentMemory ───

export class AgentMemory {
  private readonly maxRecentCycles: number;
  private readonly maxTradeJournal: number;
  private readonly persistPath?: string;

  private _recentCycles: CycleRecord[] = [];
  private _tradeJournal: TradeRecord[] = [];
  private _workingMemory = new Map<string, string>();

  constructor(options: MemoryOptions = {}) {
    this.maxRecentCycles = options.maxRecentCycles ?? 10;
    this.maxTradeJournal = options.maxTradeJournal ?? 100;
    this.persistPath = options.persistPath;
  }

  get recentCycles(): readonly CycleRecord[] {
    return this._recentCycles;
  }

  get tradeJournal(): readonly TradeRecord[] {
    return this._tradeJournal;
  }

  // ─── Cycle Management ───

  addCycle(record: CycleRecord): void {
    this._recentCycles.push(record);
    if (this._recentCycles.length > this.maxRecentCycles) {
      this._recentCycles.shift();
    }
  }

  // ─── Trade Journal ───

  addTrade(trade: TradeRecord): void {
    this._tradeJournal.push(trade);
    if (this._tradeJournal.length > this.maxTradeJournal) {
      this._tradeJournal.shift();
    }
  }

  // ─── Working Memory (LLM-accessible) ───

  get(key: string): string | undefined {
    return this._workingMemory.get(key);
  }

  set(key: string, value: string): void {
    this._workingMemory.set(key, value);
  }

  delete(key: string): boolean {
    return this._workingMemory.delete(key);
  }

  listKeys(): string[] {
    return Array.from(this._workingMemory.keys());
  }

  // ─── Context Serialization ───

  /** Convert memory to a context string for the LLM. */
  getContextString(): string {
    const parts: string[] = [];

    // Recent cycles
    if (this._recentCycles.length > 0) {
      parts.push("RECENT HISTORY:");
      // Show last 3-5 cycles in detail
      const shown = this._recentCycles.slice(-5);
      for (const cycle of shown) {
        const time = new Date(cycle.timestamp).toLocaleTimeString();
        const actions = cycle.actions.length > 0
          ? cycle.actions.join("; ")
          : "no action";
        parts.push(`  Cycle ${cycle.cycle} (${time}): ${actions}`);
        if (cycle.reasoning) {
          parts.push(`    Reasoning: ${cycle.reasoning.slice(0, 200)}`);
        }
      }
      parts.push("");
    }

    // Trade journal summary
    if (this._tradeJournal.length > 0) {
      parts.push("RECENT FILLS:");
      const recentTrades = this._tradeJournal.slice(-10);
      for (const trade of recentTrades) {
        const time = new Date(trade.timestamp).toLocaleTimeString();
        parts.push(
          `  ${time}: ${trade.type === "full" ? "FILLED" : "PARTIAL"} ${trade.side.toUpperCase()} ${trade.size} ${trade.outcome.toUpperCase()} "${trade.marketTitle}" @ ${trade.priceCents}¢`,
        );
      }
      parts.push("");
    }

    // Working memory
    if (this._workingMemory.size > 0) {
      parts.push("WORKING MEMORY:");
      for (const [key, value] of this._workingMemory) {
        parts.push(`  ${key}: ${value.slice(0, 300)}`);
      }
      parts.push("");
    }

    return parts.join("\n");
  }

  /** Convert recent cycles to chat message pairs for conversational context. */
  getContextMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [];
    // Last 3 cycles as user/assistant pairs
    const shown = this._recentCycles.slice(-3);
    for (const cycle of shown) {
      messages.push({
        role: "user",
        content: `[Cycle ${cycle.cycle}] ${cycle.marketSummary}`,
      });
      const actions = cycle.actions.length > 0
        ? cycle.actions.join("\n")
        : "No action taken.";
      messages.push({
        role: "assistant",
        content: `${cycle.reasoning}\n\nActions:\n${actions}`,
      });
    }
    return messages;
  }

  // ─── Persistence ───

  async save(): Promise<void> {
    if (!this.persistPath) return;

    const state: MemoryState = {
      recentCycles: this._recentCycles,
      tradeJournal: this._tradeJournal,
      workingMemory: Object.fromEntries(this._workingMemory),
    };

    await mkdir(dirname(this.persistPath), { recursive: true });
    await writeFile(this.persistPath, JSON.stringify(state, null, 2));
  }

  async load(): Promise<void> {
    if (!this.persistPath) return;

    try {
      const raw = await readFile(this.persistPath, "utf-8");
      const state: MemoryState = JSON.parse(raw);

      this._recentCycles = state.recentCycles ?? [];
      this._tradeJournal = state.tradeJournal ?? [];
      this._workingMemory = new Map(Object.entries(state.workingMemory ?? {}));
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
  }
}
