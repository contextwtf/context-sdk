import type { Address } from "viem";

// ─── API ───

export const API_BASE = "https://api-testnet.context.markets/v2";

// ─── Contract Addresses (Base Sepolia) ───

export const SETTLEMENT_ADDRESS: Address =
  "0xABfB9e3Dc252D59e4e4A3c3537D96F3F207C9b2c";
export const HOLDINGS_ADDRESS: Address =
  "0x769341425095155C0A0620eBC308d4C05980B84a";
export const USDC_ADDRESS: Address =
  "0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e";
export const PERMIT2_ADDRESS: Address =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const CHAIN_ID = 84532; // Base Sepolia

// ─── EIP-712 Domain ───

export const EIP712_DOMAIN = {
  name: "Settlement" as const,
  version: "1" as const,
  chainId: CHAIN_ID,
  verifyingContract: SETTLEMENT_ADDRESS,
} as const;

// ─── EIP-712 Types ───

export const ORDER_TYPES = {
  Order: [
    { name: "marketId", type: "bytes32" },
    { name: "trader", type: "address" },
    { name: "price", type: "uint256" },
    { name: "size", type: "uint256" },
    { name: "outcomeIndex", type: "uint8" },
    { name: "side", type: "uint8" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "makerRoleConstraint", type: "uint8" },
    { name: "inventoryModeConstraint", type: "uint8" },
  ],
} as const;

export const CANCEL_TYPES = {
  CancelNonce: [
    { name: "trader", type: "address" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// ─── ABIs (minimal, for wallet setup) ───

export const ERC20_ABI = [
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
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const HOLDINGS_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setOperator",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isOperatorFor",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
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
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const SETTLEMENT_ABI = [
  {
    name: "mintCompleteSetsFromHoldings",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "burnCompleteSetsFromHoldings",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "creditInternal", type: "bool" },
    ],
    outputs: [],
  },
] as const;
