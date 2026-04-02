import type { Address, Chain } from "viem";
import { base, baseSepolia } from "viem/chains";

// ─── Chain Configuration ───

export type SettlementVersion = 1 | 2;
export type TimeInForce = 0 | 1 | 2;

export const TIME_IN_FORCE_GTC = 0 as const;
export const TIME_IN_FORCE_IOC = 1 as const;
export const TIME_IN_FORCE_FOK = 2 as const;

export const ORDER_KIND_BUY = 0 as const;
export const ORDER_KIND_SELL_INVENTORY = 1 as const;
export const ORDER_KIND_SELL_NO_INVENTORY = 2 as const;

export interface ChainConfig {
  chainId: number;
  viemChain: Chain;
  apiBase: string;
  defaultSettlementVersion: SettlementVersion;
  settlement: Address;
  holdings: Address;
  legacySettlement: Address;
  settlementV2: Address;
  legacyHoldings: Address;
  newHoldings: Address;
  usdc: Address;
  permit2: Address;
}

const buildChainConfig = ({
  defaultSettlementVersion,
  legacySettlement,
  settlementV2,
  legacyHoldings,
  newHoldings,
  ...rest
}: Omit<ChainConfig, "settlement" | "holdings">) => {
  const settlement =
    defaultSettlementVersion === 2 ? settlementV2 : legacySettlement;
  const holdings =
    defaultSettlementVersion === 2 ? newHoldings : legacyHoldings;

  return {
    ...rest,
    defaultSettlementVersion,
    settlement,
    holdings,
    legacySettlement,
    settlementV2,
    legacyHoldings,
    newHoldings,
  } satisfies ChainConfig;
};

export const MAINNET_CONFIG = buildChainConfig({
  chainId: 8453,
  viemChain: base,
  apiBase: "https://api.context.markets/v2",
  defaultSettlementVersion: 2,
  legacySettlement: "0x000000000000aF25d425101A0C8e3adFB67BCfD0",
  settlementV2: "0x00000000008c286A2aaa99c6Be3b3D405A929500",
  legacyHoldings: "0x0000000000001dDF1a31899d57ddAd89DE10ab1b",
  newHoldings: "0x0000000000CcA5bC44912C63d63e1673FeE923f6",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
});

export const TESTNET_CONFIG = buildChainConfig({
  chainId: 84532,
  viemChain: baseSepolia,
  apiBase: "https://api-testnet.context.markets/v2",
  defaultSettlementVersion: 2,
  legacySettlement: "0xD91935a82Af48ff79a68134d9Eab8fc9e5d3504D",
  settlementV2: "0xa9b830f4496b88c2d3C103fB96Df8f413031eBDD",
  legacyHoldings: "0x0a6D61723E8AE8e34734A84075a1b58aB3eEca6a",
  newHoldings: "0xBed9a1A6CB168D60aD2C7770Be6B62bD9244D6d3",
  usdc: "0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
});

export type ChainOption = "mainnet" | "testnet";

export function resolveChainConfig(chain: ChainOption = "mainnet"): ChainConfig {
  return chain === "testnet" ? TESTNET_CONFIG : MAINNET_CONFIG;
}

export function getSettlementAddress(
  config: ChainConfig,
  settlementVersion: SettlementVersion = config.defaultSettlementVersion,
) {
  return settlementVersion === 2
    ? config.settlementV2
    : config.legacySettlement;
}

export function getHoldingsAddress(
  config: ChainConfig,
  settlementVersion: SettlementVersion = config.defaultSettlementVersion,
) {
  return settlementVersion === 2
    ? config.newHoldings
    : config.legacyHoldings;
}

// ─── EIP-712 Domain Builders ───

export function settlementDomain(
  config: ChainConfig,
  settlementVersion: SettlementVersion = 1,
) {
  return {
    name: "Settlement" as const,
    version: settlementVersion === 2 ? ("2" as const) : ("1" as const),
    chainId: config.chainId,
    verifyingContract: getSettlementAddress(config, settlementVersion),
  } as const;
}

export function settlementV2Domain(config: ChainConfig) {
  return settlementDomain(config, 2);
}

export function holdingsDomain(
  config: ChainConfig,
  settlementVersion: SettlementVersion = config.defaultSettlementVersion,
) {
  return {
    name: "Holdings" as const,
    version: "1" as const,
    chainId: config.chainId,
    verifyingContract: getHoldingsAddress(config, settlementVersion),
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

export const SETTLEMENT_V2_ORDER_TYPES = {
  Order: [
    { name: "marketId", type: "bytes32" },
    { name: "trader", type: "address" },
    { name: "maxShares", type: "uint256" },
    { name: "minSharesOut", type: "uint256" },
    { name: "maxCollateralIn", type: "uint256" },
    { name: "minCollateralOut", type: "uint256" },
    { name: "outcomeIndex", type: "uint8" },
    { name: "orderKind", type: "uint8" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "timeInForce", type: "uint8" },
    { name: "makerRoleConstraint", type: "uint8" },
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

export const BATCH_WITHDRAW_TYPES = {
  BatchWithdraw: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "withdrawsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
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
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
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
      { name: "to", type: "address" },
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
      { name: "to", type: "address" },
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
/** @deprecated Use `resolveChainConfig(chain).legacySettlement` */
export const LEGACY_SETTLEMENT_ADDRESS = MAINNET_CONFIG.legacySettlement;
/** @deprecated Use `resolveChainConfig(chain).settlementV2` */
export const SETTLEMENT_V2_ADDRESS = MAINNET_CONFIG.settlementV2;
/** @deprecated Use `resolveChainConfig(chain).legacyHoldings` */
export const LEGACY_HOLDINGS_ADDRESS = MAINNET_CONFIG.legacyHoldings;
/** @deprecated Use `resolveChainConfig(chain).newHoldings` */
export const NEW_HOLDINGS_ADDRESS = MAINNET_CONFIG.newHoldings;
/** @deprecated Use `resolveChainConfig(chain).usdc` */
export const USDC_ADDRESS = MAINNET_CONFIG.usdc;
/** @deprecated Use `resolveChainConfig(chain).permit2` */
export const PERMIT2_ADDRESS = MAINNET_CONFIG.permit2;
/** @deprecated Use `resolveChainConfig(chain).chainId` */
export const CHAIN_ID = MAINNET_CONFIG.chainId;
/** @deprecated Use `settlementDomain(config)` */
export const EIP712_DOMAIN = settlementDomain(MAINNET_CONFIG);
/** @deprecated Use `settlementV2Domain(config)` */
export const EIP712_DOMAIN_V2 = settlementV2Domain(MAINNET_CONFIG);
/** @deprecated Use `holdingsDomain(config)` */
export const HOLDINGS_EIP712_DOMAIN = holdingsDomain(MAINNET_CONFIG);
/** @deprecated Use `permit2Domain(config)` */
export const PERMIT2_EIP712_DOMAIN = permit2Domain(MAINNET_CONFIG);
