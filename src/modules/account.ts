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
import { baseSepolia } from "viem/chains";
import type { HttpClient } from "../http.js";
import { ENDPOINTS } from "../endpoints.js";
import {
  SETTLEMENT_ADDRESS,
  HOLDINGS_ADDRESS,
  USDC_ADDRESS,
  ERC20_ABI,
  HOLDINGS_ABI,
  SETTLEMENT_ABI,
} from "../config.js";
import { ContextConfigError } from "../errors.js";
import type {
  WalletStatus,
  WalletSetupResult,
  GaslessOperatorRequest,
  GaslessOperatorResult,
  GaslessDepositRequest,
  GaslessDepositResult,
} from "../types.js";

export class AccountModule {
  private readonly publicClient: PublicClient;

  constructor(
    private readonly http: HttpClient,
    private readonly walletClient: WalletClient | null,
    private readonly account: Account | null,
  ) {
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: viemHttp(),
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

  async status(): Promise<WalletStatus> {
    const addr = this.address;
    const [ethBalance, usdcAllowance, isOperatorApproved] =
      await Promise.all([
        this.publicClient.getBalance({ address: addr }),
        this.publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [addr, HOLDINGS_ADDRESS],
        }),
        this.publicClient.readContract({
          address: HOLDINGS_ADDRESS,
          abi: HOLDINGS_ABI,
          functionName: "isOperatorFor",
          args: [addr, SETTLEMENT_ADDRESS],
        }),
      ]);

    return {
      address: addr,
      ethBalance,
      usdcAllowance,
      isOperatorApproved,
      needsApprovals: usdcAllowance === 0n || !isOperatorApproved,
    };
  }

  async setup(): Promise<WalletSetupResult> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const walletStatus = await this.status();
    let usdcApprovalTx: Hex | null = null;
    let operatorApprovalTx: Hex | null = null;

    if (walletStatus.usdcAllowance === 0n) {
      usdcApprovalTx = await wallet.writeContract({
        account,
        chain: baseSepolia,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [HOLDINGS_ADDRESS, maxUint256],
      });
    }

    if (!walletStatus.isOperatorApproved) {
      operatorApprovalTx = await wallet.writeContract({
        account,
        chain: baseSepolia,
        address: HOLDINGS_ADDRESS,
        abi: HOLDINGS_ABI,
        functionName: "setOperator",
        args: [SETTLEMENT_ADDRESS, true],
      });
    }

    return { usdcApprovalTx, operatorApprovalTx };
  }

  async mintTestUsdc(amount: number = 1000): Promise<unknown> {
    return this.http.post(ENDPOINTS.balance.mintTestUsdc, {
      address: this.address,
      amount: amount.toString(),
    });
  }

  async deposit(amount: number): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: baseSepolia,
      address: HOLDINGS_ADDRESS,
      abi: HOLDINGS_ABI,
      functionName: "deposit",
      args: [USDC_ADDRESS, amountRaw],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async withdraw(amount: number): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: baseSepolia,
      address: HOLDINGS_ADDRESS,
      abi: HOLDINGS_ABI,
      functionName: "withdraw",
      args: [USDC_ADDRESS, amountRaw],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async mintCompleteSets(marketId: string, amount: number): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: baseSepolia,
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "mintCompleteSetsFromHoldings",
      args: [marketId as Hex, amountRaw],
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
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: baseSepolia,
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "burnCompleteSetsFromHoldings",
      args: [marketId as Hex, amountRaw, this.address, creditInternal],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ─── Gasless Relay ───

  async relayOperatorApproval(
    req: GaslessOperatorRequest,
  ): Promise<GaslessOperatorResult> {
    return this.http.post<GaslessOperatorResult>(
      ENDPOINTS.gasless.operator,
      req,
    );
  }

  async relayDeposit(
    req: GaslessDepositRequest,
  ): Promise<GaslessDepositResult> {
    return this.http.post<GaslessDepositResult>(
      ENDPOINTS.gasless.depositWithPermit,
      req,
    );
  }
}
