/**
 * Trading example — place an order, query it, cancel it.
 *
 * Requires:
 *   CONTEXT_API_KEY=ctx_pk_...
 *   CONTEXT_PRIVATE_KEY=0x...
 *
 * Usage:
 *   npx tsx examples/place-order.ts
 */
import { ContextClient } from "@context-markets/sdk";
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

  console.log(`Trader address: ${ctx.address}`);

  // Check wallet setup
  console.log("\n--- Wallet Status ---");
  const status = await ctx.account.status();
  console.log(`  ETH balance: ${status.ethBalance}`);
  console.log(`  USDC allowance: ${status.usdcAllowance}`);
  console.log(`  Operator approved: ${status.isOperatorApproved}`);

  if (status.needsApprovals) {
    console.log("\nSetting up wallet approvals...");
    const result = await ctx.account.setup();
    console.log("  USDC approval tx:", result.usdcApprovalTx);
    console.log("  Operator approval tx:", result.operatorApprovalTx);
  }

  // Find a market to trade on
  const { markets } = await ctx.markets.list({
    status: "active",
    limit: 1,
  });

  if (markets.length === 0) {
    console.log("No active markets found");
    return;
  }

  const market = markets[0];
  console.log(`\n--- Trading on: ${market.question} ---`);
  console.log(`  Market ID: ${market.id}`);

  // Place order
  console.log("\nPlacing order: BUY 5 YES @ 25¢...");
  const order = await ctx.orders.create({
    marketId: market.id,
    outcome: "yes",
    side: "buy",
    priceCents: 25,
    size: 5,
  });
  console.log(`  Order placed! Nonce: ${order.nonce}`);

  // Query our orders
  console.log("\nMy open orders:");
  const myOrders = await ctx.orders.mine(market.id);
  for (const o of myOrders) {
    console.log(
      `  ${o.side} ${o.size} ${o.outcome} @ ${o.price}¢ (nonce: ${o.nonce})`,
    );
  }

  // Cancel the order
  console.log(`\nCancelling order ${order.nonce}...`);
  const cancel = await ctx.orders.cancel(order.nonce);
  console.log(`  Cancelled: ${cancel.success}`);

  // Check balance
  console.log("\n--- Balance ---");
  const balance = await ctx.portfolio.balance();
  console.log(`  USDC: ${balance.usdc}`);

  console.log("\nDone!");
}

main().catch(console.error);
