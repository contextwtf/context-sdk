import { API_BASE } from "./config.js";
import { ContextApiError } from "./errors.js";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchFn;
}

export interface HttpClient {
  get<T = unknown>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
  delete<T = unknown>(path: string, body?: unknown): Promise<T>;
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const apiKey = options.apiKey;
  const baseUrl = options.baseUrl ?? API_BASE;
  const fetchFn: FetchFn =
    options.fetch ?? (globalThis as any).fetch.bind(globalThis);

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      h["Authorization"] = `Bearer ${apiKey}`;
    }
    return h;
  }

  async function request<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const init: RequestInit = { method, headers: headers() };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetchFn(url, init);

    if (!res.ok) {
      const respBody = await res.json().catch(() => null);
      throw new ContextApiError(res.status, respBody);
    }

    return res.json() as Promise<T>;
  }

  return {
    async get<T = unknown>(
      path: string,
      params?: Record<string, string | number | undefined>,
    ): Promise<T> {
      let url = `${baseUrl}${path}`;
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
      return request<T>("GET", url);
    },

    async post<T = unknown>(path: string, body: unknown): Promise<T> {
      return request<T>("POST", `${baseUrl}${path}`, body);
    },

    async delete<T = unknown>(path: string, body?: unknown): Promise<T> {
      return request<T>("DELETE", `${baseUrl}${path}`, body);
    },
  };
}
