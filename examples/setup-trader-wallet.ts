/**
 * Set up the random trader wallet: approve contracts + deposit USDC.
 * Assumes ETH + USDC already transferred from MM wallet.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  maxUint256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ContextTrader } from "@context-markets/sdk";

const MM_KEY = process.env.CONTEXT_PRIVATE_KEY as Hex;
const TRADER_KEY = "0xb7907be8d52862c9eff217c22b0f1c383a224f3c8c3b88f14c48bfdeddd1488c" as Hex;

const USDC_ADDRESS = "0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e" as Hex;
const HOLDINGS_ADDRESS = "0x2C65541078F04B56975F31153D8465edD40eC4cF" as Hex;
const SETTLEMENT_ADDRESS = "0x67b8f94DcaF32800Fa0cD476FBD8c1D1EB2d5209" as Hex;

const erc20Abi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const holdingsAbi = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setOperator",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

async function main() {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });

  const traderAccount = privateKeyToAccount(TRADER_KEY);
  const traderWallet = createWalletClient({
    account: traderAccount,
    chain: baseSepolia,
    transport: http(),
  });

  console.log(`Trader wallet: ${traderAccount.address}`);

  // 1. Approve USDC for Holdings
  console.log("1. Approving USDC for Holdings...");
  const approveHash = await traderWallet.writeContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "approve",
    args: [HOLDINGS_ADDRESS, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log(`   Done: ${approveHash}`);

  // 2. Authorize Settlement as operator
  console.log("2. Setting Settlement as operator...");
  const operatorHash = await traderWallet.writeContract({
    address: HOLDINGS_ADDRESS,
    abi: holdingsAbi,
    functionName: "setOperator",
    args: [SETTLEMENT_ADDRESS, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: operatorHash });
  console.log(`   Done: ${operatorHash}`);

  // 3. Deposit USDC into Holdings
  console.log("3. Depositing 500 USDC into Holdings...");
  const depositHash = await traderWallet.writeContract({
    address: HOLDINGS_ADDRESS,
    abi: holdingsAbi,
    functionName: "deposit",
    args: [USDC_ADDRESS, parseUnits("500", 6)],
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log(`   Done: ${depositHash}`);

  // 4. Verify via API
  const trader = new ContextTrader({
    apiKey: process.env.CONTEXT_API_KEY!,
    signer: { privateKey: TRADER_KEY },
  });
  const balance = await trader.getMyBalance();
  console.log(`\nTrader ready! Settlement balance: ${balance.usdc.settlementBalance}`);
}

main().catch(console.error);
