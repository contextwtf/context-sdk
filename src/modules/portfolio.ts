import type { Address } from "viem";
import type { HttpClient } from "../http.js";
import { ENDPOINTS } from "../endpoints.js";
import { ContextConfigError } from "../errors.js";
import type {
  Portfolio,
  Balance,
  ClaimableResponse,
  PortfolioStats,
  PositionList,
  TokenBalance,
  SettlementBalance,
  GetPortfolioParams,
  GetPositionsParams,
} from "../types.js";

export class PortfolioModule {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAddress: Address | null,
  ) {}

  private resolveAddress(address?: Address): Address {
    const resolved = address ?? this.defaultAddress;
    if (!resolved) {
      throw new ContextConfigError(
        "Address required. Either pass an address or configure a signer.",
      );
    }
    return resolved;
  }

  async get(
    address?: Address,
    params?: GetPortfolioParams,
  ): Promise<Portfolio> {
    return this.http.get<Portfolio>(
      ENDPOINTS.portfolio.get(this.resolveAddress(address)),
      {
        kind: params?.kind,
        marketId: params?.marketId,
        cursor: params?.cursor,
        pageSize: params?.pageSize,
      },
    );
  }

  async positions(
    address?: Address,
    params?: GetPositionsParams,
  ): Promise<PositionList> {
    return this.http.get<PositionList>(
      ENDPOINTS.portfolio.positions(this.resolveAddress(address)),
      {
        marketId: params?.marketId,
        status: params?.status,
        search: params?.search,
        cursor: params?.cursor,
        limit: params?.limit,
      },
    );
  }

  async claimable(address?: Address): Promise<ClaimableResponse> {
    return this.http.get<ClaimableResponse>(
      ENDPOINTS.portfolio.claimable(this.resolveAddress(address)),
    );
  }

  async stats(address?: Address): Promise<PortfolioStats> {
    return this.http.get<PortfolioStats>(
      ENDPOINTS.portfolio.stats(this.resolveAddress(address)),
    );
  }

  async balance(address?: Address): Promise<Balance> {
    return this.http.get<Balance>(
      ENDPOINTS.balance.get(this.resolveAddress(address)),
    );
  }

  async tokenBalance(
    address: Address,
    tokenAddress: Address,
  ): Promise<TokenBalance> {
    return this.http.get<TokenBalance>(ENDPOINTS.balance.tokenBalance, {
      address,
      tokenAddress,
    });
  }

  async settlementBalance(
    address: Address,
    tokenAddress: Address,
  ): Promise<SettlementBalance> {
    return this.http.get<SettlementBalance>(ENDPOINTS.balance.settlement, {
      address,
      tokenAddress,
    });
  }
}
