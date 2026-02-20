import type { Address } from "viem";
import { createHttpClient, type HttpClient } from "./http.js";
import { resolveSigner } from "./signing/eip712.js";
import { OrderBuilder } from "./order-builder/builder.js";
import { Markets } from "./modules/markets.js";
import { Questions } from "./modules/questions.js";
import { Orders } from "./modules/orders.js";
import { PortfolioModule } from "./modules/portfolio.js";
import { AccountModule } from "./modules/account.js";
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
 */
export class ContextClient {
  readonly markets: Markets;
  readonly questions: Questions;
  readonly orders: Orders;
  readonly portfolio: PortfolioModule;
  readonly account: AccountModule;

  /** The trader's on-chain address, or null if no signer was provided. */
  readonly address: Address | null;

  constructor(options: ContextClientOptions = {}) {
    const http: HttpClient = createHttpClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });

    let builder: OrderBuilder | null = null;
    let address: Address | null = null;
    let walletClient = null;
    let account = null;

    if (options.signer) {
      const resolved = resolveSigner(options.signer);
      walletClient = resolved.walletClient;
      account = resolved.account;
      address = resolved.account.address;
      builder = new OrderBuilder(walletClient, account);
    }

    this.address = address;
    this.markets = new Markets(http);
    this.questions = new Questions(http);
    this.orders = new Orders(http, builder, address);
    this.portfolio = new PortfolioModule(http, address);
    this.account = new AccountModule(http, walletClient, account, options.rpcUrl);
  }
}
