import { b64url, utf8 } from './crypto';

/**
 * The hub's keyring: the machines this browser knows, kept in IndexedDB on this device only.
 * Nothing is stored on a server. Refresh tokens are encrypted with a non-extractable AES key that
 * lives in the same database, so a copied database file is not enough to read them.
 */

export interface StoredAuth {
  sessionId: string;
  device: string;
  refresh: { iv: string; data: string };
  refreshExpiresAt: number;
}

export interface NodeRecord {
  nodeId: string;
  /** Pinned Ed25519 public key (base64url). A different key on connect stops the connection. */
  publicKey: string;
  url: string;
  name: string;
  addedAt: number;
  lastSeenAt: number | null;
  /** Built into the page (VITE_API_URLS): shown to every visitor, pinned like any other. */
  featured?: boolean;
  auth?: StoredAuth;
}

const DB = 'lms-hub';
const NODES = 'nodes';
const META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(NODES, { keyPath: 'nodeId' });
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const keyring = {
  list: () => tx<NodeRecord[]>(NODES, 'readonly', (s) => s.getAll() as IDBRequest<NodeRecord[]>),
  get: (nodeId: string) => tx<NodeRecord | undefined>(NODES, 'readonly', (s) => s.get(nodeId) as IDBRequest<NodeRecord | undefined>),
  put: (rec: NodeRecord) => tx(NODES, 'readwrite', (s) => s.put(rec)),
  remove: (nodeId: string) => tx(NODES, 'readwrite', (s) => s.delete(nodeId)),
};

// ---- refresh token encryption ----

async function deviceKey(): Promise<CryptoKey> {
  const existing = await tx<CryptoKey | undefined>(META, 'readonly', (s) => s.get('deviceKey') as IDBRequest<CryptoKey | undefined>);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await tx(META, 'readwrite', (s) => s.put(key, 'deviceKey'));
  return key;
}

export async function sealToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), utf8(token)));
  return { iv: b64url.encode(iv), data: b64url.encode(data) };
}

export async function openToken(sealed: { iv: string; data: string }) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64url.decode(sealed.iv) }, await deviceKey(), b64url.decode(sealed.data));
  return new TextDecoder().decode(plain);
}

// ---- export / import (moving the keyring to another device) ----

interface ExportedNode extends Omit<NodeRecord, 'auth'> {
  auth?: Omit<StoredAuth, 'refresh'> & { refreshToken: string };
}

async function passKey(pass: string, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage) {
  const base = await crypto.subtle.importKey('raw', utf8(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

/** The whole keyring (with signed-in sessions) as a passphrase-encrypted JSON file. */
export async function exportKeyring(pass: string) {
  const nodes: ExportedNode[] = [];
  for (const rec of await keyring.list()) {
    const { auth, ...rest } = rec;
    let exportedAuth: ExportedNode['auth'];
    if (auth && auth.refreshExpiresAt > Date.now()) {
      try {
        const { refresh, ...meta } = auth;
        exportedAuth = { ...meta, refreshToken: await openToken(refresh) };
      } catch {
        exportedAuth = undefined;
      }
    }
    nodes.push({ ...rest, ...(exportedAuth ? { auth: exportedAuth } : {}) });
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await passKey(pass, salt, 'encrypt'), utf8(JSON.stringify({ v: 1, nodes })));
  return JSON.stringify({ format: 'lms-keyring', v: 1, salt: b64url.encode(salt), iv: b64url.encode(iv), data: b64url.encode(new Uint8Array(data)) });
}

/** Adds the machines of an exported keyring. Ones already pinned with a different key are skipped. */
export async function importKeyring(text: string, pass: string) {
  const file = JSON.parse(text) as { format?: string; salt: string; iv: string; data: string };
  if (file.format !== 'lms-keyring') throw new Error('Ez nem kulcskarika-fájl.');
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64url.decode(file.iv) }, await passKey(pass, b64url.decode(file.salt), 'decrypt'), b64url.decode(file.data));
  } catch {
    throw new Error('Hibás jelmondat.');
  }
  const { nodes } = JSON.parse(new TextDecoder().decode(plain)) as { nodes: ExportedNode[] };
  const result = { added: 0, updated: 0, conflicts: [] as string[] };
  for (const n of nodes) {
    const existing = await keyring.get(n.nodeId);
    if (existing && existing.publicKey !== n.publicKey) {
      result.conflicts.push(n.name);
      continue;
    }
    const { auth, ...rest } = n;
    const rec: NodeRecord = { ...existing, ...rest };
    if (auth) {
      const { refreshToken, ...meta } = auth;
      rec.auth = { ...meta, refresh: await sealToken(refreshToken) };
    }
    await keyring.put(rec);
    if (existing) result.updated++;
    else result.added++;
  }
  return result;
}
