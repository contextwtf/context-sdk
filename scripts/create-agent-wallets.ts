/**
 * Create 3 new agent wallets, fund with ETH, and save keys.
 */

import { readFileSync, appendFileSync } from "fs";
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
  formatEther,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const pub = createPublicClient({ chain: baseSepolia, transport: http() });

const AGENT_NAMES = ["AGENT_1", "AGENT_2", "AGENT_3"];

async function main() {
  const funderKey = process.env.MM_PRIVATE_KEY as Hex;
  const funder = privateKeyToAccount(funderKey);
  const funderWallet = createWalletClient({ account: funder, chain: baseSepolia, transport: http() });

  const funderBal = await pub.getBalance({ address: funder.address });
  console.log(`Funder (MM): ${funder.address} — ${formatEther(funderBal)} ETH\n`);

  // Step 1: Generate all keys upfront
  const wallets = AGENT_NAMES.map((name) => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    return { name, address: acct.address, privateKey: pk };
  });

  // Step 2: Save to .env immediately (before funding, so keys are never lost)
  const envLines = [
    "",
    `# ─── Agent Test Wallets (created ${new Date().toISOString().split("T")[0]}) ───`,
  ];
  for (const w of wallets) {
    envLines.push(`# ${w.name} wallet (${w.address})`);
    envLines.push(`${w.name}_PRIVATE_KEY=${w.privateKey}`);
  }
  appendFileSync(envPath, envLines.join("\n") + "\n");
  console.log("Keys saved to .env\n");

  // Step 3: Fund each wallet sequentially, waiting for confirmation before next
  const ethPerWallet = parseEther("0.005");

  for (const w of wallets) {
    console.log(`Funding ${w.name} (${w.address})...`);
    try {
      const hash = await funderWallet.sendTransaction({
        to: w.address,
        value: ethPerWallet,
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      console.log(`  Done — block ${receipt.blockNumber}, tx: ${hash.slice(0, 18)}...\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.error(`  Failed: ${msg}\n`);
    }
  }

  // Summary
  console.log("=== Agent Wallets ===");
  for (const w of wallets) {
    const bal = await pub.getBalance({ address: w.address });
    console.log(`${w.name}: ${w.address} — ${formatEther(bal)} ETH`);
  }
  console.log("\nReady for USDC funding!");
}

main().catch(console.error);
