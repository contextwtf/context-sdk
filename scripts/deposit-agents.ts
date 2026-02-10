/**
 * Deposit all USDC from agent wallets into Holdings.
 * Also approves Settlement as operator if needed.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  maxUint256,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const pub = createPublicClient({ chain: baseSepolia, transport: http() });

const HOLDINGS = "0x2C65541078F04B56975F31153D8465edD40eC4cF" as const;
const SETTLEMENT = "0x67b8f94DcaF32800Fa0cD476FBD8c1D1EB2d5209" as const;
const USDC = "0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e" as const;

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const holdingsAbi = parseAbi([
  "function deposit(address token, uint256 amount)",
  "function balanceOf(address user, address token) view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved)",
]);

async function setupAndDeposit(name: string, privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http() });

  const usdcBal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  console.log(`\n${name} (${account.address}): $${formatUnits(usdcBal, 6)} USDC in wallet`);

  if (usdcBal === 0n) {
    console.log("  No USDC to deposit (already in Holdings).");
  }

  if (usdcBal > 0n) {
    // 1. Approve Holdings to spend USDC
    const allowance = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, HOLDINGS] });
    if (allowance < usdcBal) {
      console.log("  Approving Holdings for USDC...");
      const tx = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [HOLDINGS, maxUint256] });
      await pub.waitForTransactionReceipt({ hash: tx });
      console.log("  Approved.");
    }

    // 2. Deposit USDC into Holdings
    console.log(`  Depositing $${formatUnits(usdcBal, 6)} into Holdings...`);
    const depositTx = await wallet.writeContract({ address: HOLDINGS, abi: holdingsAbi, functionName: "deposit", args: [USDC, usdcBal] });
    await pub.waitForTransactionReceipt({ hash: depositTx });
    console.log("  Deposited.");
  }

  // 3. Approve Settlement as operator (required for trading)
  console.log("  Setting Settlement as operator...");
  try {
    const opTx = await wallet.writeContract({ address: HOLDINGS, abi: holdingsAbi, functionName: "setApprovalForAll", args: [SETTLEMENT, true] });
    await pub.waitForTransactionReceipt({ hash: opTx });
    console.log("  Operator set.");
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.log(`  Operator setup: ${msg}`);
  }

  // Verify
  const holdingsBal = await pub.readContract({ address: HOLDINGS, abi: holdingsAbi, functionName: "balanceOf", args: [account.address, USDC] });
  console.log(`  Holdings balance: $${formatUnits(holdingsBal, 6)}`);
}

async function main() {
  const agents = [
    { name: "AGENT_1", key: process.env.AGENT_1_PRIVATE_KEY as Hex },
    { name: "AGENT_2", key: process.env.AGENT_2_PRIVATE_KEY as Hex },
    { name: "AGENT_3", key: process.env.AGENT_3_PRIVATE_KEY as Hex },
  ];

  for (const a of agents) {
    if (!a.key) { console.log(`${a.name}: no key found`); continue; }
    await setupAndDeposit(a.name, a.key);
  }

  console.log("\nAll agents deposited and ready for trading!");
}

main().catch(console.error);
