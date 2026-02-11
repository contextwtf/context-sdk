export const ENDPOINTS = {
  markets: {
    list: "/markets",
    get: (id: string) => `/markets/${id}` as const,
    quotes: (id: string) => `/markets/${id}/quotes` as const,
    orderbook: (id: string) => `/markets/${id}/orderbook` as const,
    simulate: (id: string) => `/markets/${id}/simulate` as const,
    prices: (id: string) => `/markets/${id}/prices` as const,
    oracle: (id: string) => `/markets/${id}/oracle` as const,
    activity: (id: string) => `/markets/${id}/activity` as const,
  },
  orders: {
    create: "/orders",
    list: "/orders",
    cancel: "/orders/cancels",
    cancelReplace: "/orders/cancel-replace",
    bulkCreate: "/orders/bulk/create",
    bulkCancel: "/orders/bulk/cancel",
  },
  portfolio: {
    get: (address: string) => `/portfolio/${address}` as const,
  },
  balance: {
    get: (address: string) => `/balance/${address}` as const,
    mintTestUsdc: "/balance/mint-test-usdc",
  },
  activity: {
    global: "/activity",
  },
} as const;
