/**
 * Auto-generated from http://localhost:3001/public/v2/openapi.json
 * DO NOT EDIT — re-run `bun run generate` instead.
 */

export const ENDPOINTS = {
  activity: {
    global: "/activity",
  },
  markets: {
    list: "/markets",
    create: "/markets/create",
    get: (id: string) => `/markets/${id}` as const,
    activity: (id: string) => `/markets/${id}/activity` as const,
    oracle: (id: string) => `/markets/${id}/oracle` as const,
    oracleQuotes: (id: string) => `/markets/${id}/oracle/quotes` as const,
    oracleQuotesLatest: (id: string) => `/markets/${id}/oracle/quotes/latest` as const,
    orderbook: (id: string) => `/markets/${id}/orderbook` as const,
    prices: (id: string) => `/markets/${id}/prices` as const,
    quotes: (id: string) => `/markets/${id}/quotes` as const,
    simulate: (id: string) => `/markets/${id}/simulate` as const,
  },
  orders: {
    create: "/orders",
    recent: "/orders/recent",
    get: (id: string) => `/orders/${id}` as const,
    cancel: "/orders/cancel",
    cancelReplace: "/orders/cancel-replace",
    bulk: "/orders/bulk",
    bulkCreate: "/orders/bulk/create",
    bulkCancel: "/orders/bulk/cancel",
    simulate: "/orders/simulate",
    list: "/orders",
  },
  portfolio: {
    get: (address: string) => `/portfolio/${address}` as const,
    claimable: (address: string) => `/portfolio/${address}/claimable` as const,
    positions: (address: string) => `/portfolio/${address}/positions` as const,
    stats: (address: string) => `/portfolio/${address}/stats` as const,
  },
  balance: {
    mintTestUsdc: "/balance/mint-test-usdc",
    tokenBalance: "/balance",
    settlement: "/balance/settlement",
    get: (address: string) => `/balance/${address}` as const,
  },
  gasless: {
    operator: "/gasless/operator",
    depositWithPermit: "/gasless/deposit-with-permit",
  },
  questions: {
    submit: "/questions",
    agentSubmit: "/questions/agent-submit",
    submission: (id: string) => `/questions/submissions/${id}` as const,
  },
} as const;
