export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let base = '';
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function configureApi(opts: { base: string; token: string | null; onUnauthorized: () => void }) {
  base = opts.base.replace(/\/$/, '');
  token = opts.token;
  onUnauthorized = opts.onUnauthorized;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'A szervergép nem érhető el.');
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    if (res.status === 401 && path.startsWith('/api/admin')) onUnauthorized?.();
    throw new ApiError(res.status, data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? `Hiba történt (${res.status}).`);
  }
  return data as T;
}

export const get = <T>(path: string) => request<T>('GET', path);
export const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);
export const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
export const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
export const del = <T>(path: string) => request<T>('DELETE', path);

// ---- backend discovery ----
// The page is static; the backend runs on whichever of my machines is switched on.
// Built-in URLs come from the build (VITE_API_URLS), a custom one can be set in the footer.

const CUSTOM_KEY = 'mc.backendUrl';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function builtInUrls(): string[] {
  const urls = (import.meta.env.VITE_API_URLS as string | undefined) ?? '';
  const list = urls.split(',').map((u) => u.trim()).filter(Boolean);
  if (!list.length && ['localhost', '127.0.0.1'].includes(location.hostname)) list.push('http://127.0.0.1:8765');
  return list;
}

export const getCustomUrl = () => storage()?.getItem(CUSTOM_KEY) ?? null;

export function setCustomUrl(url: string | null) {
  const s = storage();
  if (!s) return;
  if (url) s.setItem(CUSTOM_KEY, url.replace(/\/$/, ''));
  else s.removeItem(CUSTOM_KEY);
}

export async function discoverBackend(): Promise<{ url: string; name: string } | null> {
  const urls = [...new Set([getCustomUrl(), ...builtInUrls()].filter((u): u is string => Boolean(u)))];
  if (!urls.length) return null;
  try {
    return await Promise.any(
      urls.map(async (url) => {
        const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(6000) });
        const json = (await res.json()) as { ok?: boolean; name?: string };
        if (!res.ok || !json.ok) throw new Error('unhealthy');
        return { url, name: json.name ?? url };
      }),
    );
  } catch {
    return null;
  }
}

const tokenKey = (url: string) => `mc.token.${url}`;

export function loadToken(url: string) {
  const raw = storage()?.getItem(tokenKey(url));
  if (!raw) return null;
  try {
    const { token: t, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number };
    return expiresAt > Date.now() ? t : null;
  } catch {
    return null;
  }
}

export function saveToken(url: string, value: { token: string; expiresAt: number } | null) {
  const s = storage();
  if (!s) return;
  if (value) s.setItem(tokenKey(url), JSON.stringify(value));
  else s.removeItem(tokenKey(url));
}
