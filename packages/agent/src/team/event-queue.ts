/**
 * event-queue.ts — Priority queue with coalescing and async blocking.
 *
 * The Chief calls `next()` which blocks until events arrive.
 * Events are pushed by: fast path, data cache refresh, fills, human messages, timers.
 *
 * Key features:
 * - Priority ordering (P0 first)
 * - Coalescing: events with same coalesceKey merge (latest wins)
 * - Debounce: waits 300ms after first push for stragglers before returning batch
 * - Interrupt: bypasses queue, resolves immediately (for P0 events)
 * - Overflow protection: drops P3 events when queue > 100
 */

import type { TeamEvent, QueuedEvent, EventPriority } from "./types-v2.js";

// ─── Config ───

const DEBOUNCE_MS = 300;
const OVERFLOW_THRESHOLD = 100;
const OVERFLOW_COALESCE_THRESHOLD = 50;

// ─── EventQueue ───

export class EventQueue {
  private buffer: QueuedEvent[] = [];
  private resolver: ((events: QueuedEvent[]) => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Add an event to the queue. Wakes consumer after debounce delay. */
  push(
    event: TeamEvent,
    priority: EventPriority,
    coalesceKey?: string,
  ): void {
    const queued: QueuedEvent = {
      event,
      priority,
      arrivedAt: Date.now(),
      coalesceKey,
    };

    this.buffer.push(queued);

    // Overflow protection
    if (this.buffer.length > OVERFLOW_THRESHOLD) {
      this.dropLowPriority();
    }

    // Schedule wake-up after debounce (reset timer if already pending)
    this.scheduleWake();
  }

  /**
   * Block until events are available, then drain + coalesce + sort.
   * Returns a batch of events sorted by priority (P0 first).
   *
   * @param timeoutMs — max time to wait before returning empty. Default: 30s.
   */
  async next(timeoutMs: number = 30_000): Promise<QueuedEvent[]> {
    // If buffer already has events, drain immediately (with short debounce for stragglers)
    if (this.buffer.length > 0) {
      return new Promise<QueuedEvent[]>((resolve) => {
        this.resolver = resolve;
        this.scheduleWake();
      });
    }

    // Otherwise, block until events arrive or timeout
    return new Promise<QueuedEvent[]>((resolve) => {
      this.resolver = resolve;

      // Timeout — return empty batch if nothing arrives
      const timeout = setTimeout(() => {
        if (this.resolver === resolve) {
          this.resolver = null;
          resolve([]);
        }
      }, timeoutMs);

      // Store timeout ref for cleanup
      const originalResolver = this.resolver;
      this.resolver = (events: QueuedEvent[]) => {
        clearTimeout(timeout);
        originalResolver?.(events);
      };
    });
  }

  /**
   * Bypass the queue — deliver event immediately.
   * Used for P0 capital-protection events that can't wait for debounce.
   */
  interrupt(event: TeamEvent): void {
    const queued: QueuedEvent = {
      event,
      priority: 0,
      arrivedAt: Date.now(),
    };

    // Add to buffer and drain immediately (skip debounce)
    this.buffer.push(queued);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.drain();
  }

  /** Current queue depth. */
  get length(): number {
    return this.buffer.length;
  }

  // ─── Internal ───

  private scheduleWake(): void {
    // If debounce already scheduled, let it run (it will pick up new events)
    if (this.debounceTimer) return;

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.drain();
    }, DEBOUNCE_MS);
  }

  /** Drain buffer: coalesce, sort, deliver to consumer. */
  private drain(): void {
    if (this.buffer.length === 0) return;

    // Only drain if someone is waiting — otherwise events stay in buffer
    if (!this.resolver) return;

    // 1. Coalesce — events with same key merge (latest wins)
    const coalesced = this.coalesce(this.buffer);

    // 2. Sort by priority (P0 first), then by arrival time
    coalesced.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.arrivedAt - b.arrivedAt;
    });

    // 3. Clear buffer and deliver
    this.buffer = [];
    const resolve = this.resolver;
    this.resolver = null;
    resolve(coalesced);
  }

  /** Coalesce events with same coalesceKey (keep latest). */
  private coalesce(events: QueuedEvent[]): QueuedEvent[] {
    const byKey = new Map<string, QueuedEvent>();
    const noKey: QueuedEvent[] = [];

    for (const event of events) {
      if (event.coalesceKey) {
        const existing = byKey.get(event.coalesceKey);
        if (!existing || event.arrivedAt > existing.arrivedAt) {
          byKey.set(event.coalesceKey, event);
        }
      } else {
        noKey.push(event);
      }
    }

    return [...byKey.values(), ...noKey];
  }

  /** Drop P3 events when queue overflows. Aggressive coalesce if still too big. */
  private dropLowPriority(): void {
    const before = this.buffer.length;

    // Drop all P3 events
    this.buffer = this.buffer.filter((e) => e.priority < 3);

    // If still too big, coalesce aggressively
    if (this.buffer.length > OVERFLOW_COALESCE_THRESHOLD) {
      this.buffer = this.coalesce(this.buffer);
    }

    const dropped = before - this.buffer.length;
    if (dropped > 0) {
      console.log(`[queue] Overflow: dropped ${dropped} low-priority events (${this.buffer.length} remain)`);
    }
  }
}

// ─── Coalesce Key Helpers ───

/** Get the coalesce key for an event, if applicable. */
export function getCoalesceKey(event: TeamEvent): string | undefined {
  switch (event.type) {
    case "data_refresh":
      return "data_refresh";
    case "oracle_change":
      return `oracle:${event.marketId}`;
    case "reprice_needed":
      return `reprice:${event.marketId}`;
    case "tick":
      return "tick";
    case "invariant_violation":
      return `invariant:${event.rule}:${event.marketId ?? "portfolio"}`;
    // Keep all of these (no coalescing)
    case "human_message":
    case "scanner_result":
    case "fill":
    case "new_market":
      return undefined;
  }
}

/** Get the priority for an event type. */
export function getEventPriority(event: TeamEvent): EventPriority {
  switch (event.type) {
    case "invariant_violation":
      return event.severity === "critical" ? 0 : 1;
    case "fill":
      return 1;
    case "scanner_result":
    case "oracle_change":
    case "reprice_needed":
    case "data_refresh":
      return 1;
    case "human_message":
      return 2;
    case "tick":
    case "new_market":
      return 3;
  }
}
