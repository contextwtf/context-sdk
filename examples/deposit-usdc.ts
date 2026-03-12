/**
 * Deposit USDC into the Holdings contract for trading.
 *
 * Usage:
 *   CONTEXT_API_KEY=... CONTEXT_PRIVATE_KEY=... npx tsx examples/deposit-usdc.ts [amount]
 */
import { ContextClient } from "context-markets";
import type { Hex } from "viem";

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = process.env.CONTEXT_PRIVATE_KEY as Hex | undefined;
  const amount = Number(process.argv[2]) || 1000;

  if (!apiKey || !privateKey) {
    console.error("CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY required");
    process.exit(1);
  }

  const ctx = new ContextClient({
    apiKey,
    signer: { privateKey },
  });

  console.log(`Wallet: ${ctx.address}`);

  const balance = await ctx.portfolio.balance();
  console.log(`Balance before: ${balance.usdc}`);

  console.log(`\nDepositing ${amount} USDC into Holdings...`);
  const hash = await ctx.account.deposit(amount);
  console.log(`Deposit tx: ${hash}`);

  const balanceAfter = await ctx.portfolio.balance();
  console.log(`\nBalance after: ${balanceAfter.usdc}`);
}

main().catch(console.error);
