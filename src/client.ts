import type { Address } from "viem";
import { createHttpClient, type HttpClient } from "./http.js";
import { resolveSigner } from "./signing/eip712.js";
import { OrderBuilder } from "./order-builder/builder.js";
import { Markets } from "./modules/markets.js";
import { Questions } from "./modules/questions.js";
import { Orders } from "./modules/orders.js";
import { PortfolioModule } from "./modules/portfolio.js";
import { AccountModule } from "./modules/account.js";
import { resolveChainConfig, type ChainConfig } from "./config.js";
import type { ContextClientOptions } from "./types.js";

/**
 * Unified SDK client for Context prediction markets.
 *
 * Read-only usage (no signer):
 *   const ctx = new ContextClient()
 *   const markets = await ctx.markets.list()
 *
 * Trading usage (with signer):
 *   const ctx = new ContextClient({ apiKey, signer: { privateKey } })
 *   const order = await ctx.orders.create({ ... })
 *
 * Testnet usage:
 *   const ctx = new ContextClient({ chain: "testnet", apiKey, signer: { privateKey } })
 */
export class ContextClient {
  readonly markets: Markets;
  readonly questions: Questions;
  readonly orders: Orders;
  readonly portfolio: PortfolioModule;
  readonly account: AccountModule;

  /** The resolved chain configuration. */
  readonly chainConfig: ChainConfig;

  /** Which chain this client is connected to. */
  readonly chain: "mainnet" | "testnet";

  /** The trader's on-chain address, or null if no signer was provided. */
  readonly address: Address | null;

  constructor(options: ContextClientOptions = {}) {
    const chainConfig = resolveChainConfig(options.chain);
    this.chainConfig = chainConfig;
    this.chain = options.chain ?? "mainnet";

    const http: HttpClient = createHttpClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? chainConfig.apiBase,
    });

    let builder: OrderBuilder | null = null;
    let address: Address | null = null;
    let walletClient = null;
    let account = null;

    if (options.signer) {
      const resolved = resolveSigner(options.signer, chainConfig);
      walletClient = resolved.walletClient;
      account = resolved.account;
      address = resolved.account.address;
      builder = new OrderBuilder(walletClient, account, chainConfig);
    }

    this.address = address;
    this.markets = new Markets(http);
    this.questions = new Questions(http);
    this.orders = new Orders(http, builder, address);
    this.portfolio = new PortfolioModule(http, address);
    this.account = new AccountModule(http, walletClient, account, chainConfig, this.chain, options.rpcUrl);
  }
}
