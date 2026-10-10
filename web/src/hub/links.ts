import { b64url, utf8 } from './crypto';

/** The hub's own address (works on GitHub Pages and on a local dev server). */
export const hubBase = () => `${location.origin}${import.meta.env.BASE_URL}`;

export interface JoinPayload {
  /** Machine address */
  u: string;
  /** Machine id: the link only works with the machine it was made for. */
  n: string;
  /** Invite token */
  i: string;
}

export const joinLink = (p: JoinPayload) => `${hubBase()}#join=${b64url.encode(utf8(JSON.stringify(p)))}`;

export function parseJoin(text: string): JoinPayload | null {
  const m = /#join=([\w-]+)/.exec(text);
  if (!m) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64url.decode(m[1]!))) as Partial<JoinPayload>;
    return typeof p.u === 'string' && typeof p.n === 'string' && typeof p.i === 'string' ? (p as JoinPayload) : null;
  } catch {
    return null;
  }
}

/** A machine address the hub may call: https anywhere, plain http only on this computer. */
export function parseMachineUrl(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
