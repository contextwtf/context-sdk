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
import {
  FairValueService,
  type FairValueServiceOptions,
} from "./fair-value-service.js";

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
  /** Fair value service config. If provided, FVs are computed centrally and attached to snapshots. */
  fairValue?: FairValueServiceOptions;
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
  private readonly fairValueService: FairValueService | null;

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
    this.fairValueService = options.fairValue
      ? new FairValueService(options.fairValue)
      : null;
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

      // 3b. Compute fair values (if service configured)
      if (this.fairValueService) {
        await this.fairValueService.computeAll(snapshots);
      }

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

      // 7b. Ensure sell inventory — mint complete sets if needed
      await this.ensureSellInventory(riskResult.allowed, state);

      for (const action of riskResult.allowed) {
        if (action.type === "no_action") continue;
        await this.executeAction(action);
      }

      // 8. Re-fetch open orders after execution so newly placed orders
      //    are tracked in previousOrders for fill detection next cycle
      const postExecState = await this.fetchAgentState();
      this.updatePreviousOrders(postExecState.openOrders);
    } catch (err) {
      this.logger.logError(err, `cycle ${cycle}`);
    }
  }

  private detectFills(currentOrders: Order[]): void {
    if (this.previousOrders.size === 0) {
      // First cycle — seed state, no fills to detect
      console.log(`[fill-debug] Seeding ${currentOrders.length} orders`);
      this.updatePreviousOrders(currentOrders);
      return;
    }

    const currentByNonce = new Map(
      currentOrders.map((o) => [o.nonce, o]),
    );

    console.log(`[fill-debug] prev=${this.previousOrders.size} curr=${currentByNonce.size} cancels=${this.pendingCancels.size}`);

    let disappeared = 0;
    let filledInc = 0;
    let unchanged = 0;

    const fills: Fill[] = [];

    for (const [nonce, prev] of this.previousOrders) {
      // Skip orders we intentionally cancelled
      if (this.pendingCancels.has(nonce)) continue;

      const current = currentByNonce.get(nonce as Hex);

      if (!current) {
        // Order disappeared and we didn't cancel it → full fill
        disappeared++;
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
          filledInc++;
          fills.push({
            order: current,
            previousFilledSize: prev.filledSize,
            currentFilledSize: currentFilled,
            fillSize: currentFilled - prev.filledSize,
            type: currentFilled >= current.size ? "full" : "partial",
          });
        } else {
          unchanged++;
        }
      }
    }

    if (disappeared > 0 || filledInc > 0) {
      console.log(`[fill-debug] disappeared=${disappeared} filledInc=${filledInc} unchanged=${unchanged} fills=${fills.length}`);
    }

    // Notify service, strategy, and logger for each detected fill
    for (const fill of fills) {
      this.logger.logFill(fill);
      if (this.fairValueService) {
        this.fairValueService.onFill(fill);
      }
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
        const rawBook = (rawOrderbook as any).bids
          ? rawOrderbook
          : { bids: [], asks: [] };

        // IMPORTANT: The orderbook API returns the book from the NO
        // (outcomeIndex 0) perspective. Convert to YES perspective so
        // strategies see YES bids/asks directly.
        //   YES bids = 100 - NO asks (sorted descending by price)
        //   YES asks = 100 - NO bids (sorted ascending by price)
        const orderbook = {
          bids: (rawBook as any).asks
            ?.map((level: any) => ({
              ...level,
              price: 100 - level.price,
            }))
            .sort((a: any, b: any) => b.price - a.price) ?? [],
          asks: (rawBook as any).bids
            ?.map((level: any) => ({
              ...level,
              price: 100 - level.price,
            }))
            .sort((a: any, b: any) => a.price - b.price) ?? [],
        };

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
      this.trader.getAllMyOrders().catch(() => []),
      this.trader.getMyBalance().catch(() => ({
        address: this.trader!.address,
        usdc: 0,
      })),
    ]);

    // Normalize portfolio: API returns { portfolio: [...], marketIds: [] }
    // Each position has { balance, outcomeIndex, outcomeName, marketId, netInvestment, ... }
    // We need to map to Position { marketId, outcome, size, avgPrice }
    const portfolioAny = rawPortfolio as any;
    const rawPositions: any[] =
      portfolioAny.positions ?? portfolioAny.portfolio ?? [];
    const normalizedPortfolio = {
      address: portfolioAny.address ?? this.trader.address,
      positions: rawPositions.map((p: any) => ({
        marketId: p.marketId,
        outcome: p.outcome ?? p.outcomeName?.toLowerCase() ?? (p.outcomeIndex === 1 ? "yes" : "no"),
        size: typeof p.size === "number"
          ? p.size
          : p.balance
            ? Number(p.balance) / 1e6
            : 0,
        avgPrice: p.avgPrice ?? 0,
        // Preserve raw fields for debugging
        outcomeIndex: p.outcomeIndex,
        balance: p.balance,
        netInvestment: p.netInvestment,
      })),
    };

    // Normalize orders: API returns { orders: [], cursor: null }
    // Each order has { outcomeIndex, side (number), price (string), size (string), filledSize (string) }
    // We need to map to Order { outcome, side (string), price (number), size (number), filledSize (number) }
    const allOrders = Array.isArray(rawOrders)
      ? rawOrders
      : (rawOrders as any).orders ?? [];

    // Filter to only open orders — API returns all statuses (cancelled, voided, filled)
    const openOrders = allOrders
      .filter((o: any) => !o.status || o.status === "open")
      .map((o: any) => ({
        ...o,
        outcome: o.outcome ?? (o.outcomeIndex === 1 ? "yes" : "no"),
        side: typeof o.side === "string" ? o.side : o.side === 0 ? "buy" : "sell",
        price: typeof o.price === "number" ? o.price : Number(o.price),
        size: typeof o.size === "number" ? o.size : Number(o.size) / 1e6,
        filledSize: typeof o.filledSize === "number"
          ? o.filledSize
          : o.filledSize != null
            ? Number(o.filledSize) / 1e6
            : 0,
        remainingSize: typeof o.remainingSize === "number"
          ? o.remainingSize
          : o.remainingSize != null
            ? Number(o.remainingSize) / 1e6
            : undefined,
        percentFilled: o.percentFilled ?? 0,
      }));

    return { portfolio: normalizedPortfolio, openOrders, balance };
  }

  /**
   * Check if the agent has enough YES tokens for pending sell orders.
   * If not, mint complete sets to cover the deficit.
   */
  private async ensureSellInventory(
    actions: Action[],
    state: AgentState,
  ): Promise<void> {
    if (!this.trader || this.dryRun) return;

    // Collect sell-YES size needed per market
    const sellByMarket = new Map<string, number>();
    for (const action of actions) {
      if (
        action.type === "place_order" &&
        action.side === "sell" &&
        action.outcome === "yes"
      ) {
        sellByMarket.set(
          action.marketId,
          (sellByMarket.get(action.marketId) ?? 0) + action.size,
        );
      }
    }

    if (sellByMarket.size === 0) return;

    // Check YES balance per market from portfolio
    const yesBalance = new Map<string, number>();
    const positions = state.portfolio?.positions;
    if (positions && Array.isArray(positions)) {
      for (const pos of positions) {
        if (pos.outcome === "yes") {
          yesBalance.set(
            pos.marketId,
            (yesBalance.get(pos.marketId) ?? 0) + pos.size,
          );
        }
      }
    }

    // Mint deficit for each market
    for (const [marketId, needed] of sellByMarket) {
      const have = yesBalance.get(marketId) ?? 0;
      const deficit = needed - have;
      if (deficit <= 0) continue;

      // Add a buffer so we don't mint every single cycle
      const mintAmount = deficit + 50;
      try {
        console.log(
          `[agent] Minting ${mintAmount} sets for ${marketId.slice(0, 8)}... (have ${Math.round(have)}, need ${needed})`,
        );
        await this.trader.mintCompleteSets(marketId, mintAmount);
      } catch (err) {
        this.logger.logError(err, `minting ${mintAmount} sets for ${marketId.slice(0, 8)}`);
      }
    }
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
