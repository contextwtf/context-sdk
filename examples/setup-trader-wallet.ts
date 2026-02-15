/**
 * Set up a trader wallet: check status + auto-approve contracts.
 *
 * Requires:
 *   CONTEXT_API_KEY=ctx_pk_...
 *   CONTEXT_PRIVATE_KEY=0x...
 *
 * Usage:
 *   npx tsx examples/setup-trader-wallet.ts
 */
import { ContextClient } from "@contextwtf/sdk";
import type { Hex } from "viem";

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = process.env.CONTEXT_PRIVATE_KEY as Hex | undefined;

  if (!apiKey || !privateKey) {
    console.error("Set CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY env vars");
    process.exit(1);
  }

  const ctx = new ContextClient({
    apiKey,
    signer: { privateKey },
  });

  console.log(`Wallet: ${ctx.address}`);

  // Check current status
  console.log("\n--- Checking wallet status ---");
  const status = await ctx.account.status();
  console.log(`  ETH balance: ${status.ethBalance}`);
  console.log(`  USDC allowance: ${status.usdcAllowance}`);
  console.log(`  Operator approved: ${status.isOperatorApproved}`);
  console.log(`  Needs approvals: ${status.needsApprovals}`);

  if (status.needsApprovals) {
    console.log("\n--- Running setup ---");
    const result = await ctx.account.setup();
    if (result.usdcApprovalTx) {
      console.log(`  USDC approval tx: ${result.usdcApprovalTx}`);
    }
    if (result.operatorApprovalTx) {
      console.log(`  Operator approval tx: ${result.operatorApprovalTx}`);
    }
    console.log("  Setup complete!");
  } else {
    console.log("\nWallet already set up.");
  }

  // Check balance
  const balance = await ctx.portfolio.balance();
  console.log(`\nSettlement balance: ${balance.usdc}`);
}

main().catch(console.error);
