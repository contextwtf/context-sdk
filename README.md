# Context Markets SDK

TypeScript SDK and agent framework for trading on [Context Markets](https://context.wtf) — an AI-powered prediction market platform on Base.

## Packages

| Package | Description |
|---------|-------------|
| [`@context-markets/sdk`](packages/sdk) | Core SDK — market data, order placement, EIP-712 signing, wallet management |
| [`@context-markets/agent`](packages/agent) | Agent runtime — pluggable strategies, risk management, automated trading loops |

## Quick Start

```bash
npm install
npm run build
```

### Read Market Data (no auth)

```ts
import { ContextClient } from "@context-markets/sdk";

const client = new ContextClient();

const { markets } = await client.searchMarkets({ query: "elections", status: "active" });
const orderbook = await client.getOrderbook(markets[0].id);
const oracle = await client.getOracleSignals(markets[0].id);
```

### Place an Order

```ts
import { ContextTrader } from "@context-markets/sdk";

const trader = new ContextTrader({
  apiKey: process.env.CONTEXT_API_KEY!,
  signer: { privateKey: process.env.CONTEXT_PRIVATE_KEY! as `0x${string}` },
});

await trader.placeOrder({
  marketId: "0x...",
  outcome: "yes",
  side: "buy",
  priceCents: 45,   // 45¢
  size: 10,          // 10 contracts
});
```

### Run an Agent

```ts
import { AgentRuntime, AdaptiveMmStrategy } from "@context-markets/agent";

const agent = new AgentRuntime({
  trader: { apiKey, signer: { privateKey } },
  strategy: new AdaptiveMmStrategy({
    markets: { type: "ids", ids: ["0x..."] },
    fairValueCents: 50,
    levels: 3,
    levelSpacingCents: 2,
    levelSize: 10,
    baseSpreadCents: 2,
    skewPerContract: 0.1,
    maxSkewCents: 5,
    requoteDeltaCents: 1,
    useOracleAnchor: true,
  }),
  risk: {
    maxPositionSize: 200,
    maxOpenOrders: 80,
    maxOrderSize: 50,
    maxLoss: -100,
  },
  intervalMs: 15_000,
  dryRun: true,
});

await agent.start(); // Ctrl+C to stop
```

## SDK (`@context-markets/sdk`)

### ContextClient (read-only)

| Method | Description |
|--------|-------------|
| `searchMarkets({ query, status })` | Search markets by keyword |
| `getMarket(id)` | Get market details |
| `getQuotes(marketId)` | Get AI probability estimates |
| `getOrderbook(marketId)` | Get bid/ask ladder |
| `getOracleSignals(marketId)` | Get oracle confidence signals |
| `simulateTrade(params)` | Simulate trade for slippage |
| `getPriceHistory(marketId, interval)` | OHLCV candle data |
| `getMarketActivity(marketId)` | Market event feed |
| `getGlobalActivity()` | Platform-wide activity |
| `getBalance(address)` | Holdings balance for any address |

### ContextTrader (extends ContextClient)

| Method | Description |
|--------|-------------|
| `placeOrder(req)` | Place a signed limit order |
| `cancelOrder(nonce)` | Cancel by nonce |
| `cancelReplace(cancelNonce, newOrder)` | Atomic cancel + replace |
| `bulkCreateOrders(orders)` | Place multiple orders |
| `bulkCancelOrders(nonces)` | Cancel multiple orders (max 20) |
| `getMyOrders()` | Query your open orders |
| `getMyPortfolio()` | Your positions across markets |
| `getMyBalance()` | Your USDC balance in Holdings |
| `depositUsdc(amount)` | Deposit USDC into Holdings |
| `withdrawUsdc(amount)` | Withdraw USDC from Holdings |
| `checkSetup()` | Check wallet approval status |
| `setupWallet()` | Approve contracts for trading |
| `mintTestUsdc(amount)` | Mint testnet USDC (Base Sepolia) |

### Pricing

Prices are in **cents** (1-99). Sizes are in **contracts**. The SDK handles on-chain encoding internally.

```
45¢ = 45% probability = 0.45 USDC per contract
```

## Agent Framework (`@context-markets/agent`)

### Built-in Strategies

| Strategy | Description |
|----------|-------------|
| `SimpleMmStrategy` | Quotes one bid/ask level around the orderbook midpoint |
| `OracleTrackerStrategy` | Buys when oracle confidence exceeds market price by a threshold |
| `AdaptiveMmStrategy` | Multi-level bid/ask ladders on YES + NO with inventory-aware skewing |

### AdaptiveMmStrategy

The most complete strategy — quotes depth on both outcomes and adjusts to order flow:

- Quotes `N` levels of bids and asks on both YES and NO outcomes
- YES fair value is configurable (or anchored to oracle); NO = 100 - YES
- Tracks inventory per outcome independently
- **Skews quotes** based on position: long inventory shifts quotes down to offload, short shifts up to accumulate
- Only re-quotes when fair value or skew changes beyond a threshold

### Custom Strategies

Implement the `Strategy` interface:

```ts
import type { Strategy, MarketSelector, MarketSnapshot, AgentState, Action } from "@context-markets/agent";

class MyStrategy implements Strategy {
  name = "My Strategy";

  async selectMarkets(): Promise<MarketSelector> {
    return { type: "search", query: "politics", status: "active" };
  }

  async evaluate(markets: MarketSnapshot[], state: AgentState): Promise<Action[]> {
    // Your logic here — return place_order, cancel_order, or no_action
    return [{ type: "no_action", reason: "evaluating" }];
  }
}
```

### Risk Management

The `AgentRuntime` enforces risk limits on every cycle:

```ts
risk: {
  maxPositionSize: 200,    // Max contracts per market
  maxOpenOrders: 80,       // Global open order limit
  maxOrderSize: 50,        // Per-order size cap
  maxLoss: -100,           // Stop-loss threshold (USDC)
  maxOrdersPerMarketPerCycle: 20, // Rate limiting
}
```

## Examples

Run any example with:

```bash
CONTEXT_API_KEY=ctx_pk_... CONTEXT_PRIVATE_KEY=0x... npx tsx examples/<file>.ts
```

| Example | Description |
|---------|-------------|
| `basic-read.ts` | Search markets, read quotes/orderbook/oracle (no auth) |
| `place-order.ts` | Place, query, and cancel orders |
| `setup-trader-wallet.ts` | One-time wallet setup: approve contracts + deposit USDC |
| `deposit-usdc.ts` | Deposit USDC into Holdings contract |
| `simple-mm-agent.ts` | Run the simple market maker (dry run) |
| `oracle-tracker-agent.ts` | Run the oracle tracker (dry run, 3 cycles) |
| `adaptive-mm-agent.ts` | Run the adaptive market maker (dry run or live) |
| `random-trader-agent.ts` | Generate random order flow against existing liquidity |

Set `DRY_RUN=false` for live trading on any agent example.

## Architecture

```
@context-markets/sdk
├── ContextClient          # Read-only API (markets, orderbook, oracle)
├── ContextTrader          # Trading (orders, wallet, signing)
├── EIP-712 Signing        # Off-chain order signatures (viem)
└── Encoding               # Price/size unit conversions

@context-markets/agent
├── AgentRuntime           # Event loop: fetch → evaluate → risk check → execute
├── Strategy (interface)   # Pluggable decision logic
├── RiskManager            # Per-cycle limit enforcement
├── TradeLogger            # Structured logging with cycle tracking
└── Built-in Strategies
    ├── SimpleMmStrategy       # Spread around midpoint
    ├── OracleTrackerStrategy  # Signal-following
    └── AdaptiveMmStrategy     # Multi-level, inventory-aware MM
```

## Network

Currently targeting **Base Sepolia** (chain ID 84532) testnet.

| Contract | Address |
|----------|---------|
| USDC | `0xBbee2756d3169CF7065e5E9C4A5EA9b1D1Fd415e` |
| Holdings | `0x2C65541078F04B56975F31153D8465edD40eC4cF` |
| Settlement | `0x67b8f94DcaF32800Fa0cD476FBD8c1D1EB2d5209` |

## Development

```bash
npm install          # Install dependencies
npm run build        # Build both packages
npm run typecheck    # Type check without emitting
npm run clean        # Remove dist/ folders
```

Requires Node 18+.
