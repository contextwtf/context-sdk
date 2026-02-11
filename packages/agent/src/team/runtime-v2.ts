/**
 * runtime-v2.ts — Wires all v2 components together.
 *
 * Creates and connects: OrderBookState, EventQueue, SharedDataCache,
 * FastPath, ChiefGateway, ReconciliationLoop, ChatBridge.
 */

import type { Hex } from "viem";
import { ContextClient, ContextTrader, type ContextTraderOptions } from "@context-markets/sdk";
import type { ToolDefinition } from "../llm/client.js";
import type { ChatBridge } from "./chat-bridge.js";
import type {
  FastPathAction,
  FastPathConfig,
  LlmConfig,
  RiskLimits,
  TeamEvent,
} from "./types-v2.js";
import { DEFAULT_FAST_PATH_CONFIG, DEFAULT_LLM_CONFIG, DEFAULT_RISK_LIMITS } from "./types-v2.js";
import { OrderBookState } from "./order-book-state.js";
import { EventQueue, getCoalesceKey, getEventPriority } from "./event-queue.js";
import { SharedDataCache, type MarketSnapshot } from "./data-cache.js";
import { FastPath } from "./fast-path.js";
import { ChiefGateway } from "./chief-gateway.js";
import { ReconciliationLoop } from "./reconciliation.js";

// ─── Config ───

export interface RuntimeV2Options {
  /** Trader credentials — shared wallet for all operations. */
  trader?: ContextTraderOptions;
  /** Chat bridge for Telegram / Console. */
  chatBridge?: ChatBridge;
  /** If true, evaluate but never execute orders. Default: false. */
  dryRun?: boolean;
  /** Risk limits. */
  riskLimits?: Partial<RiskLimits>;
  /** Cache poll interval (ms). Default: 30000. */
  cachePollIntervalMs?: number;
  /** Reconciliation interval (ms). Default: 30000. */
  reconcileIntervalMs?: number;
  /** Heartbeat interval (ms). Default: 30000. */
  heartbeatIntervalMs?: number;
  /** Fast path config overrides. */
  fastPathConfig?: Partial<FastPathConfig>;
  /** LLM config overrides. */
  llmConfig?: Partial<LlmConfig>;
  /** Scanner tool definitions (web_search, etc.). */
  scannerTools?: ToolDefinition[];
  /** Scanner tool executor. */
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<string>;
}

// ─── RuntimeV2 ───

export class RuntimeV2 {
  private readonly client: ContextClient;
  private readonly trader: ContextTrader | null;
  private readonly chatBridge?: ChatBridge;
  private readonly dryRun: boolean;

  // Core components
  readonly state: OrderBookState;
  readonly queue: EventQueue;
  readonly fastPath: FastPath;
  readonly chief: ChiefGateway;
  readonly dataCache: SharedDataCache;
  readonly reconciliation: ReconciliationLoop | null;

  // Timers
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Config
  private readonly heartbeatIntervalMs: number;

  constructor(options: RuntimeV2Options) {
    this.dryRun = options.dryRun ?? false;
    this.chatBridge = options.chatBridge;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;

    // Create trader + client
    if (options.trader) {
      this.trader = new ContextTrader(options.trader);
      this.client = this.trader;
    } else {
      this.trader = null;
      this.client = new ContextClient();
    }

    // Merge configs
    const riskLimits: RiskLimits = { ...DEFAULT_RISK_LIMITS, ...options.riskLimits };
    const fastPathConfig: FastPathConfig = { ...DEFAULT_FAST_PATH_CONFIG, ...options.fastPathConfig };
    const llmConfig: LlmConfig = { ...DEFAULT_LLM_CONFIG, ...options.llmConfig };

    // Create core components
    this.state = new OrderBookState(riskLimits);
    this.queue = new EventQueue();

    this.fastPath = new FastPath(this.state, this.queue, fastPathConfig);

    this.chief = new ChiefGateway(
      this.state,
      this.queue,
      {
        llm: llmConfig,
        scannerTools: options.scannerTools ?? [],
        executeTool: options.executeTool ?? (async () => "No tools configured"),
        onAction: (action) => this.executeAction(action),
      },
      this.chatBridge,
    );

    // Data cache with onRefresh → FastPath + EventQueue
    this.dataCache = new SharedDataCache({
      client: this.client,
      pollIntervalMs: options.cachePollIntervalMs ?? 30_000,
      onRefresh: (snapshots) => this.handleDataRefresh(snapshots),
    });

    // Reconciliation (only if we have a trader)
    if (this.trader && !this.dryRun) {
      this.reconciliation = new ReconciliationLoop(
        this.state,
        this.queue,
        this.trader,
        options.reconcileIntervalMs ?? 30_000,
      );
    } else {
      this.reconciliation = null;
    }
  }

