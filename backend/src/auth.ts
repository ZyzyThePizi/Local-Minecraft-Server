import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, paths } from './config.ts';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_GLOBAL = 30;

let secret: Buffer;

export function initAuth() {
  if (!existsSync(paths.secret)) {
    mkdirSync(dirname(paths.secret), { recursive: true });
    writeFileSync(paths.secret, randomBytes(32).toString('hex'));
  }
  secret = Buffer.from(readFileSync(paths.secret, 'utf8').trim(), 'hex');
}

// The signing key depends on the password, so changing ADMIN_PASSWORD logs everyone out.
const signingKey = () => createHmac('sha256', secret).update(config.adminPassword).digest();
const sha256 = (s: string) => createHash('sha256').update(s).digest();

export function checkPassword(input: string) {
  return timingSafeEqual(sha256(input), sha256(config.adminPassword));
}

export function issueToken() {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString('base64url');
  const sig = createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, expiresAt };
}

export function verifyToken(token: string | undefined) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = createHmac('sha256', signingKey()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp: number };
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

// Login throttling: per client IP and globally, so a distributed guess is also capped.
const fails = new Map<string, { count: number; resetAt: number }>();
const GLOBAL = '*';

function bucket(key: string) {
  const now = Date.now();
  let b = fails.get(key);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    fails.set(key, b);
  }
  return b;
}

/** Seconds until the next attempt is allowed, or 0 when it is allowed now. */
export function loginRetryAfter(ip: string) {
  const ipB = bucket(ip);
  const all = bucket(GLOBAL);
  const blocked = [ipB.count >= MAX_FAILS_PER_IP && ipB, all.count >= MAX_FAILS_GLOBAL && all].filter(Boolean);
  if (!blocked.length) return 0;
  return Math.ceil(Math.max(...blocked.map((b) => (b as { resetAt: number }).resetAt - Date.now())) / 1000);
}

export function recordLoginFailure(ip: string) {
  bucket(ip).count++;
  bucket(GLOBAL).count++;
}

export function recordLoginSuccess(ip: string) {
  fails.delete(ip);
}
