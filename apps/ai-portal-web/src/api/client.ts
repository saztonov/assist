/**
 * Backend API client (browser). Calls ONLY the backend under `/api/v1` — never
 * LM Studio/S3/DB directly. The Bearer token is read from a local dev token
 * (localStorage `dev_token`); a full OIDC PKCE login flow is a separate concern.
 */
import { getPublicConfig } from '@su10/config/public';

const cfg = getPublicConfig(import.meta.env as Record<string, string | undefined>);
const API_ROOT = `${cfg.VITE_API_BASE_URL.replace(/\/$/, '')}/v1`;

export function getDevToken(): string | null {
  try {
    return localStorage.getItem('dev_token');
  } catch {
    return null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Build the URL in a variable so it is the backend `/api/v1` surface only.
  const url = `${API_ROOT}${path}`;
  const token = getDevToken();
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body),
};
