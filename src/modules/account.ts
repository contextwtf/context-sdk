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
  holdingsDomain,
  permit2Domain,
  ERC20_ABI,
  HOLDINGS_ABI,
  SETTLEMENT_ABI,
  OPERATOR_APPROVAL_TYPES,
  PERMIT_TRANSFER_FROM_TYPES,
  OPERATOR_NONCE_ABI,
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
    private readonly chainConfig: ChainConfig,
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

  async status(): Promise<WalletStatus> {
    const addr = this.address;
    const { settlement, holdings, usdc } = this.chainConfig;
    const [ethBalance, usdcAllowance, isOperatorApproved] =
      await Promise.all([
        this.publicClient.getBalance({ address: addr }),
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

    return {
      address: addr,
      ethBalance,
      usdcAllowance,
      isOperatorApproved,
      needsApprovals: usdcAllowance === 0n || !isOperatorApproved,
      needsGaslessSetup: !isOperatorApproved,
    };
  }

  async setup(): Promise<WalletSetupResult> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain, settlement, holdings, usdc } = this.chainConfig;
    const walletStatus = await this.status();
    let usdcApprovalTx: Hex | null = null;
    let operatorApprovalTx: Hex | null = null;

    if (walletStatus.usdcAllowance === 0n) {
      usdcApprovalTx = await wallet.writeContract({
        account,
        chain: viemChain,
        address: usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [holdings, maxUint256],
      });
    }

    if (!walletStatus.isOperatorApproved) {
      operatorApprovalTx = await wallet.writeContract({
        account,
        chain: viemChain,
        address: holdings,
        abi: HOLDINGS_ABI,
        functionName: "setOperator",
        args: [settlement, true],
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
    const { viemChain, holdings, usdc } = this.chainConfig;
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: holdings,
      abi: HOLDINGS_ABI,
      functionName: "deposit",
      args: [usdc, amountRaw],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async withdraw(amount: number): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain, holdings, usdc } = this.chainConfig;
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: holdings,
      abi: HOLDINGS_ABI,
      functionName: "withdraw",
      args: [usdc, amountRaw],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async mintCompleteSets(marketId: string, amount: number): Promise<Hex> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { viemChain, settlement } = this.chainConfig;
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: settlement,
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
    const { viemChain, settlement } = this.chainConfig;
    const amountRaw = parseUnits(amount.toString(), 6);

    const hash = await wallet.writeContract({
      account,
      chain: viemChain,
      address: settlement,
      abi: SETTLEMENT_ABI,
      functionName: "burnCompleteSetsFromHoldings",
      args: [marketId as Hex, amountRaw, this.address, creditInternal],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ─── Gasless (high-level: sign + relay) ───

  async gaslessSetup(): Promise<GaslessOperatorResult> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { settlement, holdings } = this.chainConfig;

    const nonce = (await this.publicClient.readContract({
      address: holdings,
      abi: OPERATOR_NONCE_ABI,
      functionName: "operatorNonce",
      args: [this.address],
    })) as bigint;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const signature = await wallet.signTypedData({
      account,
      domain: holdingsDomain(this.chainConfig),
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
      approved: true,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signature,
    });
  }

  async gaslessDeposit(amount: number): Promise<GaslessDepositResult> {
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const { usdc, holdings } = this.chainConfig;
    const amountRaw = parseUnits(amount.toString(), 6);

    const nonce = BigInt(Date.now());
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const signature = await wallet.signTypedData({
      account,
      domain: permit2Domain(this.chainConfig),
      types: PERMIT_TRANSFER_FROM_TYPES,
      primaryType: "PermitTransferFrom",
      message: {
        permitted: {
          token: usdc,
          amount: amountRaw,
        },
        spender: holdings,
        nonce,
        deadline,
      },
    });

    return this.relayDeposit({
      user: this.address,
      amount: amountRaw.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signature,
    });
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

  async relayDeposit(
    req: GaslessDepositRequest,
  ): Promise<GaslessDepositResult> {
    return this.http.post<GaslessDepositResult>(
      ENDPOINTS.gasless.depositWithPermit,
      req,
    );
  }
}
