/**
 * Deposit USDC into the Holdings contract for trading.
 *
 * Usage:
 *   CONTEXT_API_KEY=... CONTEXT_PRIVATE_KEY=... npx tsx examples/deposit-usdc.ts [amount]
 */
import { ContextTrader } from "@context-markets/sdk";
import type { Hex } from "viem";

async function main() {
  const apiKey = process.env.CONTEXT_API_KEY;
  const privateKey = process.env.CONTEXT_PRIVATE_KEY as Hex | undefined;
  const amount = Number(process.argv[2]) || 1000;

  if (!apiKey || !privateKey) {
    console.error("CONTEXT_API_KEY and CONTEXT_PRIVATE_KEY required");
    process.exit(1);
  }

  const trader = new ContextTrader({
    apiKey,
    signer: { privateKey } as const,
  });

  console.log(`Wallet: ${trader.address}`);

  const balance = await trader.getMyBalance();
  console.log(`Balance before: settlement=${balance.usdc.settlementBalance}, wallet=${balance.usdc.walletBalance}`);

  console.log(`\nDepositing ${amount} USDC into Holdings...`);
  const hash = await trader.depositUsdc(amount);
  console.log(`Deposit tx: ${hash}`);

  const balanceAfter = await trader.getMyBalance();
  console.log(`\nBalance after: settlement=${balanceAfter.usdc.settlementBalance}, wallet=${balanceAfter.usdc.walletBalance}`);
}

main().catch(console.error);
