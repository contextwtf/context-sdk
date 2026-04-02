import {
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  http as viemHttp,
  maxUint256,
  parseUnits,
} from "viem";
import type { HttpClient } from "../http.js";
import { ENDPOINTS } from "../endpoints.js";
import {
  type ChainConfig,
  getHoldingsAddress,
  getSettlementAddress,
  holdingsDomain,
  ERC20_ABI,
  HOLDINGS_ABI,
  SETTLEMENT_ABI,
  OPERATOR_APPROVAL_TYPES,
  OPERATOR_NONCE_ABI,
} from "../config.js";
import { ContextConfigError } from "../errors.js";
import type {
  AccountStatus,
  SetupResult,
  DepositResult,
  MintResult,
  GaslessOperatorRequest,
  GaslessOperatorResult,
} from "../types.js";
import { validateMarketId } from "../validation.js";

export class AccountModule {
  private readonly publicClient: PublicClient;

  constructor(
    private readonly http: HttpClient,
    private readonly walletClient: WalletClient | null,
    private readonly account: Account | null,
    private readonly chainConfig: ChainConfig,
    private readonly chain: "mainnet" | "testnet",
    rpcUrl?: string,
  ) {
    this.publicClient = createPublicClient({
      chain: chainConfig.viemChain,
      transport: viemHttp(rpcUrl),
    }) as PublicClient;
  }

  private get address(): Address {
    if (!this.account) {
      throw new ContextConfigError(
        "A signer is required for account operations.",
      );
    }
    return this.account.address;
  }

  private requireWallet(): WalletClient {
    if (!this.walletClient) {
      throw new ContextConfigError(
        "A signer is required for account operations.",
      );
    }
    return this.walletClient;
  }

  private requireAccount(): Account {
    if (!this.account) {
      throw new ContextConfigError(
        "A signer is required for account operations.",
      );
    }
    return this.account;
  }

