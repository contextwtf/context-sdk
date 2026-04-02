/**
 * Auto-generated from the Context public OpenAPI spec.
 * DO NOT EDIT — re-run `bun run generate` instead.
 */

export const ENDPOINTS = {
  account: {
    migration: "/account/migration",
    migrationStart: "/account/migration/start",
    migrationDismissOrders: "/account/migration/dismiss-orders",
    migrationRestoreOrders: "/account/migration/restore-orders",
    migrationMigrateFunds: "/account/migration/migrate-funds",
  },
  activity: {
    global: "/activity",
  },
  markets: {
    list: "/markets",
    search: "/markets/search",
    create: "/markets/create",
    get: (id: string) => `/markets/${id}` as const,
    activity: (id: string) => `/markets/${id}/activity` as const,
    oracle: (id: string) => `/markets/${id}/oracle` as const,
    orderbook: (id: string) => `/markets/${id}/orderbook` as const,
    prices: (id: string) => `/markets/${id}/prices` as const,
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
