import { join } from 'node:path';
import { onChange } from './changes.ts';
import { API_VERSION, VERSION } from './config.ts';
import { nodeId, publicKey, signBytes } from './node.ts';
import { readProperties } from './properties.ts';
import { servers } from './servers.ts';
import { DEFAULT_REGISTRY_URL, listInstances, serverDir, settings } from './store.ts';

/**
 * Heartbeat to the network registry, which the network owner's control panel reads.
 * Every machine in the network reports; there is no switch for it. What is sent, and nothing else:
 * this machine's id and public key, its name and version, and for each server its name, Minecraft
 * version, loader, state and player count. Never a password, token, address or player name.
 * The body is signed with the machine key.
 */

export interface Announcement {
  id: string;
  level: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  createdAt: number;
}

export interface RegistryState {
  lastOkAt: number | null;
  lastError: string | null;
  announcements: Announcement[];
  minVersion: string | null;
  flags: Record<string, boolean>;
}

export const registryState: RegistryState = { lastOkAt: null, lastError: null, announcements: [], minVersion: null, flags: {} };

/**
 * Where beats go. LMS_REGISTRY_URL is for development and tests only: it points a scratch backend at
 * a local registry, and an empty value keeps it from reporting to the real one.
 */
export const REGISTRY_URL = (process.env.LMS_REGISTRY_URL ?? DEFAULT_REGISTRY_URL).replace(/\/$/, '');

const INTERVAL_MS = 5 * 60 * 1000;
/** After a visible change (server started, player joined…) the next beat goes out this soon, batching bursts. */
const CHANGE_DELAY_MS = 2000;
const MAX_SERVERS = 50;
let timer: NodeJS.Timeout | null = null;
let soon: NodeJS.Timeout | null = null;
const seen = new Set<string>();

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

export async function heartbeat() {
  if (!REGISTRY_URL) return;
  const instances = await listInstances();
  const active = servers.active();
  const serverList = await Promise.all(
    instances.slice(0, MAX_SERVERS).map(async (i) => {
      const proc = servers.peek(i.id);
      const props = await readProperties(join(serverDir(i.id), 'server.properties')).catch(() => ({}) as Record<string, string>);
      return {
        name: i.name.slice(0, 80),
        mcVersion: i.mcVersion.slice(0, 20),
        loader: i.loader,
        state: proc?.state ?? 'stopped',
        players: proc?.players.size ?? 0,
        maxPlayers: Number(props['max-players'] ?? 20) || 20,
      };
    }),
  );
  const body = JSON.stringify({
    nodeId,
    publicKey: publicKey(),
    name: settings().panelName,
    version: VERSION,
    apiVersion: API_VERSION,
    servers: instances.length,
    running: active.length,
    players: active.reduce((n, s) => n + s.players.size, 0),
    serverList,
    t: Date.now(),
  });
  try {
    const res = await fetch(`${REGISTRY_URL}/v1/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lms-signature': signBytes(body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Partial<RegistryState>;
    registryState.lastOkAt = Date.now();
    registryState.lastError = null;
    registryState.announcements = Array.isArray(json.announcements) ? json.announcements.slice(0, 10) : [];
    registryState.minVersion = typeof json.minVersion === 'string' ? json.minVersion : null;
    registryState.flags = json.flags && typeof json.flags === 'object' ? json.flags : {};
    for (const a of registryState.announcements) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      console.log(`  [Hálózat] ${a.title}: ${a.body}`);
    }
    if (registryState.minVersion && newer(registryState.minVersion, VERSION)) {
      console.log(`  [Hálózat] Frissítés ajánlott: legalább v${registryState.minVersion} (ez a gép: v${VERSION}). git pull, majd indítsd újra.`);
    }
  } catch (err) {
    registryState.lastError = (err as Error).message;
  }
}

// Report visible changes within seconds instead of waiting for the next five-minute beat.
onChange(() => {
  if (soon || !timer) return;
  soon = setTimeout(() => {
    soon = null;
    void heartbeat();
  }, CHANGE_DELAY_MS);
  soon.unref();
});

/** Starts the heartbeat loop. */
export function startRegistry() {
  if (timer) clearInterval(timer);
  timer = null;
  if (!REGISTRY_URL) return;
  void heartbeat();
  timer = setInterval(() => void heartbeat(), INTERVAL_MS);
  timer.unref();
}
