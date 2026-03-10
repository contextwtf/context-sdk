export interface paths {
    "/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List global market activity */
        get: operations["listPublicV2Activity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List markets */
        get: operations["listPublicV2Markets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create market from question submission */
        post: operations["createPublicV2Market"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get market */
        get: operations["getPublicV2Market"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get market activity */
        get: operations["listPublicV2MarketActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/oracle": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get oracle summary */
        get: operations["getPublicV2MarketOracle"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/oracle/quotes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List oracle quotes */
        get: operations["listPublicV2MarketOracleQuotes"];
        put?: never;
        /** Request oracle quote */
        post: operations["createPublicV2MarketOracleQuote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/oracle/quotes/latest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get latest oracle quote */
        get: operations["getPublicV2MarketOracleQuoteLatest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/orderbook": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get market orderbook */
        get: operations["getPublicV2MarketOrderbook"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/prices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get market price history */
        get: operations["getPublicV2MarketPrices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/quotes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get market quotes */
        get: operations["getPublicV2MarketQuotes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/simulate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Simulate market trade */
        post: operations["simulatePublicV2MarketTrade"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List orders */
        get: operations["listPublicV2Orders"];
        put?: never;
        /** Create order */
        post: operations["createPublicV2Order"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/recent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List recent orders */
        get: operations["listPublicV2RecentOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get order by id */
        get: operations["getPublicV2Order"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel order */
        post: operations["cancelPublicV2Order"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/cancel-replace": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel and replace order */
        post: operations["cancelReplacePublicV2Order"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Bulk order operations */
        post: operations["bulkPublicV2Orders"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/bulk/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Bulk create orders */
        post: operations["bulkCreatePublicV2Orders"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/bulk/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Bulk cancel orders */
        post: operations["bulkCancelPublicV2Orders"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/simulate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Simulate order execution */
        post: operations["simulatePublicV2Order"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portfolio/{address}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get portfolio summary */
        get: operations["getPublicV2Portfolio"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portfolio/{address}/claimable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get claimable positions */
        get: operations["getPublicV2PortfolioClaimable"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portfolio/{address}/positions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get portfolio positions */
        get: operations["getPublicV2PortfolioPositions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/portfolio/{address}/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get portfolio stats */
        get: operations["getPublicV2PortfolioStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/balance/mint-test-usdc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mint test USDC */
        post: operations["mintPublicV2TestUsdc"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/balance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get ERC-20 balance */
        get: operations["getPublicV2Balance"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/balance/settlement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get settlement balance */
        get: operations["getPublicV2SettlementBalance"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/balance/{address}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get balance summary for address */
        get: operations["getPublicV2BalanceSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/gasless/operator": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Relay setOperatorBySig */
        post: operations["setPublicV2GaslessOperator"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/gasless/deposit-with-permit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Relay depositWithPermit */
        post: operations["depositPublicV2GaslessWithPermit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/questions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit question for generation */
        post: operations["submitPublicV2Question"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/questions/agent-submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit market draft directly */
        post: operations["submitPublicV2MarketDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/questions/submissions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get submission status */
        get: operations["getPublicV2QuestionSubmission"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ActivityResponse: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId?: string;
            activity: components["schemas"]["ActivityItem"][];
            pagination: components["schemas"]["Pagination"];
        };
        ActivityItem: {
            /** @enum {string} */
            type: "trade";
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId?: string;
            /** Format: date-time */
            timestamp: string;
            data: {
                /** @description Outcome side (e.g. "yes", "no") */
                side: string;
                /** @description Price as a decimal (0-1) */
                price: number;
                /** @description Total cost in USDC terms */
                amount: number;
                /** @description Number of contracts */
                contracts: number;
            };
        } | {
            /** @enum {string} */
            type: "oracle_update";
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId?: string;
            /** Format: date-time */
            timestamp: string;
            data: {
                confidence: number | null;
                status: string;
            };
        } | {
            /** @enum {string} */
            type: "resolution";
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId?: string;
            /** Format: date-time */
            timestamp: string;
            data: {
                outcome: string | null;
                evidence: string | null;
            };
        } | {
            /** @enum {string} */
            type: "market_created";
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId?: string;
            /** Format: date-time */
            timestamp: string;
            data: {
                [key: string]: unknown;
            };
        };
        Pagination: {
            cursor: string | null;
            hasMore: boolean;
        };
        PublicApiError: {
            message: string;
        } & {
            [key: string]: unknown;
        };
        MarketList: {
            markets: components["schemas"]["Market"][];
            cursor: string | null;
        };
        Market: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            id: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            oracle: string;
            question: string;
            questionSubmissionId?: string | null;
            shortQuestion: string;
            outcomeTokens: string[];
            outcomePrices: components["schemas"]["OutcomePrice"][];
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            creator: string;
            creatorProfile: {
                username: string | null;
                avatarUrl: string | null;
            } | null;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            blockTime: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            chainId: string;
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            txHash: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            volume: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            volume24h: string;
            participantCount: number;
            executableAt: string | null;
            proposedAt: string | null;
            resolvedAt: string | null;
            payoutPcts: number[] | null;
            /** @enum {string} */
            resolutionStatus: "none" | "pending" | "resolved";
            metadata: components["schemas"]["MarketMetadata"];
            resolutionCriteria: string;
            /** Format: date-time */
            deadline: string;
            /** @enum {string} */
            status: "active" | "pending" | "resolved" | "closed";
            /** Format: date-time */
            createdAt: string;
            outcome: number | null;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            contractAddress: string;
        };
        OutcomePrice: {
            outcomeIndex: number;
            bestBid: number | null;
            bestAsk: number | null;
            spread: number | null;
            midPrice: number | null;
            lastPrice: number | null;
            sellPrice: number | null;
            buyPrice: number | null;
        };
        MarketMetadata: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            mediaHash: string;
            startTime: number;
            endTime: number;
            criteria: string;
            slug: string | null;
            sourceAccounts: components["schemas"]["SourceAccount"][];
            shortSummary: string | null;
            categories: string[] | null;
        };
        SourceAccount: {
            platform: string;
            userId: string;
            username: string;
            displayName: string | null;
            profileImageUrl: string | null;
        };
        MarketCreated: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId: string;
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            txHash: string;
        };
        MarketDetail: {
            market: components["schemas"]["Market"];
        };
        OracleSummaryResponse: {
            oracle: {
                /** Format: date-time */
                lastCheckedAt: string;
                confidenceLevel: string | null;
                evidenceCollected: {
                    postsCount: number;
                    relevantPosts: string[];
                };
                sourcesMonitored: string[];
                summary: {
                    decision: string;
                    shortSummary: string;
                    expandedSummary: string;
                };
            } | null;
        };
        OracleQuoteList: {
            quotes: components["schemas"]["OracleQuote"][];
        };
        OracleQuote: {
            id: number;
            /** @enum {string} */
            status: "pending" | "processing" | "completed" | "failed";
            probability: number | null;
            /** @enum {string|null} */
            confidence: "low" | "medium" | "high" | null;
            reasoning: string | null;
            referenceMarketsCount: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            completedAt: string | null;
        };
        OracleQuoteLatest: {
            quote: components["schemas"]["OracleQuote"] & unknown;
        };
        OracleQuoteCreated: {
            id: number;
            /** @enum {string} */
            status: "pending" | "processing" | "completed" | "failed";
            /** Format: date-time */
            createdAt: string;
        };
        Orderbook: {
            marketId: string;
            bids: {
                price: number;
                size: number;
            }[];
            asks: {
                price: number;
                size: number;
            }[];
            timestamp: string;
        };
        PriceHistory: {
            prices: {
                time: number;
                price: number;
            }[];
            startTime: number;
            endTime: number;
            interval: number;
        };
        Quotes: {
            marketId: string;
            yes: {
                bid: number | null;
                ask: number | null;
                last: number | null;
            };
            no: {
                bid: number | null;
                ask: number | null;
                last: number | null;
            };
            spread: number | null;
            timestamp: string;
        };
        SimulateResult: {
            marketId: string;
            /** @enum {string} */
            side: "yes" | "no";
            amount: number;
            /** @enum {string} */
            amountType: "usd" | "contracts";
            estimatedContracts: number;
            estimatedAvgPrice: number;
            estimatedSlippage: number;
            warnings: components["schemas"]["SimulateWarning"][];
        };
        SimulateWarning: {
            /** @enum {string} */
            type: "LOW_LIQUIDITY";
        } | {
            /** @enum {string} */
            type: "HIGH_SLIPPAGE";
        } | {
            /** @enum {string} */
            type: "INSUFFICIENT_LIQUIDITY";
        } | {
            /** @enum {string} */
            type: "INSUFFICIENT_COLLATERAL";
        } | {
            /** @enum {string} */
            type: "SELF_TRADE";
            selfTrades: {
                orderId: number;
                /**
                 * @description Hex string
                 * @example 0xabc123
                 */
                nonce: string;
                side: 0 | 1;
                /**
                 * @description Integer encoded as decimal string
                 * @example 1000000
                 */
                price: string;
                /**
                 * @description Integer encoded as decimal string
                 * @example 1000000
                 */
                remainingSize: string;
            }[];
        };
        OrderCreated: {
            /** @enum {boolean} */
            success: true;
            order: components["schemas"]["Order"];
        };
        Order: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            trader: string;
            /**
             * @description Hex string
             * @example 0xabc123
             */
            nonce: string;
            side: 0 | 1;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            price: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            size: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            filledSize: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            remainingSize: string;
            percentFilled: number;
            /** Format: date-time */
            insertedAt: string;
            /** @enum {string} */
            type: "limit" | "market";
            /** @enum {string} */
            status: "open" | "filled" | "cancelled" | "expired" | "voided";
            /** Format: date-time */
            voidedAt: string | null;
            /** @enum {string|null} */
            voidReason: "UNFILLED_MARKET_ORDER" | "UNDER_COLLATERALIZED" | "MISSING_OPERATOR_APPROVAL" | "BELOW_MIN_FILL_SIZE" | "INVALID_SIGNATURE" | "MARKET_RESOLVED" | "ADMIN_VOID" | null;
            outcomeIndex: number;
        };
        OrderList: {
            orders: components["schemas"]["OrderWithAvgFillPrice"][];
            markets: {
                [key: string]: components["schemas"]["OrderMarketInfo"];
            };
            cursor: string | null;
        };
        OrderWithAvgFillPrice: components["schemas"]["Order"] & {
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            avgFillPrice: string | null;
        };
        OrderMarketInfo: {
            shortQuestion: string;
            slug: string | null;
        };
        RecentOrderList: {
            orders: components["schemas"]["Order"][];
        };
        OrderCancelResult: {
            success: boolean;
            alreadyCancelled: boolean;
        };
        OrderCancelReplaceResult: {
            cancel: components["schemas"]["CancelDetail"];
            create: components["schemas"]["OrderCreated"];
        };
        CancelDetail: {
            /** @enum {boolean} */
            success: true;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            trader: string;
            /**
             * @description Hex string
             * @example 0xabc123
             */
            nonce: string;
            alreadyCancelled: boolean;
        };
        BulkOrderResult: {
            results: (components["schemas"]["BulkCancelItem"] | components["schemas"]["BulkCreateItem"])[];
        };
        BulkCancelItem: {
            /** @enum {string} */
            type: "cancel";
            /** @enum {boolean} */
            success: true;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            trader: string;
            /**
             * @description Hex string
             * @example 0xabc123
             */
            nonce: string;
            alreadyCancelled: boolean;
        };
        BulkCreateItem: {
            /** @enum {string} */
            type: "create";
            /** @enum {boolean} */
            success: true;
            order: components["schemas"]["Order"];
        };
        BulkOrderCreateResult: {
            /** @enum {boolean} */
            success: true;
            results: components["schemas"]["BulkCreateItem"][];
        };
        BulkOrderCancelResult: {
            /** @enum {boolean} */
            success: true;
            results: components["schemas"]["BulkCancelItem"][];
        };
        OrderSimulateResult: {
            levels: components["schemas"]["OrderSimulateLevel"][];
            summary: components["schemas"]["OrderSimulateSummary"];
            collateral: components["schemas"]["OrderSimulateCollateral"];
            warnings: components["schemas"]["SimulateWarning"][];
        };
        OrderSimulateLevel: {
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            price: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            sizeAvailable: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            cumulativeSize: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            takerFee: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            cumulativeTakerFee: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            collateralRequired: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            cumulativeCollateral: string;
            makerCount: number;
        };
        OrderSimulateSummary: {
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            fillSize: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            fillCost: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            takerFee: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            weightedAvgPrice: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            totalLiquidityAvailable: string;
            percentFillable: number;
            slippageBps: number;
        };
        OrderSimulateCollateral: {
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            balance: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            outcomeTokenBalance: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            requiredForFill: string;
            isSufficient: boolean;
        };
        PortfolioSummary: {
            portfolio: components["schemas"]["Position"][];
            marketIds: string[];
            cursor: string | null;
        };
        Position: {
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            tokenAddress: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            balance: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            settlementBalance: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            walletBalance: string;
            outcomeIndex: number;
            outcomeName: string;
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            netInvestment: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            currentValue: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            tokensRedeemed: string;
        };
        ClaimablePositions: {
            positions: components["schemas"]["ClaimablePosition"][];
            markets: components["schemas"]["ClaimableMarket"][];
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            totalClaimable: string;
        };
        ClaimablePosition: {
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            tokenAddress: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            balance: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            settlementBalance: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            walletBalance: string;
            outcomeIndex: number;
            outcomeName: string | null;
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            netInvestment: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            claimableAmount: string;
        };
        ClaimableMarket: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            id: string;
            outcomeTokens: string[];
            outcomeNames: string[];
            payoutPcts: string[];
        };
        PositionList: {
            positions: components["schemas"]["PortfolioPosition"][];
            cursor: string | null;
        };
        PortfolioPosition: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId: string;
            slug: string | null;
            marketName: string;
            outcomeName: string;
            outcomeIndex: number;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            size: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            avgPrice: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            price: string;
            /** @enum {string} */
            status: "open" | "closed";
        };
        PortfolioStats: {
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            currentPortfolioValue: string;
            currentPortfolioPercentChange: number;
            predictionsPlaced: number;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            totalPlaced: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            allTimeWinLoss: string;
            allTimeReturnPct: number;
        };
        MintResult: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            hash: string;
        };
        MintRateLimit: {
            message: string;
            remainingRequests: number;
        };
        TokenBalance: {
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            balance: string;
            decimals: number;
            symbol: string;
        };
        SettlementBalance: {
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            balance: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            account: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            token: string;
        };
        BalanceSummary: {
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            address: string;
            usdc: {
                /**
                 * @description EVM address
                 * @example 0x1111111111111111111111111111111111111111
                 */
                tokenAddress: string;
                /**
                 * @description Integer encoded as decimal string
                 * @example 1000000
                 */
                balance: string;
                /**
                 * @description Integer encoded as decimal string
                 * @example 1000000
                 */
                settlementBalance: string;
                /**
                 * @description Integer encoded as decimal string
                 * @example 1000000
                 */
                walletBalance: string;
            };
            outcomeTokens: components["schemas"]["OutcomeTokenBalance"][];
        };
        OutcomeTokenBalance: {
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            tokenAddress: string;
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            marketId: string;
            outcomeIndex: number;
            outcomeName: string | null;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            balance: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            settlementBalance: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            walletBalance: string;
        };
        GaslessOperatorResult: {
            /** @enum {boolean} */
            success: true;
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            txHash: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            user: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            operator: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            relayer: string;
        };
        GaslessDepositResult: {
            /** @enum {boolean} */
            success: true;
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            txHash: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            user: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            token: string;
            /**
             * @description Integer encoded as decimal string
             * @example 1000000
             */
            amount: string;
            /**
             * @description EVM address
             * @example 0x1111111111111111111111111111111111111111
             */
            relayer: string;
        };
        QuestionPostResponse: {
            submissionId: string;
            /** @description Always empty on initial submission */
            questions: unknown[];
            /** @description Always empty on initial submission */
            accounts: {
                [key: string]: unknown;
            };
            qualityExplanation: string | null;
            refuseToResolve: boolean;
            status: string;
            /** @description Always empty on initial submission */
            statusUpdates: unknown[];
            /**
             * Format: uri
             * @description URL to poll for submission status
             */
            pollUrl: string;
        };
        Bucket: {
            key: string;
            label: string;
            /** @enum {string} */
            countBy: "authors" | "events";
            includedAuthors?: string[];
            excludedAuthors?: string[];
            query: string;
            instructions: string;
            target?: number;
            authorOnly?: boolean;
            order?: number;
        };
        SubmissionResponse: {
            questions: components["schemas"]["SubmissionQuestion"][];
            accounts: {
                [key: string]: components["schemas"]["SubmissionAccount"];
            };
            qualityExplanation: string | null;
            refuseToResolve: boolean;
            similarMarkets?: components["schemas"]["SimilarMarket"][];
            rejectionReasons?: components["schemas"]["RejectionReason"][];
            appliedChanges?: string[];
            submissionId?: string;
            status: string;
            statusUpdates: {
                tool: string;
                status: string;
                timestamp: string;
            }[];
        };
        SubmissionQuestion: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            id: string;
            text: string;
            shortText: string;
            criteria: string;
            explanation: string;
            endTime: number;
            sources: string[];
            /** @enum {string} */
            evidenceMode: "social_only" | "web_enabled";
            buckets?: components["schemas"]["Bucket"][];
            /**
             * @description Hex string
             * @example 0xabc123
             */
            onchainMetadata: string;
        };
        SubmissionAccount: {
            id: string;
            platform: string;
            username: string;
            displayName: string;
            profileImageUrl: string;
            followersCount: number;
            followingCount: number;
            /** Format: date-time */
            fetchedAt: string;
        } | null;
        SimilarMarket: {
            /**
             * @description 32-byte hex hash
             * @example 0x1111111111111111111111111111111111111111111111111111111111111111
             */
            id: string;
            question: string;
            shortQuestion: string;
            similarity: number;
        };
        RejectionReason: {
            code: string;
            message: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: {
        /** @description Request limit for the current window */
        RateLimitLimitHeader: number;
        /** @description Remaining requests in the current window */
        RateLimitRemainingHeader: number;
        /** @description Unix timestamp (seconds) when the rate-limit window resets */
        RateLimitResetHeader: number;
        /** @description Cursor token for the next page */
        NextCursorHeader: string;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listPublicV2Activity: {
        parameters: {
            query?: {
                /** @description Opaque pagination cursor */
                cursor?: string;
                limit?: number;
                /** @description Comma-separated activity types: trade, oracle_update, resolution, market_created */
                types?: string;
                /** @description Start time filter (any date-parseable string) */
                startTime?: string;
                /** @description End time filter (any date-parseable string) */
                endTime?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Activity feed */
            200: {
                headers: {
                    "X-Next-Cursor": components["headers"]["NextCursorHeader"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    listPublicV2Markets: {
        parameters: {
            query?: {
                /** @description Sort order. Defaults to "new". Options: trending, new, ending, chance, volume */
                sortBy?: ("trending" | "new" | "ending" | "chance") | "volume";
                sort?: "asc" | "desc";
                limit?: number;
                /** @description Opaque pagination cursor */
                cursor?: string;
                search?: string;
                /** @description Comma-separated status values: active, pending, resolved, closed */
                status?: string;
                /** @description Comma-separated resolution status values: none, pending, resolved */
                resolutionStatus?: string;
                /** @description EVM address */
                creator?: string;
                /** @description Filter by category */
                category?: string;
                /** @description Filter by visibility */
                visibility?: "all" | "hidden" | "visible";
                /** @description Filter markets created after this unix timestamp */
                createdAfter?: number | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Markets list */
            200: {
                headers: {
                    "X-Next-Cursor": components["headers"]["NextCursorHeader"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MarketList"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    createPublicV2Market: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "questionId": "0x1111111111111111111111111111111111111111111111111111111111111111"
                 *     }
                 */
                "application/json": {
                    /**
                     * @description 32-byte hex hash
                     * @example 0x1111111111111111111111111111111111111111111111111111111111111111
                     */
                    questionId: string;
                };
            };
        };
        responses: {
            /** @description Created market */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MarketCreated"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2Market: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Market id hash or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Get market */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MarketDetail"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    listPublicV2MarketActivity: {
        parameters: {
            query?: {
                /** @description Opaque pagination cursor */
                cursor?: string;
                limit?: number;
                /** @description Comma-separated activity types: trade, oracle_update, resolution, market_created */
                types?: string;
                /** @description Start time filter (any date-parseable string) */
                startTime?: string;
                /** @description End time filter (any date-parseable string) */
                endTime?: string;
            };
            header?: never;
            path: {
                /** @description Market id hash or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Get market activity */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2MarketOracle: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Market id hash or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Get oracle summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OracleSummaryResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    listPublicV2MarketOracleQuotes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Market id hash or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List oracle quotes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OracleQuoteList"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    createPublicV2MarketOracleQuote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Market id hash or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Quote request accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OracleQuoteCreated"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Quote recently requested (cooldown period) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2MarketOracleQuoteLatest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Market id hash or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Get latest oracle quote */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OracleQuoteLatest"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2MarketOrderbook: {
        parameters: {
            query?: {
                depth?: number;
                outcomeIndex?: number | null;
            };
            header?: never;
            path: {
                /** @description Market id hash or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Get market orderbook */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Orderbook"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2MarketPrices: {
        parameters: {
            query?: {
                timeframe?: "1h" | "6h" | "1d" | "1w" | "1M" | "all";
            };
            header?: never;
            path: {
                /** @description Market id hash */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Get market price history */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PriceHistory"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2MarketQuotes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Market id hash or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Get market quotes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Quotes"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    simulatePublicV2MarketTrade: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Market id hash or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    side: "yes" | "no";
                    amount: number;
                    /** @enum {string} */
                    amountType: "usd" | "contracts";
                    /**
                     * @description EVM address
                     * @example 0x1111111111111111111111111111111111111111
                     */
                    trader?: string;
                };
            };
        };
        responses: {
            /** @description Simulate market trade */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SimulateResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    listPublicV2Orders: {
        parameters: {
            query?: {
                /** @description EVM address */
                trader?: string;
                /** @description 32-byte hex hash */
                marketId?: string;
                /** @description Comma-separated statuses: open,filled,cancelled,expired,voided */
                status?: string;
                search?: string;
                limit?: number;
                /** @description Opaque pagination cursor */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Orders list */
            200: {
                headers: {
                    "X-Next-Cursor": components["headers"]["NextCursorHeader"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderList"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    createPublicV2Order: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "type": "limit",
                 *       "marketId": "0x1111111111111111111111111111111111111111111111111111111111111111",
                 *       "trader": "0x1111111111111111111111111111111111111111",
                 *       "price": "510000",
                 *       "size": "1000000",
                 *       "outcomeIndex": 0,
                 *       "side": 0,
                 *       "nonce": "0xabc123",
                 *       "expiry": "0",
                 *       "maxFee": "0",
                 *       "makerRoleConstraint": 0,
                 *       "inventoryModeConstraint": 0,
                 *       "signature": "0xabc123"
                 *     }
                 */
                "application/json": {
                    /**
                     * @description 32-byte hex hash
                     * @example 0x1111111111111111111111111111111111111111111111111111111111111111
                     */
                    marketId: string;
                    /**
                     * @description EVM address
                     * @example 0x1111111111111111111111111111111111111111
                     */
                    trader: string;
                    /**
                     * @description Hex string
                     * @example 0xabc123
                     */
                    nonce: string;
                    /**
                     * @description Hex string
                     * @example 0xabc123
                     */
                    signature: string;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Order created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderCreated"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    listPublicV2RecentOrders: {
        parameters: {
            query?: {
                /** @description EVM address */
                trader?: string;
                /** @description 32-byte hex hash */
                marketId?: string;
                status?: "open" | "filled" | "cancelled" | "expired";
                limit?: number;
                windowSeconds?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Recent orders */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RecentOrderList"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2Order: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Order id (numeric DB id, e.g. "12345") or order hash (e.g. "0x111...") */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Order */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Order"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    cancelPublicV2Order: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description EVM address
                     * @example 0x1111111111111111111111111111111111111111
                     */
                    trader: string;
                    /**
                     * @description Hex string
                     * @example 0xabc123
                     */
                    nonce: string;
                    /**
                     * @description Hex string
                     * @example 0xabc123
                     */
                    signature: string;
                };
            };
        };
        responses: {
            /** @description Order was already cancelled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderCancelResult"];
                };
            };
            /** @description Order cancelled */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderCancelResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    cancelReplacePublicV2Order: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    cancel: {
                        /**
                         * @description EVM address
                         * @example 0x1111111111111111111111111111111111111111
                         */
                        trader: string;
                        /**
                         * @description Hex string
                         * @example 0xabc123
                         */
                        nonce: string;
                        /**
                         * @description Hex string
                         * @example 0xabc123
                         */
                        signature: string;
                    };
                    create: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Order cancelled and replaced */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderCancelReplaceResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    bulkPublicV2Orders: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    operations: {
                        [key: string]: unknown;
                    }[];
                };
            };
        };
        responses: {
            /** @description Bulk operations executed */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkOrderResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    bulkCreatePublicV2Orders: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    orders: {
                        [key: string]: unknown;
                    }[];
                };
            };
        };
        responses: {
            /** @description Bulk orders created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkOrderCreateResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    bulkCancelPublicV2Orders: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    cancels: {
                        /**
                         * @description EVM address
                         * @example 0x1111111111111111111111111111111111111111
                         */
                        trader: string;
                        /**
                         * @description Hex string
                         * @example 0xabc123
                         */
                        nonce: string;
                        /**
                         * @description Hex string
                         * @example 0xabc123
                         */
                        signature: string;
                    }[];
                };
            };
        };
        responses: {
            /** @description Bulk orders cancelled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkOrderCancelResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    simulatePublicV2Order: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description Hex string
                     * @example 0xabc123
                     */
                    marketId: string;
                    /**
                     * @description EVM address
                     * @example 0x1111111111111111111111111111111111111111
                     */
                    trader: string;
                    /**
                     * @description Integer encoded as decimal string
                     * @example 1000000
                     */
                    maxSize: string;
                    /**
                     * @description Integer encoded as decimal string
                     * @example 1000000
                     */
                    maxPrice: string;
                    outcomeIndex: number;
                    /** @enum {string} */
                    side: "bid" | "ask";
                };
            };
        };
        responses: {
            /** @description Simulated order execution */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderSimulateResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2Portfolio: {
        parameters: {
            query?: {
                /** @description 32-byte hex hash */
                marketId?: string;
                kind?: "all" | "active" | "won" | "lost" | "claimable";
                /** @description Opaque pagination cursor */
                cursor?: string;
                pageSize?: number | null;
            };
            header?: never;
            path: {
                /** @description EVM address */
                address: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Portfolio */
            200: {
                headers: {
                    "X-Next-Cursor": components["headers"]["NextCursorHeader"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PortfolioSummary"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2PortfolioClaimable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description EVM address */
                address: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Claimable positions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClaimablePositions"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2PortfolioPositions: {
        parameters: {
            query?: {
                /** @description 32-byte hex hash */
                marketId?: string;
                status?: "open" | "closed";
                search?: string;
                /** @description Opaque pagination cursor */
                cursor?: string;
                limit?: number | null;
            };
            header?: never;
            path: {
                /** @description EVM address */
                address: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Positions */
            200: {
                headers: {
                    "X-Next-Cursor": components["headers"]["NextCursorHeader"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PositionList"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2PortfolioStats: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description EVM address */
                address: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Portfolio stats */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PortfolioStats"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    mintPublicV2TestUsdc: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "address": "0x1111111111111111111111111111111111111111",
                 *       "amount": "100.0"
                 *     }
                 */
                "application/json": {
                    /**
                     * @description EVM address
                     * @example 0x1111111111111111111111111111111111111111
                     */
                    address: string;
                    /**
                     * @description USDC amount as a decimal string. Must be greater than 0 and at most 10000.
                     * @example 100.0
                     */
                    amount: string;
                };
            };
        };
        responses: {
            /** @description Mint transaction hash */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MintResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Mint rate limit exceeded (100 requests per hour) */
            429: {
                headers: {
                    "X-RateLimit-Limit": components["headers"]["RateLimitLimitHeader"];
                    "X-RateLimit-Remaining": components["headers"]["RateLimitRemainingHeader"];
                    "X-RateLimit-Reset": components["headers"]["RateLimitResetHeader"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MintRateLimit"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2Balance: {
        parameters: {
            query: {
                /** @description EVM address */
                address: string;
                /** @description EVM address */
                tokenAddress: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Token balance */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenBalance"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Invalid contract or address (token contract may not exist) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        message: string;
                    };
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        message: string;
                    };
                };
            };
        };
    };
    getPublicV2SettlementBalance: {
        parameters: {
            query: {
                /** @description EVM address */
                address: string;
                /** @description EVM address */
                tokenAddress: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Settlement balance */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettlementBalance"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2BalanceSummary: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description EVM address */
                address: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Balance summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BalanceSummary"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    setPublicV2GaslessOperator: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description EVM address
                     * @example 0x1111111111111111111111111111111111111111
                     */
                    user: string;
                    /** @default true */
                    approved?: boolean;
                    /**
                     * @description Integer encoded as decimal string
                     * @example 1000000
                     */
                    nonce: string;
                    /**
                     * @description Integer encoded as decimal string
                     * @example 1000000
                     */
                    deadline: string;
                    /**
                     * @description Hex string
                     * @example 0xabc123
                     */
                    signature: string;
                };
            };
        };
        responses: {
            /** @description Relayed transaction */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GaslessOperatorResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    depositPublicV2GaslessWithPermit: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description EVM address
                     * @example 0x1111111111111111111111111111111111111111
                     */
                    user: string;
                    /**
                     * @description Integer encoded as decimal string
                     * @example 1000000
                     */
                    amount: string;
                    /**
                     * @description Integer encoded as decimal string
                     * @example 1000000
                     */
                    nonce: string;
                    /**
                     * @description Integer encoded as decimal string
                     * @example 1000000
                     */
                    deadline: string;
                    /**
                     * @description Hex string
                     * @example 0xabc123
                     */
                    signature: string;
                };
            };
        };
        responses: {
            /** @description Relayed transaction */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GaslessDepositResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    submitPublicV2Question: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "question": "Will ETH close above $4,000 by Dec 31, 2026?"
                 *     }
                 */
                "application/json": {
                    question: string;
                };
            };
        };
        responses: {
            /** @description Submission accepted */
            200: {
                headers: {
                    "X-RateLimit-Limit": components["headers"]["RateLimitLimitHeader"];
                    "X-RateLimit-Remaining": components["headers"]["RateLimitRemainingHeader"];
                    "X-RateLimit-Reset": components["headers"]["RateLimitResetHeader"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuestionPostResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    submitPublicV2MarketDraft: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    market: {
                        formattedQuestion: string;
                        shortQuestion: string;
                        /** @enum {string} */
                        marketType: "SUBJECTIVE" | "OBJECTIVE";
                        /** @enum {string} */
                        evidenceMode: "social_only" | "web_enabled";
                        /** @default [] */
                        sources?: string[];
                        resolutionCriteria: string;
                        /** @description End time as YYYY-MM-DD HH:MM:SS interpreted in the given timezone */
                        endTime: string;
                        /**
                         * @description IANA timezone identifier
                         * @default America/New_York
                         */
                        timezone?: string;
                        buckets?: components["schemas"]["Bucket"][];
                        comparisons?: ({
                            /** @enum {string} */
                            type: "binary";
                            key: string;
                            label: string;
                            aKey: string;
                            bKey: string;
                            /**
                             * @default >
                             * @enum {string}
                             */
                            operator?: ">" | ">=" | "==" | "<=" | "<";
                            aWeight?: number;
                            bWeight?: number;
                            margin?: number;
                        } | {
                            /** @enum {string} */
                            type: "max" | "min";
                            key: string;
                            label: string;
                            bucketKeys: string[];
                        } | {
                            /** @enum {string} */
                            type: "before";
                            key: string;
                            label: string;
                            aKey: string;
                            bKey: string;
                            /**
                             * @default firstEvent
                             * @enum {string}
                             */
                            event?: "firstEvent" | "targetReached";
                            /** @default true */
                            requireBoth?: boolean;
                        } | {
                            /** @enum {string} */
                            type: "first";
                            key: string;
                            label: string;
                            bucketKeys: string[];
                            /**
                             * @default firstEvent
                             * @enum {string}
                             */
                            event?: "firstEvent" | "targetReached";
                        })[];
                        explanation?: string;
                    };
                };
            };
        };
        responses: {
            /** @description Submission accepted */
            200: {
                headers: {
                    "X-RateLimit-Limit": components["headers"]["RateLimitLimitHeader"];
                    "X-RateLimit-Remaining": components["headers"]["RateLimitRemainingHeader"];
                    "X-RateLimit-Reset": components["headers"]["RateLimitResetHeader"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuestionPostResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
    getPublicV2QuestionSubmission: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Submission status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubmissionResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicApiError"];
                };
            };
        };
    };
}
