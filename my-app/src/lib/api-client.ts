import Constants from 'expo-constants';

import { chatSocket } from './chat-socket';
import { StorageKeys, storage } from './mmkv';

/**
 * HTTP client for the NestJS API.
 *
 * Responsibilities:
 *  - Resolve base URL from `EXPO_PUBLIC_API_URL` or `app.config.extra.apiUrl`.
 *  - Inject the JWT access token from MMKV on every call.
 *  - **Single-flight refresh mutex** (CLAUDE.md §4 "Frontend implications #5"): on
 *    401, all in-flight requests share one refresh promise. Without this, N
 *    concurrent 401s would trigger N parallel refreshes — the backend reads the
 *    second refresh as a replay attack and revokes the whole family, forcing a
 *    re-login.
 *  - Parse the API's error envelope `{ error: { code, message, retryAfterMs? } }`
 *    into a typed `ApiError` so screens can branch on `code`.
 */

export type ApiErrorBody = {
  code: string;
  message: string;
  retryAfterMs?: number;
  requestId?: string;
  issues?: { path: (string | number)[]; message: string }[];
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number | undefined;
  readonly requestId: string | undefined;
  readonly issues: ApiErrorBody['issues'];

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.retryAfterMs = body.retryAfterMs;
    this.requestId = body.requestId;
    this.issues = body.issues;
  }
}

type TokenPair = { accessToken: string; refreshToken: string };

function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  const fromExtra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  if (fromExtra && fromExtra.length > 0) return fromExtra.replace(/\/$/, '');
  // Sensible default: same-host fastify on 4000 in dev.
  return 'http://localhost:4000';
}

const BASE_URL = resolveBaseUrl();

function readAccessToken(): string | null {
  return storage.getString(StorageKeys.authAccessToken) ?? null;
}

function readRefreshToken(): string | null {
  return storage.getString(StorageKeys.authRefreshToken) ?? null;
}

function persistTokens(pair: TokenPair): void {
  storage.set(StorageKeys.authAccessToken, pair.accessToken);
  storage.set(StorageKeys.authRefreshToken, pair.refreshToken);
}

// Shared refresh promise — first 401 starts the refresh, subsequent 401s await it.
let refreshInFlight: Promise<TokenPair> | null = null;

async function performRefresh(): Promise<TokenPair> {
  const refreshToken = readRefreshToken();
  if (!refreshToken) {
    throw new ApiError(401, { code: 'no_refresh_token', message: 'No refresh token available.' });
  }
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new ApiError(res.status, body);
  }
  const json = (await res.json()) as TokenPair;
  persistTokens(json);
  // Symmetric to login (api-auth-repository.ts → chatSocket.restart()): reopen the
  // chat socket with the fresh token. The socket bakes the bearer into its handshake
  // at connect time, so a refresh alone leaves it authenticating with the stale token
  // (presence never registers; message:new / call:ring never arrive). Fire-and-forget
  // so we never block the REST retry.
  void chatSocket.restart();
  return json;
}

function getOrStartRefresh(): Promise<TokenPair> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const json = (await res.json()) as { error?: ApiErrorBody };
    if (json.error?.code) return json.error;
    return {
      code: `http_${res.status}`,
      message: `Request failed with status ${res.status}.`,
    };
  } catch {
    return {
      code: `http_${res.status}`,
      message: `Request failed with status ${res.status}.`,
    };
  }
}

type RequestInit = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  headers?: Record<string, string>;
  /** When true, skip the bearer header (used by /auth/refresh and OTP). */
  anonymous?: boolean;
};

async function fetchOnce(path: string, init: RequestInit, accessToken: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(accessToken && !init.anonymous ? { authorization: `Bearer ${accessToken}` } : {}),
    ...(init.headers ?? {}),
  };
  return fetch(`${BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

export async function apiRequest<TResponse>(path: string, init: RequestInit = {}): Promise<TResponse> {
  let res = await fetchOnce(path, init, readAccessToken());

  if (res.status === 401 && !init.anonymous) {
    try {
      const fresh = await getOrStartRefresh();
      res = await fetchOnce(path, init, fresh.accessToken);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(401, { code: 'refresh_failed', message: 'Session expired. Sign in again.' });
    }
  }

  if (res.status === 204) {
    return undefined as TResponse;
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new ApiError(res.status, body);
  }

  return (await res.json()) as TResponse;
}

export const apiClient = {
  get: <T>(path: string) => apiRequest<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

export const __apiBaseUrlForDebug = BASE_URL;
