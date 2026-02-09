import type { Hex } from "viem";
import {
  ContextClient,
  ContextTrader,
  type ContextTraderOptions,
  type Order,
  type Fill,
} from "@context-markets/sdk";
import type {
  Strategy,
  MarketSnapshot,
  AgentState,
  Action,
} from "./strategy.js";
import { RiskManager, type RiskLimits } from "./risk.js";
import { TradeLogger, type LogEntry } from "./logger.js";

export interface AgentRuntimeOptions {
  /** Trader credentials. Omit for read-only dry run. */
  trader?: ContextTraderOptions;
  /** The strategy to run. */
  strategy: Strategy;
  /** Risk limits applied to every cycle. */
  risk?: RiskLimits;
  /** Milliseconds between evaluation cycles. Default: 15000. */
  intervalMs?: number;
  /** If true, evaluate but never execute. Default: false. */
  dryRun?: boolean;
  /** Max cycles before auto-stop. 0 = unlimited. Default: 0. */
  maxCycles?: number;
}

export class AgentRuntime {
  private readonly client: ContextClient;
  private readonly trader: ContextTrader | null;
  private readonly strategy: Strategy;
  private readonly riskManager: RiskManager;
  private readonly logger: TradeLogger;
  private readonly intervalMs: number;
  private readonly dryRun: boolean;
  private readonly maxCycles: number;

  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  // Fill detection state
  private previousOrders = new Map<string, { order: Order; filledSize: number }>();
  private pendingCancels = new Set<string>();

  constructor(options: AgentRuntimeOptions) {
    if (options.trader) {
      this.trader = new ContextTrader(options.trader);
      this.client = this.trader;
    } else {
      this.trader = null;
      this.client = new ContextClient();
    }

    this.strategy = options.strategy;
    this.riskManager = new RiskManager(options.risk);
    this.logger = new TradeLogger();
    this.intervalMs = options.intervalMs ?? 15_000;
    this.dryRun = options.dryRun ?? false;
    this.maxCycles = options.maxCycles ?? 0;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();

    console.log(
      `[agent] Starting "${this.strategy.name}" (dryRun=${this.dryRun}, interval=${this.intervalMs}ms)`,
    );

    // Register shutdown handlers
    const onSignal = () => this.stop();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    try {
      while (this.running) {
        await this.runCycle();

        if (
          this.maxCycles > 0 &&
          this.logger.currentCycle >= this.maxCycles
        ) {
          console.log(
            `[agent] Reached max cycles (${this.maxCycles}), stopping`,
          );
          break;
        }

        if (this.running) {
          await this.sleep(this.intervalMs);
        }
      }
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      await this.shutdown();
    }
  }

