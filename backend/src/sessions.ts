import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Actor } from './audit.ts';
import { config, HttpError, paths } from './config.ts';
import { nodeId } from './node.ts';
import { readJson, writeJson } from './store.ts';

/**
 * Sign-in without user accounts: the .env password or an invite link opens a session.
 * Everyone who gets in has full access to this machine.
 *
 * - access token: 15 minutes, HMAC-signed, bound to this machine's id; checked against the live
 *   session list, so revoking a session cuts it off right away
 * - refresh token: 14 days, rotated on every use; a reused (stolen) one ends the session
 * - changing the password logs everyone out (the signing key depends on it)
 */

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type Via = { kind: 'password' } | { kind: 'invite'; inviteId: string; label: string };

export interface Session {
  id: string;
  refreshHash: string;
  /** The previous refresh token's hash: seeing it again means a copy is in someone else's hands. */
  prevHash?: string;
  via: Via;
  device: string;
  createdAt: number;
  lastUsedAt: number;
  lastIp: string;
  expiresAt: number;
}

export interface Invite {
  id: string;
  hash: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number | null;
  uses: number;
  revokedAt?: number;
  createdBy: string;
}

export interface Tokens {
  sessionId: string;
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

let secret: Buffer;
let sessions: Session[] = [];
let invites: Invite[] = [];

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest();
const hashToken = (s: string) => sha256(s).toString('base64url');
const token = () => randomBytes(32).toString('base64url');
const id = () => randomBytes(9).toString('base64url');

function sameHash(a: string, b: string | undefined) {
  if (!b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function initSessions() {
  if (!existsSync(paths.secret)) {
    mkdirSync(dirname(paths.secret), { recursive: true });
    writeFileSync(paths.secret, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  secret = Buffer.from(readFileSync(paths.secret, 'utf8').trim(), 'hex');
  const now = Date.now();
  sessions = (await readJson<Session[]>(paths.sessions, [])).filter((s) => s.expiresAt > now);
  invites = await readJson<Invite[]>(paths.invites, []);
}

const saveSessions = () => writeJson(paths.sessions, sessions);
const saveInvites = () => writeJson(paths.invites, invites);

// The signing key depends on the password, so changing it invalidates every access token at once.
const signingKey = () => createHmac('sha256', secret).update(config.adminPassword).digest();

export function checkPassword(input: string) {
  return timingSafeEqual(sha256(input), sha256(config.adminPassword));
}

function issueAccess(session: Session) {
  const exp = Date.now() + ACCESS_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ sid: session.id, aud: nodeId, exp })).toString('base64url');
  const sig = createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return { accessToken: `a1.${payload}.${sig}`, accessExpiresAt: exp };
}

async function rotate(session: Session, ip: string): Promise<Tokens> {
  const secretPart = token();
  const refreshToken = `r1.${session.id}.${secretPart}`;
  session.prevHash = session.refreshHash;
  session.refreshHash = hashToken(refreshToken);
  session.lastUsedAt = Date.now();
  session.lastIp = ip;
  session.expiresAt = Date.now() + REFRESH_TTL_MS;
  await saveSessions();
  return { sessionId: session.id, ...issueAccess(session), refreshToken, refreshExpiresAt: session.expiresAt };
}

async function open(via: Via, device: string, ip: string) {
  const now = Date.now();
  const session: Session = {
    id: id(),
    refreshHash: '',
    via,
    device: device.trim().slice(0, 60) || 'Ismeretlen eszköz',
    createdAt: now,
    lastUsedAt: now,
    lastIp: ip,
    expiresAt: now + REFRESH_TTL_MS,
  };
  sessions.push(session);
  return rotate(session, ip);
}

export async function loginWithPassword(password: string, device: string, ip: string) {
  if (!checkPassword(password)) throw new HttpError(401, 'BAD_PASSWORD', 'Hibás jelszó.');
  return open({ kind: 'password' }, device, ip);
}

export function inviteState(inv: Invite) {
  if (inv.revokedAt) return 'revoked' as const;
  if (inv.expiresAt <= Date.now()) return 'expired' as const;
  if (inv.maxUses !== null && inv.uses >= inv.maxUses) return 'used' as const;
  return 'active' as const;
}

export async function redeemInvite(raw: string, device: string, ip: string) {
  const [, inviteId] = raw.split('.');
  const inv = invites.find((i) => i.id === inviteId);
  if (!inv || !sameHash(hashToken(raw), inv.hash)) throw new HttpError(401, 'BAD_INVITE', 'Ismeretlen meghívó.');
  const state = inviteState(inv);
  if (state !== 'active') {
    const why = { revoked: 'visszavonták', expired: 'lejárt', used: 'már felhasználták' }[state];
    throw new HttpError(401, 'BAD_INVITE', `Ezt a meghívót ${why}.`);
  }
  inv.uses++;
  await saveInvites();
  return open({ kind: 'invite', inviteId: inv.id, label: inv.label }, device, ip);
}

export async function refresh(raw: string, ip: string) {
  const [, sid] = raw.split('.');
  const session = sessions.find((s) => s.id === sid);
  const fail = () => new HttpError(401, 'SESSION_ENDED', 'A belépés lejárt, lépj be újra.');
  if (!session || session.expiresAt <= Date.now()) throw fail();
  const hash = hashToken(raw);
  if (sameHash(hash, session.refreshHash)) return rotate(session, ip);
  if (sameHash(hash, session.prevHash)) {
    // An old token came back after it was replaced: two parties hold this session. End it.
    await revokeSession(session.id);
    throw new HttpError(401, 'SESSION_REUSED', 'Ezt a belépést egy másik helyről is használták, ezért lezártam. Lépj be újra.');
  }
  throw fail();
}

/** The session behind a valid access token, or null. */
export function verifyAccess(raw: string | undefined): Session | null {
  if (!raw) return null;
  const [v, payload, sig] = raw.split('.');
  if (v !== 'a1' || !payload || !sig) return null;
  const expected = createHmac('sha256', signingKey()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { sid, aud, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sid: string; aud: string; exp: number };
    if (aud !== nodeId || typeof exp !== 'number' || exp <= Date.now()) return null;
    return sessions.find((s) => s.id === sid && s.expiresAt > Date.now()) ?? null;
  } catch {
    return null;
  }
}

export const viaLabel = (via: Via) => (via.kind === 'password' ? 'jelszó' : `meghívó: ${via.label}`);

export const actorOf = (s: Session | null, ip: string): Actor => ({
  sessionId: s?.id ?? null,
  via: s ? viaLabel(s.via) : 'névtelen',
  device: s?.device ?? '',
  ip,
});

export const listSessions = () =>
  sessions
    .filter((s) => s.expiresAt > Date.now())
    .map(({ id: sid, via, device, createdAt, lastUsedAt, lastIp, expiresAt }) => ({ id: sid, via, device, createdAt, lastUsedAt, lastIp, expiresAt }))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);

export async function revokeSession(sid: string) {
  const before = sessions.length;
  sessions = sessions.filter((s) => s.id !== sid);
  if (sessions.length !== before) await saveSessions();
  return before !== sessions.length;
}

/** Logs out every device (optionally keeping one). */
export async function revokeAllSessions(keep?: string) {
  const count = sessions.filter((s) => s.id !== keep).length;
  sessions = sessions.filter((s) => s.id === keep);
  await saveSessions();
  return count;
}

export const listInvites = () =>
  invites
    .map(({ hash: _hash, ...rest }) => ({ ...rest, state: inviteState(rest as Invite) }))
    .sort((a, b) => b.createdAt - a.createdAt);

export async function createInvite(opts: { label: string; expiresInHours: number; maxUses: number | null }, createdBy: string) {
  const inviteId = id();
  const raw = `i1.${inviteId}.${token()}`;
  const inv: Invite = {
    id: inviteId,
    hash: hashToken(raw),
    label: opts.label.trim().slice(0, 60) || 'Meghívó',
    createdAt: Date.now(),
    expiresAt: Date.now() + opts.expiresInHours * 3600_000,
    maxUses: opts.maxUses,
    uses: 0,
    createdBy,
  };
  // Keep the list short: drop invites that ended more than 30 days ago.
  const cutoff = Date.now() - 30 * 24 * 3600_000;
  invites = invites.filter((i) => inviteState(i) === 'active' || Math.max(i.revokedAt ?? 0, i.expiresAt) > cutoff);
  invites.push(inv);
  await saveInvites();
  return { invite: listInvites().find((i) => i.id === inviteId)!, token: raw };
}

/** Revokes an invite and ends every session that was opened with it. */
export async function revokeInvite(inviteId: string) {
  const inv = invites.find((i) => i.id === inviteId);
  if (!inv) return null;
  if (!inv.revokedAt) inv.revokedAt = Date.now();
  await saveInvites();
  const before = sessions.length;
  sessions = sessions.filter((s) => !(s.via.kind === 'invite' && s.via.inviteId === inviteId));
  if (sessions.length !== before) await saveSessions();
  return { endedSessions: before - sessions.length };
}