  // ─── Lifecycle ───

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[runtime-v2] Starting MM team v2 (dryRun=${this.dryRun})`);

    // Register shutdown handlers
    const onSignal = () => this.stop();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    // Wire chat bridge → EventQueue
    if (this.chatBridge) {
      this.chatBridge.onMessage((content, mentionedAgent) => {
        // Fast path handles immediate responses (halt, resume, status)
        const ack = this.fastPath.processHumanMessage(content);
        if (ack) {
          this.chatBridge!.send("chief", "Chief", ack.ack).catch(() => {});
          return; // Fast path handled it
        }

        // Otherwise, push to queue for Chief
        const event: TeamEvent = {
          type: "human_message",
          content,
          from: mentionedAgent ?? "human",
        };
        this.queue.push(event, getEventPriority(event), getCoalesceKey(event));

        // Instant ack before Chief responds
        this.chatBridge!.send("chief", "Chief", "Got it, looking into this...").catch(() => {});
      });

      try {
        await this.chatBridge.start();
      } catch (err) {
        console.error("[runtime-v2] Chat bridge failed to start (non-fatal):", err instanceof Error ? err.message : err);
      }
    }

    // Start data cache
    this.dataCache.start();

    // Start reconciliation
    if (this.reconciliation) {
      this.reconciliation.start();
    }

    // Start heartbeat timer → tick events
    this.heartbeatTimer = setInterval(() => {
      if (!this.running) return;
      const event: TeamEvent = { type: "tick", timestamp: Date.now() };
      this.queue.push(event, getEventPriority(event), getCoalesceKey(event));
    }, this.heartbeatIntervalMs);

    // Announce on both bots
    if (this.chatBridge) {
      const mode = this.dryRun ? "DRY RUN" : "LIVE";
      await this.chatBridge.send("desk", "Desk", `⚡ <b>MM Team v2 online</b> (${mode})`).catch(() => {});
      await this.chatBridge.send("chief", "Chief", `Online. Event-driven mode, ${mode}.`).catch(() => {});
    }

    // Start Chief event loop (blocks until stop() is called)
    await this.chief.run();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    console.log("[runtime-v2] Stop requested — shutting down");

    // 1. Stop Chief
    this.chief.stop();

    // 2. Stop reconciliation
    if (this.reconciliation) {
      this.reconciliation.stop();
    }

    // 3. Stop data cache
    this.dataCache.stop();

    // 4. Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 5. Cancel all open orders
    if (this.trader && !this.dryRun) {
      try {
        const orders = await this.trader.getAllMyOrders();
        const openOrders = (Array.isArray(orders) ? orders : (orders as any).orders ?? [])
          .filter((o: any) => !o.status || o.status === "open");

        if (openOrders.length > 0) {
          console.log(`[runtime-v2] Cancelling ${openOrders.length} open orders...`);
          const nonces = openOrders.map((o: any) => o.nonce);
          const BATCH_SIZE = 20;
          for (let i = 0; i < nonces.length; i += BATCH_SIZE) {
            const batch = nonces.slice(i, i + BATCH_SIZE);
            await this.trader.bulkCancelOrders(batch);
          }
        }
      } catch (err) {
        console.error("[runtime-v2] Error cancelling orders on shutdown:", err);
      }
    }

    // 6. Notify chat (both bots)
    if (this.chatBridge) {
      await this.chatBridge.send("desk", "Desk", `🔴 <b>MM Team v2 offline</b>`).catch(() => {});
      await this.chatBridge.send("chief", "Chief", "Offline. All orders cancelled.").catch(() => {});
      await this.chatBridge.stop();
    }

    console.log("[runtime-v2] Shutdown complete");
  }

  // ─── Data Refresh Handler ───

  private handleDataRefresh(snapshots: MarketSnapshot[]): void {
    // Initialize markets we haven't seen before
    const newMarkets: string[] = [];
    for (const snapshot of snapshots) {
      const marketId = (snapshot.market as Record<string, any>).id;
      if (!marketId) continue;

      if (!this.state.markets.has(marketId)) {
        this.state.addMarket(marketId, snapshot as any);
        const mkt = this.state.markets.get(marketId);
        const name = mkt?.name ?? "?";
        console.log(`[runtime-v2] New market: ${marketId.slice(0, 8)} — "${name.slice(0, 60)}"`);
        newMarkets.push(name.length > 40 ? name.slice(0, 37) + "..." : name);

        const event: TeamEvent = {
          type: "new_market",
          marketId,
          name: (snapshot.market as Record<string, any>).question ?? (snapshot.market as Record<string, any>).title ?? marketId.slice(0, 8),
        };
        this.queue.push(event, getEventPriority(event), getCoalesceKey(event));
      }
    }

    // Desk activity: new markets discovered
    if (newMarkets.length > 0 && this.chatBridge) {
      const marketList = newMarkets.map((n) => `  ${n}`).join("\n");
      this.chatBridge.send("desk", "Desk",
        `🆕 <b>${newMarkets.length} new market${newMarkets.length > 1 ? "s" : ""}</b>\n${marketList}`
      ).catch(() => {});
    }

    // Run fast path on all snapshots
    const actions = this.fastPath.processDataRefresh(snapshots as any);

    // Execute fast path actions + collect for desk activity
    const fpActions: string[] = [];
    for (const action of actions) {
      if (action.type === "cancel_replace") {
        const mkt = this.state.markets.get(action.marketId);
        const name = mkt?.name ?? action.marketId.slice(0, 8);
        const shortName = name.length > 30 ? name.slice(0, 27) + "..." : name;
        const status = mkt?.status ?? "?";
        const bid = action.quotes.find((q) => q.side === "buy");
        const ask = action.quotes.find((q) => q.side === "sell");
        if (status === "provisional_urgent" || status === "provisional") {
          const tierLabel = status === "provisional_urgent" ? "T4" : "T3";
          fpActions.push(`  ${tierLabel} ${shortName} → ${mkt?.fairValue ?? "?"}¢`);
        }
        this.executeAction(action);
      }
    }

    // Desk activity: fast path repricing (only T3/T4 — T1/T2 are too noisy)
    if (fpActions.length > 0 && this.chatBridge) {
      this.chatBridge.send("desk", "Desk",
        `⚡ <b>Fast path</b>\n${fpActions.join("\n")}`
      ).catch(() => {});
    }

    // Push data_refresh event for Chief (coalesced — only latest matters)
    const event: TeamEvent = { type: "data_refresh", snapshots: snapshots as any };
    this.queue.push(event, getEventPriority(event), getCoalesceKey(event));
  }

  // ─── Action Execution ───

  private async executeAction(action: FastPathAction): Promise<void> {
    if (action.type !== "cancel_replace") return;

    const market = this.state.markets.get(action.marketId);
    const marketName = market?.name ?? action.marketId.slice(0, 8);
    const shortName = marketName.length > 30 ? marketName.slice(0, 27) + "..." : marketName;
    const bid = action.quotes.find((q) => q.side === "buy") ?? null;
    const ask = action.quotes.find((q) => q.side === "sell") ?? null;

    if (this.dryRun) {
      console.log(`[runtime-v2] DRY RUN: cancel_replace on ${action.marketId} — ${action.quotes.length} quotes`);
      this.state.setQuotes(
        action.marketId,
        bid ? { price: bid.priceCents, size: bid.size } : null,
        ask ? { price: ask.priceCents, size: ask.size } : null,
      );
      return;
    }

    if (!this.trader) return;
    if (!market) return;

    for (const quote of action.quotes) {
      try {
        // Cancel existing order for this side
        const existing = quote.side === "buy" ? market.ourBid : market.ourAsk;
        if (existing?.nonce) {
          // Cancel and replace in one call if possible
          const result = await this.trader.cancelReplace(existing.nonce as Hex, {
            marketId: action.marketId,
            outcome: quote.outcome,
            side: quote.side,
            priceCents: quote.priceCents,
            size: quote.size,
          });

          // Update state with new order info
          const newQuoteState = {
            price: quote.priceCents,
            size: quote.size,
            nonce: (result as any)?.nonce,
            orderId: (result as any)?.orderId,
          };
          if (quote.side === "buy") {
            market.ourBid = newQuoteState;
          } else {
            market.ourAsk = newQuoteState;
          }
        } else {
          // No existing order — place new
          const result = await this.trader.placeOrder({
            marketId: action.marketId,
            outcome: quote.outcome,
            side: quote.side,
            priceCents: quote.priceCents,
            size: quote.size,
          });

          const newQuoteState = {
            price: quote.priceCents,
            size: quote.size,
            nonce: (result as any)?.nonce,
            orderId: (result as any)?.orderId,
          };
          if (quote.side === "buy") {
            market.ourBid = newQuoteState;
          } else {
            market.ourAsk = newQuoteState;
          }
        }

        market.quotedAt = Date.now();
      } catch (err) {
        console.error(`[runtime-v2] Order execution error (${action.marketId}, ${quote.side}):`, err instanceof Error ? err.message : err);
        if (this.chatBridge) {
          this.chatBridge.send("desk", "Desk",
            `⚠️ Order error: ${shortName} ${quote.side} — ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`
          ).catch(() => {});
        }
      }
    }

    // Desk activity: live order execution
    if (this.chatBridge) {
      const bidStr = bid ? `${bid.priceCents}¢ x${bid.size}` : "—";
      const askStr = ask ? `${ask.priceCents}¢ x${ask.size}` : "—";
      this.chatBridge.send("desk", "Desk",
        `📝 <b>Order</b> ${shortName}\n  ${bidStr} / ${askStr}`
      ).catch(() => {});
    }
  }
}