  async stop(): Promise<void> {
    console.log("[agent] Stop requested");
    this.running = false;
    this.abortController?.abort();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async runCycle(): Promise<void> {
    const cycle = this.logger.nextCycle();

    try {
      // 1. Select markets
      const selector = await this.strategy.selectMarkets();

      // 2. Fetch market list
      let marketIds: string[];
      if (selector.type === "ids") {
        marketIds = selector.ids;
      } else {
        const result = await this.client.searchMarkets({
          query: selector.query,
          status: selector.status,
        });
        marketIds = result.markets.map((m: { id: string }) => m.id);
      }

      if (marketIds.length === 0) {
        console.log(`[agent] Cycle ${cycle}: No markets matched`);
        return;
      }

      // 3. Fetch snapshots in parallel
      const snapshots = await this.fetchSnapshots(marketIds);
      this.logger.logCycleStart(snapshots);

      // 4. Fetch agent state
      const state = await this.fetchAgentState();

      // 4b. Detect fills (before evaluate so strategies can react)
      this.detectFills(state.openOrders);

      // 5. Evaluate strategy
      const actions = await this.strategy.evaluate(snapshots, state);
      this.logger.logEvaluation(actions);

      if (actions.length === 0 || actions.every((a) => a.type === "no_action")) {
        return;
      }

      // 6. Risk check
      const riskResult = this.riskManager.check(actions, state);
      this.logger.logRiskCheck(riskResult);

      // 7. Execute (unless dry run)
      if (this.dryRun) {
        console.log(
          `[agent] DRY RUN: Would execute ${riskResult.allowed.filter((a) => a.type !== "no_action").length} actions`,
        );
        return;
      }

      if (!this.trader) {
        console.log(
          "[agent] No trader configured, skipping execution",
        );
        return;
      }

      for (const action of riskResult.allowed) {
        if (action.type === "no_action") continue;
        await this.executeAction(action);
      }
    } catch (err) {
      this.logger.logError(err, `cycle ${cycle}`);
    }
  }

  private detectFills(currentOrders: Order[]): void {
    if (this.previousOrders.size === 0) {
      // First cycle — seed state, no fills to detect
      this.updatePreviousOrders(currentOrders);
      return;
    }

    const currentByNonce = new Map(
      currentOrders.map((o) => [o.nonce, o]),
    );

    const fills: Fill[] = [];

    for (const [nonce, prev] of this.previousOrders) {
      // Skip orders we intentionally cancelled
      if (this.pendingCancels.has(nonce)) continue;

      const current = currentByNonce.get(nonce as Hex);

      if (!current) {
        // Order disappeared and we didn't cancel it → full fill
        const prevFilled = prev.filledSize;
        const totalSize = prev.order.size;
        fills.push({
          order: prev.order,
          previousFilledSize: prevFilled,
          currentFilledSize: totalSize,
          fillSize: totalSize - prevFilled,
          type: "full",
        });
      } else {
        // Order still exists — check if filledSize increased
        const currentFilled = current.filledSize ?? 0;
        if (currentFilled > prev.filledSize) {
          fills.push({
            order: current,
            previousFilledSize: prev.filledSize,
            currentFilledSize: currentFilled,
            fillSize: currentFilled - prev.filledSize,
            type: currentFilled >= current.size ? "full" : "partial",
          });
        }
      }
    }

    // Notify strategy and logger for each detected fill
    for (const fill of fills) {
      this.logger.logFill(fill);
      if (this.strategy.onFill) {
        this.strategy.onFill(fill);
      }
    }

    // Update state for next cycle
    this.updatePreviousOrders(currentOrders);
    this.pendingCancels.clear();
  }

  private updatePreviousOrders(orders: Order[]): void {
    this.previousOrders.clear();
    for (const order of orders) {
      this.previousOrders.set(order.nonce, {
        order,
        filledSize: order.filledSize ?? 0,
      });
    }
  }

  private async fetchSnapshots(
    marketIds: string[],
  ): Promise<MarketSnapshot[]> {
    return Promise.all(
      marketIds.map(async (id) => {
        const [rawMarket, rawQuotes, rawOrderbook, rawOracle] =
          await Promise.all([
            this.client.getMarket(id),
            this.client.getQuotes(id).catch(() => []),
            this.client
              .getOrderbook(id)
              .catch(() => ({ bids: [], asks: [] })),
            this.client.getOracleSignals(id).catch(() => []),
          ]);

        // Normalize: API wraps some responses
        const market = (rawMarket as any).market ?? rawMarket;
        const quotes = Array.isArray(rawQuotes) ? rawQuotes : [rawQuotes];
        const orderbook = (rawOrderbook as any).bids
          ? rawOrderbook
          : { bids: [], asks: [] };

        // Oracle: API returns { oracle: {...} | null }
        const oracleData = (rawOracle as any).oracle ?? rawOracle;
        const oracleSignals = !oracleData
          ? []
          : Array.isArray(oracleData)
            ? oracleData.filter(Boolean)
            : [oracleData];

        return { market, quotes, orderbook, oracleSignals };
      }),
    );
  }

  private async fetchAgentState(): Promise<AgentState> {
    if (!this.trader) {
      return {
        portfolio: {
          address: "0x0000000000000000000000000000000000000000",
          positions: [],
        },
        openOrders: [],
        balance: {
          address: "0x0000000000000000000000000000000000000000",
          usdc: 0,
        },
      };
    }

    const [rawPortfolio, rawOrders, balance] = await Promise.all([
      this.trader.getMyPortfolio().catch(() => ({
        address: this.trader!.address,
        positions: [],
      })),
      this.trader.getMyOrders().catch(() => []),
      this.trader.getMyBalance().catch(() => ({
        address: this.trader!.address,
        usdc: 0,
      })),
    ]);

    // Normalize portfolio: API returns { portfolio: [], marketIds: [] }
    const portfolioAny = rawPortfolio as any;
    const normalizedPortfolio = {
      address: portfolioAny.address ?? this.trader.address,
      positions: portfolioAny.positions ?? portfolioAny.portfolio ?? [],
    };

    // Normalize orders: API returns { orders: [], cursor: null }
    const openOrders = Array.isArray(rawOrders)
      ? rawOrders
      : (rawOrders as any).orders ?? [];

    return { portfolio: normalizedPortfolio, openOrders, balance };
  }

  private async executeAction(action: Action): Promise<void> {
    if (!this.trader || action.type === "no_action") return;

    try {
      switch (action.type) {
        case "place_order": {
          const result = await this.trader.placeOrder({
            marketId: action.marketId,
            outcome: action.outcome,
            side: action.side,
            priceCents: action.priceCents,
            size: action.size,
          });
          this.logger.logExecution(action, result);
          break;
        }
        case "cancel_order": {
          this.pendingCancels.add(action.nonce);
          const result = await this.trader.cancelOrder(
            action.nonce as Hex,
          );
          this.logger.logExecution(action, result);
          break;
        }
        case "cancel_replace": {
          this.pendingCancels.add(action.cancelNonce);
          const result = await this.trader.cancelReplace(
            action.cancelNonce as Hex,
            {
              marketId: action.marketId,
              outcome: action.outcome,
              side: action.side,
              priceCents: action.priceCents,
              size: action.size,
            },
          );
          this.logger.logExecution(action, result);
          break;
        }
      }
    } catch (err) {
      this.logger.logError(err, `executing ${action.type}`);
    }
  }

  private async shutdown(): Promise<void> {
    const state = await this.fetchAgentState();

    // Cancel all open orders on shutdown
    if (this.trader && state.openOrders.length > 0 && !this.dryRun) {
      console.log(
        `[agent] Cancelling ${state.openOrders.length} open orders...`,
      );
      try {
        const nonces = state.openOrders.map((o) => o.nonce);
        // API limits bulk cancel to 20 per request — batch accordingly
        const BATCH_SIZE = 20;
        for (let i = 0; i < nonces.length; i += BATCH_SIZE) {
          const batch = nonces.slice(i, i + BATCH_SIZE);
          await this.trader.bulkCancelOrders(batch);
          console.log(
            `[agent] Cancelled batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} orders)`,
          );
        }
      } catch (err) {
        this.logger.logError(err, "shutdown cancel");
      }
    }

    this.logger.logShutdown(state);

    if (this.strategy.onShutdown) {
      await this.strategy.onShutdown();
    }

    console.log("[agent] Shutdown complete");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.timer = setTimeout(resolve, ms);
      this.abortController?.signal.addEventListener(
        "abort",
        () => {
          if (this.timer) clearTimeout(this.timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** Access the log entries for analysis. */
  get logs(): readonly LogEntry[] {
    return this.logger.getEntries();
  }
}
