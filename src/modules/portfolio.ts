import type { Address } from "viem";
import type { HttpClient } from "../http.js";
import { ENDPOINTS } from "../endpoints.js";
import type { Portfolio, Balance } from "../types.js";

export class PortfolioModule {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAddress: Address | null,
  ) {}

  private resolveAddress(address?: Address): Address {
    const resolved = address ?? this.defaultAddress;
    if (!resolved) {
      throw new Error(
        "Address required. Either pass an address or configure a signer.",
      );
    }
    return resolved;
  }

  async get(address?: Address): Promise<Portfolio> {
    return this.http.get<Portfolio>(
      ENDPOINTS.portfolio.get(this.resolveAddress(address)),
    );
  }

  async balance(address?: Address): Promise<Balance> {
    return this.http.get<Balance>(
      ENDPOINTS.balance.get(this.resolveAddress(address)),
    );
  }
}
