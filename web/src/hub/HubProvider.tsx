import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PublicServer, ServerState, ServerSummary } from '../types';
import { ApiError, hello, NodeClient, normalizeUrl, sealTokens, type Hello, type Tokens } from './client';
import { keyring, type NodeRecord } from './keyring';

export type Reach = 'checking' | 'online' | 'offline' | 'outdated' | 'key-changed' | 'error';

/** A server on a machine, in the shape the hub list and the 3D world need. */
export interface HubServer extends PublicServer {
  playerNames: string[];
}

export interface NodeLive {
  reach: Reach;
  message: string | null;
  /** The signature check ran (the browser supports Ed25519). */
  verified: boolean;
  publicStatus: boolean;
  servers: HubServer[] | null;
  /** The key the machine answered with when it no longer matches the pinned one. */
  newKey?: Hello;
  checkedAt: number;
}

export interface HubNode {
  rec: NodeRecord;
  client: NodeClient;
  live: NodeLive;
  signedIn: boolean;
}

export interface Toast {
  id: number;
  tone: 'danger' | 'signal' | 'info';
  text: string;
}

interface HubApi {
  ready: boolean;
  nodes: HubNode[];
  toasts: Toast[];
  dismissToast: (id: number) => void;
  notify: (tone: Toast['tone'], text: string) => void;
  node: (nodeId: string) => HubNode | null;
  refreshNode: (nodeId: string) => Promise<void>;
  /** Adds (or updates) a machine after its identity was checked, optionally signed in. */
  addNode: (h: Hello, url: string, tokens?: Tokens, device?: string) => Promise<void>;
  signIn: (nodeId: string, tokens: Tokens, device: string) => Promise<void>;
  signOut: (nodeId: string) => Promise<void>;
  removeNode: (nodeId: string) => Promise<void>;
  /** The machine got a new key (reinstalled): pin the new one. Its sessions are gone, so it signs out. */
  acceptNewKey: (nodeId: string) => Promise<string | null>;
  reload: () => Promise<void>;
}

const HubContext = createContext<HubApi | null>(null);

export function useHub() {
  const ctx = useContext(HubContext);
  if (!ctx) throw new Error('useHub outside HubProvider');
  return ctx;
}

/** Machines built into this page (repository variable API_URLS); a local dev server falls back to 127.0.0.1. */
export function builtInUrls(): string[] {
  const urls = (import.meta.env.VITE_API_URLS as string | undefined) ?? '';
  const list = urls.split(',').map(normalizeUrl).filter(Boolean);
  if (!list.length && ['localhost', '127.0.0.1'].includes(location.hostname)) list.push('http://127.0.0.1:8765');
  return list;
}

const POLL_MS = 30_000;
const emptyLive = (): NodeLive => ({ reach: 'checking', message: null, verified: false, publicStatus: false, servers: null, checkedAt: 0 });
const isSignedIn = (rec: NodeRecord) => Boolean(rec.auth && rec.auth.refreshExpiresAt > Date.now());

const fromSummary = (s: ServerSummary): HubServer => ({
  id: s.id,
  name: s.name,
  versionName: s.versionName,
  mcVersion: s.mcVersion,
  loader: s.loader,
  iconUrl: s.iconUrl,
  websiteUrl: s.websiteUrl,
  state: s.state,
  players: s.players.length,
  playerNames: s.players,
  maxPlayers: s.maxPlayers,
  motd: s.motd,
  gameAddress: s.gameAddress || null,
});

