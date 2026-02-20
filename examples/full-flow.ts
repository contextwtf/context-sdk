/**
 * End-to-end flow: wallet setup → mint → approve → deposit → create market
 *
 * Usage:
 *   bun run examples/full-flow.ts
 *
 * Environment variables:
 *   PRIVATE_KEY   — hex private key (generates a random one if not set)
 *   API_KEY       — Context API key (default: none)
 *   QUESTION      — question to submit (default: "Will Bitcoin hit $200k by end of 2026?")
 */
import { ContextClient } from "../src/index.js";
import { generatePrivateKey } from "viem/accounts";

const privateKey = (process.env.CONTEXT_PRIVATE_KEY as `0x${string}`) ?? generatePrivateKey();
const apiKey = process.env.CONTEXT_API_KEY;
const question = process.env.QUESTION ?? "Will Bitcoin hit $200k by end of 2026?";

async function main() {
  console.log("=== Context SDK Full Flow ===\n");

  // 1. Create client with signer
  const ctx = new ContextClient({
    apiKey,
    signer: { privateKey },
  });

  console.log(`Wallet: ${ctx.address}`);

  // 2. Check wallet status
  console.log("\n--- Wallet Status ---");
  const status = await ctx.account.status();
  console.log(`  ETH balance: ${status.ethBalance}`);
  console.log(`  USDC allowance: ${status.usdcAllowance}`);
  console.log(`  Operator approved: ${status.isOperatorApproved}`);
  console.log(`  Needs approvals: ${status.needsApprovals}`);

  // 3. Mint test USDC
  console.log("\n--- Minting Test USDC ---");
  const mintResult = await ctx.account.mintTestUsdc(1000);
  console.log(`  Mint result:`, mintResult);

  // 4. Approve & setup (USDC allowance + operator approval)
  if (status.needsApprovals) {
    console.log("\n--- Setting Up Approvals ---");
    const setupResult = await ctx.account.setup();
    console.log(`  USDC approval tx: ${setupResult.usdcApprovalTx ?? "already approved"}`);
    console.log(`  Operator approval tx: ${setupResult.operatorApprovalTx ?? "already approved"}`);
  } else {
    console.log("\n--- Approvals already in place ---");
  }

  // 5. Deposit USDC into Holdings
  console.log("\n--- Depositing 100 USDC ---");
  const depositTx = await ctx.account.deposit(100);
  console.log(`  Deposit tx: ${depositTx}`);

  // 6. Check balance after deposit
  console.log("\n--- Balance After Deposit ---");
  const balance = await ctx.portfolio.balance();
  console.log(`  USDC settlement balance: ${balance.usdc.settlementBalance}`);
  console.log(`  USDC wallet balance: ${balance.usdc.walletBalance}`);

  // 7. Submit question and wait for generation
  console.log("\n--- Submitting Question ---");
  console.log(`  Question: "${question}"`);
  const submission = await ctx.questions.submitAndWait(question, {
    pollIntervalMs: 2000,
    maxAttempts: 45,
  });
  console.log(`  Status: ${submission.status}`);
  console.log(`  Generated ${submission.questions.length} question(s):`);
  for (const q of submission.questions) {
    console.log(`    - [${q.id}] ${q.text ?? "(no text)"}`);
    if (q.criteria) console.log(`      Criteria: ${q.criteria}`);
  }

  // 8. Create market from first generated question
  const firstQuestion = submission.questions[0];
  if (!firstQuestion) {
    console.error("No questions generated!");
    process.exit(1);
  }

  console.log("\n--- Creating Market ---");
  console.log(`  Using question ID: ${firstQuestion.id}`);
  const market = await ctx.markets.create(firstQuestion.id);
  console.log(`  Market ID: ${market.marketId}`);
  console.log(`  Tx Hash: ${market.txHash}`);

  console.log("\n=== Done! ===");
}

main().catch((err) => {
  console.error("Flow failed:", err);
  process.exit(1);
});
