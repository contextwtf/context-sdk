import type { Address, Chain } from "viem";
import { base, baseSepolia } from "viem/chains";

// ─── Chain Configuration ───

export interface ChainConfig {
  chainId: number;
  viemChain: Chain;
  apiBase: string;
  settlement: Address;
  holdings: Address;
  usdc: Address;
  permit2: Address;
}

export const MAINNET_CONFIG: ChainConfig = {
  chainId: 8453,
  viemChain: base,
  apiBase: "https://api.context.markets/v2",
  settlement: "0x000000000000aF25d425101A0C8e3adFB67BCfD0",
  holdings: "0x0000000000001dDF1a31899d57ddAd89DE10ab1b",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};

export const TESTNET_CONFIG: ChainConfig = {
  chainId: 84532,
  viemChain: baseSepolia,
  apiBase: "https://api-testnet.context.markets/v2",
  settlement: "0xD91935a82Af48ff79a68134d9Eab8fc9e5d3504D",
  holdings: "0x0a6D61723E8AE8e34734A84075a1b58aB3eEca6a",
  usdc: "0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};

export type ChainOption = "mainnet" | "testnet";

export function resolveChainConfig(chain: ChainOption = "mainnet"): ChainConfig {
  return chain === "testnet" ? TESTNET_CONFIG : MAINNET_CONFIG;
}

// ─── EIP-712 Domain Builders ───

export function settlementDomain(config: ChainConfig) {
  return {
    name: "Settlement" as const,
    version: "1" as const,
    chainId: config.chainId,
    verifyingContract: config.settlement,
  } as const;
}

export function holdingsDomain(config: ChainConfig) {
  return {
    name: "Holdings" as const,
    version: "1" as const,
    chainId: config.chainId,
    verifyingContract: config.holdings,
  } as const;
}

export function permit2Domain(config: ChainConfig) {
  return {
    name: "Permit2" as const,
    chainId: config.chainId,
    verifyingContract: config.permit2,
  } as const;
}

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

export const MARKET_ORDER_INTENT_TYPES = {
  MarketOrderIntent: [
    { name: "marketId", type: "bytes32" },
    { name: "trader", type: "address" },
    { name: "maxSize", type: "uint256" },
    { name: "maxPrice", type: "uint256" },
    { name: "outcomeIndex", type: "uint8" },
    { name: "side", type: "uint8" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint256" },
    { name: "maxFee", type: "uint256" },
  ],
} as const;

export const CANCEL_TYPES = {
  CancelNonce: [
    { name: "trader", type: "address" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const OPERATOR_APPROVAL_TYPES = {
  OperatorApproval: [
    { name: "user", type: "address" },
    { name: "operator", type: "address" },
    { name: "approved", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const PERMIT_TRANSFER_FROM_TYPES = {
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
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
    outputs: [],
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

export const OPERATOR_NONCE_ABI = [
  {
    name: "operatorNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ─── Legacy Compat (deprecated — use ChainConfig) ───

/** @deprecated Use `resolveChainConfig("mainnet").apiBase` */
export const API_BASE = MAINNET_CONFIG.apiBase;
/** @deprecated Use `resolveChainConfig(chain).settlement` */
export const SETTLEMENT_ADDRESS = MAINNET_CONFIG.settlement;
/** @deprecated Use `resolveChainConfig(chain).holdings` */
export const HOLDINGS_ADDRESS = MAINNET_CONFIG.holdings;
/** @deprecated Use `resolveChainConfig(chain).usdc` */
export const USDC_ADDRESS = MAINNET_CONFIG.usdc;
/** @deprecated Use `resolveChainConfig(chain).permit2` */
export const PERMIT2_ADDRESS = MAINNET_CONFIG.permit2;
/** @deprecated Use `resolveChainConfig(chain).chainId` */
export const CHAIN_ID = MAINNET_CONFIG.chainId;
/** @deprecated Use `settlementDomain(config)` */
export const EIP712_DOMAIN = settlementDomain(MAINNET_CONFIG);
/** @deprecated Use `holdingsDomain(config)` */
export const HOLDINGS_EIP712_DOMAIN = holdingsDomain(MAINNET_CONFIG);
/** @deprecated Use `permit2Domain(config)` */
export const PERMIT2_EIP712_DOMAIN = permit2Domain(MAINNET_CONFIG);
