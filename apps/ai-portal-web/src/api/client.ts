/**
 * Backend API client (browser). Calls ONLY the backend under `/api/v1` — never
 * LM Studio/S3/DB directly. Bearer token берётся из `auth/tokenStore` (OIDC
 * access-token, иначе dev_token). Ошибки backend (`{error:{code,message}}`)
 * разбираются в типизированный `ApiError`.
 */
import { getPublicConfig } from '@su10/config/public';
import { getAccessToken } from '../auth/tokenStore';

const cfg = getPublicConfig(import.meta.env as Record<string, string | undefined>);
const API_ROOT = `${cfg.VITE_API_BASE_URL.replace(/\/$/, '')}/v1`;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Бросается, когда endpoint ещё не реализован (501). UI показывает «в разработке». */
export function isNotImplemented(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 501 || err.code === 'NOT_IMPLEMENTED');
}

async function parseError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = res.statusText;
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } };
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
    }
  } catch {
    /* тело не JSON — оставляем статус */
  }
  return new ApiError(res.status, code, message);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${API_ROOT}${path}`;
  const token = getAccessToken();
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, init);
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body),
};
