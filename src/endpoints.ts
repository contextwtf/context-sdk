export const ENDPOINTS = {
  markets: {
    list: "/markets",
    get: (id: string) => `/markets/${id}` as const,
    quotes: (id: string) => `/markets/${id}/quotes` as const,
    orderbook: (id: string) => `/markets/${id}/orderbook` as const,
    simulate: (id: string) => `/markets/${id}/simulate` as const,
    prices: (id: string) => `/markets/${id}/prices` as const,
    oracle: (id: string) => `/markets/${id}/oracle` as const,
    oracleQuotes: (id: string) => `/markets/${id}/oracle/quotes` as const,
    activity: (id: string) => `/markets/${id}/activity` as const,
    create: "/markets/create",
  },
  questions: {
    submit: "/questions",
    submission: (id: string) => `/questions/submissions/${id}` as const,
  },
  orders: {
    create: "/orders",
    list: "/orders",
    recent: "/orders/recent",
    get: (id: string) => `/orders/${id}` as const,
    cancel: "/orders/cancels",
    cancelReplace: "/orders/cancel-replace",
    simulate: "/orders/simulate",
    bulk: "/orders/bulk",
    bulkCreate: "/orders/bulk/create",
    bulkCancel: "/orders/bulk/cancel",
  },
  portfolio: {
    get: (address: string) => `/portfolio/${address}` as const,
    claimable: (address: string) =>
      `/portfolio/${address}/claimable` as const,
    stats: (address: string) => `/portfolio/${address}/stats` as const,
  },
  balance: {
    get: (address: string) => `/balance/${address}` as const,
    tokenBalance: "/balance",
    settlement: "/balance/settlement",
    mintTestUsdc: "/balance/mint-test-usdc",
  },
  activity: {
    global: "/activity",
  },
  gasless: {
    operator: "/gasless/operator",
    depositWithPermit: "/gasless/deposit-with-permit",
  },
} as const;
