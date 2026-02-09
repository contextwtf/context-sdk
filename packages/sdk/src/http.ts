import { API_BASE } from "./constants.js";
import { ContextApiError } from "./errors.js";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpTransportOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchFn;
}

/**
 * HTTP transport with injected credentials.
 * Mockable via custom fetch for testing.
 */
export class HttpTransport {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(options: HttpTransportOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? API_BASE;
    this.fetchFn = options.fetch ?? (globalThis as any).fetch.bind(globalThis);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams: string[] = [];
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) {
          searchParams.push(
            `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
          );
        }
      }
      if (searchParams.length > 0) {
        url += `?${searchParams.join("&")}`;
      }
    }

    const res = await this.fetchFn(url, {
      method: "GET",
      headers: this.headers(),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ContextApiError(res.status, body);
    }

    return res.json() as Promise<T>;
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const respBody = await res.json().catch(() => null);
      throw new ContextApiError(res.status, respBody);
    }

    return res.json() as Promise<T>;
  }
}
