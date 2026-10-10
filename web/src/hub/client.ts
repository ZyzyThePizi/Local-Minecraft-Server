import { canVerify, fingerprintOf, randomToken, verifySignature } from './crypto';
import { keyring, openToken, sealToken, type NodeRecord } from './keyring';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const API_VERSION = 1;

export interface Hello {
  nodeId: string;
  publicKey: string;
  signature: string;
  name: string;
  version: string;
  apiVersion: number;
  publicStatus: boolean;
}

export interface Tokens {
  sessionId: string;
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

export const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

async function raw<T>(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'A gép nem érhető el.');
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? `Hiba történt (${res.status}).`);
  return data as T;
}

/**
 * Asks a machine to prove its identity: it signs a fresh nonce with its key. The id must be the
 * key's fingerprint, and when we already know this machine, the key must be the pinned one.
 */
export async function hello(url: string, pinned?: string): Promise<Hello & { verified: boolean }> {
  const nonce = randomToken(24);
  let h: Hello;
  try {
    h = await raw<Hello>(`${url}/api/v1/hello?nonce=${nonce}`, {}, 8000);
  } catch (err) {
    // Version 1 backends have no /api/v1: tell them apart from a machine that is switched off.
    if (err instanceof ApiError && err.status === 404) {
      const old = await raw<{ ok?: boolean }>(`${url}/api/health`, {}, 5000).catch(() => null);
      if (old?.ok) throw new ApiError(426, 'OUTDATED', 'Ez a gép a backend régi verzióját futtatja. Frissítsd (git pull), majd indítsd újra.');
    }
    throw err;
  }
  if (h.apiVersion !== API_VERSION) {
    throw new ApiError(426, 'OUTDATED', h.apiVersion > API_VERSION ? 'Ez a gép újabb verziójú, frissítsd az oldalt.' : 'Ez a gép régi verziót futtat, frissítsd a backendjét.');
  }
  if ((await fingerprintOf(h.publicKey)) !== h.nodeId) throw new ApiError(495, 'BAD_IDENTITY', 'A gép azonosítója nem egyezik a kulcsával.');
  if (pinned && pinned !== h.publicKey) throw new ApiError(495, 'KEY_CHANGED', 'A gép kulcsa megváltozott.');
  let verified = false;
  if (await canVerify()) {
    verified = await verifySignature(h.publicKey, h.signature, `local-minecraft-server/hello/v1\n${h.nodeId}\n${nonce}`);
    if (!verified) throw new ApiError(495, 'BAD_SIGNATURE', 'A gép nem tudta igazolni a kulcsát.');
  }
  return { ...h, verified };
}

export const login = (url: string, body: { password?: string; invite?: string; device: string }) =>
  raw<Tokens>(`${url}/api/v1/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function sealTokens(t: Tokens, device: string) {
  return { sessionId: t.sessionId, device, refresh: await sealToken(t.refreshToken), refreshExpiresAt: t.refreshExpiresAt };
}

/** A readable default name for this browser in the machine's session list. */
export function deviceLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Böngésző';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ');
}

/**
 * Talks to one machine. The access token stays in memory; the refresh token is in the keyring and
 * every refresh runs under a cross-tab lock, because the machine treats a reused one as stolen.
 */
export class NodeClient {
  readonly nodeId: string;
  url: string;
  private access: { token: string; exp: number } | null = null;
  onSignedOut: (() => void) | null = null;

  constructor(rec: NodeRecord) {
    this.nodeId = rec.nodeId;
    this.url = rec.url;
  }

  adoptTokens(t: Tokens) {
    this.access = { token: t.accessToken, exp: t.accessExpiresAt };
  }

  forget() {
    this.access = null;
  }

  private refreshNow() {
    const run = async () => {
      const rec = await keyring.get(this.nodeId);
      if (!rec?.auth) throw new ApiError(401, 'SIGNED_OUT', 'Nem vagy belépve.');
      let t: Tokens;
      try {
        t = await raw<Tokens>(`${this.url}/api/v1/session/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: await openToken(rec.auth.refresh) }),
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          delete rec.auth;
          await keyring.put(rec);
          this.access = null;
          this.onSignedOut?.();
        }
        throw err;
      }
      rec.auth = await sealTokens(t, rec.auth.device);
      await keyring.put(rec);
      this.adoptTokens(t);
    };
    return navigator.locks ? navigator.locks.request(`lms-refresh-${this.nodeId}`, run) : run();
  }

  private async token() {
    if (!this.access || this.access.exp - 30_000 < Date.now()) await this.refreshNow();
    return this.access!.token;
  }

  async request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const token = await this.token();
    try {
      return await raw<T>(this.url + path, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // The access token may have died early (password change, restart): refresh once and retry.
      if (!retried && err instanceof ApiError && err.status === 401 && err.code === 'UNAUTHORIZED') {
        this.access = null;
        return this.request<T>(method, path, body, true);
      }
      throw err;
    }
  }

  get = <T>(path: string) => this.request<T>('GET', path);
  post = <T>(path: string, body: unknown = {}) => this.request<T>('POST', path, body);
  put = <T>(path: string, body: unknown) => this.request<T>('PUT', path, body);
  patch = <T>(path: string, body: unknown) => this.request<T>('PATCH', path, body);
  del = <T>(path: string) => this.request<T>('DELETE', path);

  /** Public endpoints (no sign-in). */
  publicGet = <T>(path: string) => raw<T>(this.url + path, {}, 10_000);
}