export function HubProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [records, setRecords] = useState<NodeRecord[]>([]);
  const [live, setLive] = useState<Record<string, NodeLive>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const clients = useRef(new Map<string, NodeClient>());
  const lastStates = useRef(new Map<string, ServerState>());
  const toastId = useRef(0);

  const notify = useCallback((tone: Toast['tone'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 9000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const clientFor = useCallback((rec: NodeRecord) => {
    let c = clients.current.get(rec.nodeId);
    if (!c) {
      c = new NodeClient(rec);
      c.onSignedOut = () => void reload();
      clients.current.set(rec.nodeId, c);
    }
    c.url = rec.url;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(async () => {
    const list = await keyring.list();
    setRecords(list.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.addedAt - b.addedAt));
  }, []);

  const patchLive = (nodeId: string, patch: Partial<NodeLive>) => setLive((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] ?? emptyLive()), ...patch } }));

  /** Crash alerts for every machine the hub watches. */
  const watchStates = useCallback(
    (rec: NodeRecord, servers: HubServer[]) => {
      for (const s of servers) {
        const key = `${rec.nodeId}/${s.id}`;
        const before = lastStates.current.get(key);
        if (before && before !== 'crashed' && s.state === 'crashed') notify('danger', `${rec.name}: a(z) „${s.name}” szerver összeomlott.`);
        lastStates.current.set(key, s.state);
      }
    },
    [notify],
  );

  const check = useCallback(
    async (rec: NodeRecord) => {
      const client = clientFor(rec);
      try {
        const h = await hello(rec.url, rec.publicKey);
        let servers: HubServer[] | null = null;
        if (isSignedIn(rec)) {
          servers = (await client.get<{ servers: ServerSummary[] }>('/api/v1/servers').catch(() => null))?.servers.map(fromSummary) ?? null;
        }
        if (!servers && h.publicStatus) {
          servers = (await client.publicGet<{ servers: PublicServer[] }>('/api/v1/status')).servers.map((s) => ({ ...s, playerNames: [] }));
        }
        if (servers) watchStates(rec, servers);
        patchLive(rec.nodeId, { reach: 'online', message: null, verified: h.verified, publicStatus: h.publicStatus, servers, checkedAt: Date.now() });
        // Keep the name current and remember when we last saw it (written at most every 5 minutes).
        if (h.name !== rec.name || !rec.lastSeenAt || Date.now() - rec.lastSeenAt > 300_000) {
          await keyring.put({ ...rec, name: h.name, lastSeenAt: Date.now() });
          if (h.name !== rec.name) void reload();
        }
      } catch (err) {
        const e = err instanceof ApiError ? err : new ApiError(0, 'ERROR', String(err));
        if (e.code === 'KEY_CHANGED') {
          const newKey = await hello(rec.url).catch(() => undefined);
          patchLive(rec.nodeId, { reach: 'key-changed', message: e.message, newKey, servers: null, checkedAt: Date.now() });
        } else {
          patchLive(rec.nodeId, {
            reach: e.code === 'NETWORK' ? 'offline' : e.code === 'OUTDATED' ? 'outdated' : 'error',
            message: e.message,
            checkedAt: Date.now(),
          });
        }
      }
    },
    [clientFor, reload, watchStates],
  );

  // First load: the keyring, then the machines built into the page (pinned on first sight).
  useEffect(() => {
    (async () => {
      const stored = await keyring.list();
      for (const url of builtInUrls()) {
        if (stored.some((r) => r.url === url)) continue;
        try {
          const h = await hello(url);
          const existing = stored.find((r) => r.nodeId === h.nodeId);
          if (existing) {
            if (existing.publicKey === h.publicKey) await keyring.put({ ...existing, url, featured: true });
          } else {
            await keyring.put({ nodeId: h.nodeId, publicKey: h.publicKey, url, name: h.name, addedAt: Date.now(), lastSeenAt: Date.now(), featured: true });
          }
        } catch {
          /* switched off right now; it is added the first time it answers */
        }
      }
      await reload();
      setReady(true);
    })();
  }, [reload]);

  // Poll every machine; a hidden tab pauses.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const run = () => {
      if (document.visibilityState !== 'hidden') for (const rec of records) void check(rec);
    };
    run();
    const t = setInterval(() => alive && run(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready, records, check]);

  const api = useMemo<HubApi>(() => {
    const nodes: HubNode[] = records.map((rec) => ({ rec, client: clientFor(rec), live: live[rec.nodeId] ?? emptyLive(), signedIn: isSignedIn(rec) }));
    const byId = (nodeId: string) => nodes.find((n) => n.rec.nodeId === nodeId) ?? null;
    return {
      ready,
      nodes,
      toasts,
      dismissToast,
      notify,
      node: byId,
      refreshNode: async (nodeId) => {
        const rec = await keyring.get(nodeId);
        if (rec) await check(rec);
      },
      addNode: async (h, url, tokens, device) => {
        const existing = await keyring.get(h.nodeId);
        if (existing && existing.publicKey !== h.publicKey) throw new ApiError(495, 'KEY_CHANGED', 'Ez a gép már szerepel a listádban, de más kulccsal.');
        const rec: NodeRecord = existing
          ? { ...existing, url: normalizeUrl(url), name: h.name, lastSeenAt: Date.now() }
          : { nodeId: h.nodeId, publicKey: h.publicKey, url: normalizeUrl(url), name: h.name, addedAt: Date.now(), lastSeenAt: Date.now() };
        if (tokens && device) rec.auth = await sealTokens(tokens, device);
        await keyring.put(rec);
        const client = clientFor(rec);
        if (tokens) client.adoptTokens(tokens);
        await reload();
        await check(rec);
      },
      signIn: async (nodeId, tokens, device) => {
        const rec = await keyring.get(nodeId);
        if (!rec) return;
        rec.auth = await sealTokens(tokens, device);
        await keyring.put(rec);
        clientFor(rec).adoptTokens(tokens);
        await reload();
        await check(rec);
      },
      signOut: async (nodeId) => {
        const rec = await keyring.get(nodeId);
        if (!rec) return;
        const client = clientFor(rec);
        if (rec.auth) await client.del('/api/v1/session').catch(() => {});
        client.forget();
        delete rec.auth;
        await keyring.put(rec);
        await reload();
        await check(rec);
      },
      removeNode: async (nodeId) => {
        const rec = await keyring.get(nodeId);
        if (rec?.auth) await clientFor(rec).del('/api/v1/session').catch(() => {});
        clients.current.delete(nodeId);
        await keyring.remove(nodeId);
        setLive((prev) => {
          const { [nodeId]: _gone, ...rest } = prev;
          return rest;
        });
        await reload();
      },
      acceptNewKey: async (nodeId) => {
        const rec = await keyring.get(nodeId);
        const h = live[nodeId]?.newKey;
        if (!rec || !h) return null;
        // The id is derived from the key, so a new key means a new entry; the old one goes.
        await keyring.remove(nodeId);
        clients.current.delete(nodeId);
        const next: NodeRecord = { nodeId: h.nodeId, publicKey: h.publicKey, url: rec.url, name: h.name, addedAt: Date.now(), lastSeenAt: Date.now(), featured: rec.featured };
        await keyring.put(next);
        await reload();
        await check(next);
        return next.nodeId;
      },
      reload,
    };
  }, [records, live, ready, toasts, dismissToast, notify, clientFor, check, reload]);

  return <HubContext.Provider value={api}>{children}</HubContext.Provider>;
}

/** The selected machine's client for components below an island view. */
const NodeContext = createContext<HubNode | null>(null);
export const NodeProvider = NodeContext.Provider;

export function useNode() {
  const n = useContext(NodeContext);
  if (!n) throw new Error('useNode outside NodeProvider');
  return n;
}

export function useApi() {
  return useNode().client;
}
