import { API_VERSION, VERSION } from './config.ts';
import { nodeId, publicKey, signBytes } from './node.ts';
import { servers } from './servers.ts';
import { listInstances, settings } from './store.ts';

/**
 * Opt-in heartbeat to the network registry (the private control panel reads it).
 * It carries no password, token, address or player name: only this machine's id and public key,
 * its name, version and how many servers and players it has. The body is signed with the machine key.
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

const INTERVAL_MS = 5 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
const seen = new Set<string>();

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

export async function heartbeat() {
  const { enabled, url } = settings().registry;
  if (!enabled || !url) return;
  const instances = await listInstances();
  const active = servers.active();
  const body = JSON.stringify({
    nodeId,
    publicKey: publicKey(),
    name: settings().panelName,
    version: VERSION,
    apiVersion: API_VERSION,
    servers: instances.length,
    running: active.length,
    players: active.reduce((n, s) => n + s.players.size, 0),
    t: Date.now(),
  });
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/heartbeat`, {
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

/** (Re)starts the heartbeat loop; call after the registry setting changes. */
export function startRegistry() {
  if (timer) clearInterval(timer);
  timer = null;
  if (!settings().registry.enabled) return;
  void heartbeat();
  timer = setInterval(() => void heartbeat(), INTERVAL_MS);
  timer.unref();
}
