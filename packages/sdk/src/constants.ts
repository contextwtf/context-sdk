import type { Address } from "viem";

// ─── API ───

export const API_BASE = "https://api-beta.context.wtf/public/v2";

// ─── Contract Addresses (Base Sepolia) ───

export const SETTLEMENT_ADDRESS: Address =
  "0x67b8f94DcaF32800Fa0cD476FBD8c1D1EB2d5209";
export const HOLDINGS_ADDRESS: Address =
  "0x2C65541078F04B56975F31153D8465edD40eC4cF";
export const USDC_ADDRESS: Address =
  "0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e";

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

// ─── Encoding Multipliers ───

/** Price: cents → on-chain (× 10,000) */
export const PRICE_MULTIPLIER = 10_000n;

/** Size: shares → on-chain (× 1,000,000) */
export const SIZE_MULTIPLIER = 1_000_000n;

/** Fee divisor: 1% of notional */
export const FEE_DIVISOR = 100n;

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
    name: "setApprovalForAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "isApprovedForAll",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