  async status(): Promise<AccountStatus> {
    const addr = this.address;
    const settlement = getSettlementAddress(this.chainConfig);
    const holdings = getHoldingsAddress(this.chainConfig);
    const { usdc } = this.chainConfig;
    const [ethBalance, usdcBalance, usdcAllowance, isOperatorApproved] =
      await Promise.all([
        this.publicClient.getBalance({ address: addr }),
        this.publicClient.readContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        }),
        this.publicClient.readContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [addr, holdings],
        }),
        this.publicClient.readContract({
          address: holdings,
          abi: HOLDINGS_ABI,
          functionName: "isOperatorFor",
          args: [addr, settlement],
        }),
      ]);

    const needsUsdcApproval = usdcAllowance === 0n;
    const needsOperatorApproval = !isOperatorApproved;

    return {
      address: addr,
      ethBalance,
      usdcBalance,
      usdcAllowance,
      isOperatorApproved,
      needsUsdcApproval,
      needsOperatorApproval,
      isReady: !needsUsdcApproval && !needsOperatorApproval,
    };
  }

  // ─── Granular Approval Methods ───

  /** @deprecated Use setup() to handle approvals in one flow, or call the unchecked variant internally. */
  async approveUsdc(): Promise<Hex | null> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain, usdc } = this.chainConfig;
    const holdings = getHoldingsAddress(this.chainConfig);
    const status = await this.status();
    if (!status.needsUsdcApproval) return null;

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: usdc,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [holdings, maxUint256],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** @deprecated Use setup() to handle approvals in one flow, or call the unchecked variant internally. */
  async approveOperator(): Promise<Hex | null> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain } = this.chainConfig;
    const settlement = getSettlementAddress(this.chainConfig);
    const holdings = getHoldingsAddress(this.chainConfig);
    const status = await this.status();
    if (!status.needsOperatorApproval) return null;

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: holdings,
      abi: HOLDINGS_ABI,
      functionName: "setOperator",
      args: [settlement, true],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ─── Chain-Aware Dispatchers ───

  async setup(): Promise<SetupResult> {
    return this.onchainSetup();
  }

  async deposit(amount: number): Promise<DepositResult> {
    const amountRaw = parseUnits(amount.toString(), 6);
    const hash = await this.onchainDeposit(amount);
    return { txHash: hash, amount: amountRaw.toString(), gasless: false };
  }

  // ─── On-Chain Methods ───

  async onchainSetup(): Promise<SetupResult> {
    const status = await this.status();

    const usdcTx = status.needsUsdcApproval
      ? await this.approveUsdcUnchecked()
      : null;
    const operatorTx = status.needsOperatorApproval
      ? await this.approveOperatorUnchecked()
      : null;

    return {
      usdcApproval: { needed: status.needsUsdcApproval, txHash: usdcTx },
      operatorApproval: {
        needed: status.needsOperatorApproval,
        txHash: operatorTx,
      },
    };
  }

  async onchainDeposit(amount: number): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain, usdc } = this.chainConfig;
    const holdings = getHoldingsAddress(this.chainConfig);
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: holdings,
      abi: HOLDINGS_ABI,
      functionName: "deposit",
      args: [this.address, usdc, amountRaw],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async withdraw(amount: number): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain, usdc } = this.chainConfig;
    const holdings = getHoldingsAddress(this.chainConfig);
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: holdings,
      abi: HOLDINGS_ABI,
      functionName: "withdraw",
      args: [this.address, usdc, amountRaw],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async mintTestUsdc(amount: number = 1000): Promise<MintResult> {
    return this.http.post<MintResult>(ENDPOINTS.balance.mintTestUsdc, {
      address: this.address,
      amount: amount.toString(),
    });
  }

  async mintCompleteSets(marketId: string, amount: number): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain } = this.chainConfig;
    const settlement = getSettlementAddress(this.chainConfig);
    const amountRaw = parseUnits(amount.toString(), 6);
    const validatedMarketId = validateMarketId(marketId);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: settlement,
      abi: SETTLEMENT_ABI,
      functionName: "mintCompleteSetsFromHoldings",
      args: [validatedMarketId, amountRaw],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async burnCompleteSets(
    marketId: string,
    amount: number,
    creditInternal = true,
  ): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain } = this.chainConfig;
    const settlement = getSettlementAddress(this.chainConfig);
    const amountRaw = parseUnits(amount.toString(), 6);
    const validatedMarketId = validateMarketId(marketId);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: settlement,
      abi: SETTLEMENT_ABI,
      functionName: "burnCompleteSetsFromHoldings",
      args: [validatedMarketId, amountRaw, this.address, creditInternal],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ─── Gasless (high-level: sign + relay) ───

  async gaslessSetup(): Promise<GaslessOperatorResult> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const settlementVersion = this.chainConfig.defaultSettlementVersion;
    const settlement = getSettlementAddress(this.chainConfig, settlementVersion);
    const holdings = getHoldingsAddress(this.chainConfig, settlementVersion);

    const nonce = (await this.publicClient.readContract({
      address: holdings,
      abi: OPERATOR_NONCE_ABI,
      functionName: "operatorNonce",
      args: [this.address],
    })) as bigint;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const signature = await wallet.signTypedData({
      account,
      domain: holdingsDomain(this.chainConfig, settlementVersion),
      types: OPERATOR_APPROVAL_TYPES,
      primaryType: "OperatorApproval",
      message: {
        user: this.address,
        operator: settlement,
        approved: true,
        nonce,
        deadline,
      },
    });

    return this.relayOperatorApproval({
      user: this.address,
      settlementVersion,
      approved: true,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signature,
    });
  }

  async gaslessDeposit(_amount: number): Promise<never> {
    throw new ContextConfigError(
      "gaslessDeposit() is currently unavailable. Use onchain deposit() instead.",
    );
  }

  // ─── Gasless Relay (low-level) ───

  async relayOperatorApproval(
    req: GaslessOperatorRequest,
  ): Promise<GaslessOperatorResult> {
    return this.http.post<GaslessOperatorResult>(
      ENDPOINTS.gasless.operator,
      req,
    );
  }

  async relayDeposit(): Promise<never> {
    throw new ContextConfigError(
      "relayDeposit() is currently unavailable because /gasless/deposit-with-permit is disabled.",
    );
  }

  // ─── Private helpers (skip status check, used by onchainSetup) ───

  private async approveUsdcUnchecked(): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain, usdc } = this.chainConfig;
    const holdings = getHoldingsAddress(this.chainConfig);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: usdc,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [holdings, maxUint256],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  private async approveOperatorUnchecked(): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain } = this.chainConfig;
    const settlement = getSettlementAddress(this.chainConfig);
    const holdings = getHoldingsAddress(this.chainConfig);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: holdings,
      abi: HOLDINGS_ABI,
      functionName: "setOperator",
      args: [settlement, true],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}
