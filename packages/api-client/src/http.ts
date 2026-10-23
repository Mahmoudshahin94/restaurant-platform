import type { ActionSource } from '@pos/shared-types';
import type { z } from 'zod';
import { ApiError, toApiError } from './errors';

export interface HttpClientOptions {
  /** e.g. `https://api.example.com` or `''` for same-origin (dev proxy). */
  baseUrl: string;
  /** Which app is calling; recorded on audit entries. */
  source: ActionSource;
  getAccessToken: () => string | null;
  /**
   * Called once when a request fails with TOKEN_EXPIRED. Return true after obtaining a new
   * access token to retry the request; false to give up (the caller should sign out).
   */
  refreshSession?: () => Promise<boolean>;
  /** Validate responses against their schema (recommended in development and tests). */
  validateResponses?: boolean;
  fetchImpl?: typeof fetch;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions<S extends z.ZodType | undefined> {
  body?: unknown;
  /** Raw bytes sent as they are (file uploads), with this content type, instead of JSON. */
  raw?: { bytes: Blob; contentType: string };
  query?: Record<string, QueryValue>;
  schema?: S;
  headers?: Record<string, string>;
  /** Skip the automatic refresh-and-retry (used by the refresh call itself). */
  noRetry?: boolean;
}

type Result<S> = S extends z.ZodType ? z.output<S> : unknown;

export class HttpClient {
  private refreshing: Promise<boolean> | null = null;

  constructor(private readonly options: HttpClientOptions) {}

  /** The origin requests go to (`''` for same-origin). */
  get baseUrl(): string {
    return this.options.baseUrl;
  }

  async request<S extends z.ZodType | undefined = undefined>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    opts: RequestOptions<S> = {},
  ): Promise<Result<S>> {
    const response = await this.send(method, path, opts);
    if (response.status === 401 && !opts.noRetry && this.options.refreshSession) {
      const body = await safeJson(response.clone());
      const code = (body as { code?: string } | undefined)?.code;
      if (code === 'TOKEN_EXPIRED' && (await this.refreshOnce())) {
        return this.parse(await this.send(method, path, opts), opts.schema);
      }
    }
    return this.parse(response, opts.schema);
  }

  /** A binary response (a tenant file), with the same session refresh as `request`. */
  async blob(path: string): Promise<Blob> {
    let response = await this.send('GET', path, {});
    if (response.status === 401 && this.options.refreshSession) {
      const body = await safeJson(response.clone());
      if (
        (body as { code?: string } | undefined)?.code === 'TOKEN_EXPIRED' &&
        (await this.refreshOnce())
      ) {
        response = await this.send('GET', path, {});
      }
    }
    if (!response.ok) throw toApiError(response.status, await safeJson(response));
    return response.blob();
  }

  /** Concurrent requests that all hit an expired token share one refresh call. */
  private refreshOnce(): Promise<boolean> {
    const refresh = this.options.refreshSession;
    if (!refresh) return Promise.resolve(false);
    this.refreshing ??= refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async send(
    method: string,
    path: string,
    opts: RequestOptions<z.ZodType | undefined>,
  ): Promise<Response> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const search = params.size > 0 ? `?${params.toString()}` : '';
    const url = `${this.options.baseUrl}${path}${search}`;
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-client-source': this.options.source,
      ...opts.headers,
    };
    const token = this.options.getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (opts.raw) headers['content-type'] = opts.raw.contentType;
    else if (opts.body !== undefined) headers['content-type'] = 'application/json';

    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    try {
      return await fetchImpl(url, {
        method,
        headers,
        credentials: 'include',
        ...(opts.raw
          ? { body: opts.raw.bytes }
          : opts.body !== undefined
            ? { body: JSON.stringify(opts.body) }
            : {}),
      });
    } catch (cause) {
      throw new ApiError(
        'NETWORK_ERROR',
        cause instanceof Error ? cause.message : 'Network error',
        0,
      );
    }
  }

  private async parse<S extends z.ZodType | undefined>(
    response: Response,
    schema: S | undefined,
  ): Promise<Result<S>> {
    if (response.status === 204 || response.status === 304) return undefined as Result<S>;
    const body = await safeJson(response);
    if (!response.ok) throw toApiError(response.status, body);
    if (schema && this.options.validateResponses) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError('INVALID_RESPONSE', 'Response did not match contract', response.status, {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.map(String),
            message: i.message,
          })),
        });
      }
      return parsed.data as Result<S>;
    }
    return body as Result<S>;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
