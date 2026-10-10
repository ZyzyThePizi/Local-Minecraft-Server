import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { config, legacyEnv, paths } from './config.ts';

export type Loader = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt';
export type Source = 'curseforge' | 'modrinth' | 'vanilla';
export type Launch = { kind: 'jar'; jar: string } | { kind: 'argsfile'; file: string };

export interface Instance {
  id: string;
  name: string;
  createdAt: string;
  source: Source;
  projectId?: string;
  versionId?: string;
  versionName?: string;
  iconUrl?: string;
  websiteUrl?: string;
  mcVersion: string;
  loader: Loader;
  loaderVersion?: string;
  javaMajor: number;
  launch: Launch;
  memoryMb: number;
  jvmArgs?: string;
  /** Start this server together with the backend. */
  autoStart?: boolean;
  /** Join address handed to players, e.g. this server's playit.gg tunnel. */
  gameAddress?: string;
}

export interface Settings {
  /** Name of this machine in the hub. */
  panelName: string;
  eulaAccepted: boolean;
  /** Local port of the API; moved automatically when another backend already uses it. */
  apiPort: number;
  /** Pages allowed to call the API from a browser. */
  allowedOrigins: string[];
  /** Memory all running servers may use together, in MB. null = the whole machine minus 2 GB. */
  maxRamMb: number | null;
  /** Whether anyone (without a password) may see which servers run here and their join addresses. */
  publicStatus: boolean;
  /** The address the hub uses. Empty = the Tailscale Funnel address found at startup. */
  publicUrl: string;
  /** Expose the API through Tailscale Funnel on port 10000 (a sub-path when another backend already has the root). */
  funnel: { enabled: boolean; path: string };
  /** Opt-in heartbeat to the network registry (no passwords or player names are sent). */
  registry: { enabled: boolean; url: string };
}

export const DEFAULT_ORIGINS = ['https://zyzythepizi.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173'];
export const DEFAULT_REGISTRY_URL = '';

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Write via a temp file and rename, so a crash never leaves half a JSON file behind. */
export async function writeJson(file: string, data: unknown) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

// ---- settings ----

const defaultSettings = (): Settings => ({
  panelName: hostname(),
  eulaAccepted: false,
  apiPort: 8765,
  allowedOrigins: DEFAULT_ORIGINS,
  maxRamMb: null,
  publicStatus: true,
  publicUrl: '',
  funnel: { enabled: true, path: '/' },
  registry: { enabled: false, url: DEFAULT_REGISTRY_URL },
});

let cached: Settings | null = null;

/** Loads settings.json, moving over what version 1 kept in .env or in the global settings. */
export async function initSettings() {
  const raw = await readJson<Record<string, unknown>>(paths.settings, {});
  const migrated = 'activeInstanceId' in raw || 'autoStart' in raw || 'gameAddress' in raw;
  if (migrated) {
    // Version 1 had one active server; its autostart flag and join address now belong to that server.
    const inst = await getInstance(raw.activeInstanceId as string | null);
    const address = (raw.gameAddress as string | undefined) || legacyEnv.gameAddress;
    if (inst) {
      if (raw.autoStart === true) inst.autoStart = true;
      if (address && !inst.gameAddress) inst.gameAddress = address;
      await saveInstance(inst);
    }
    delete raw.activeInstanceId;
    delete raw.autoStart;
    delete raw.gameAddress;
    if (legacyEnv.panelName) raw.panelName = legacyEnv.panelName;
    if (legacyEnv.port) raw.apiPort = legacyEnv.port;
    if (legacyEnv.allowedOrigins) {
      raw.allowedOrigins = [...new Set([...legacyEnv.allowedOrigins.split(','), ...DEFAULT_ORIGINS].map((s) => s.trim().replace(/\/$/, '')).filter(Boolean))];
    }
  }
  cached = { ...defaultSettings(), ...(raw as Partial<Settings>) };
  if (migrated || !existsSync(paths.settings)) await saveSettings(cached);
  return { settings: cached, migrated };
}

/** In-memory copy, kept in sync by updateSettings. */
export function settings(): Settings {
  if (!cached) throw new Error('settings not loaded');
  return cached;
}

async function saveSettings(next: Settings) {
  await mkdir(config.dataDir, { recursive: true });
  await writeJson(paths.settings, next);
}

export async function getSettings(): Promise<Settings> {
  return settings();
}

export async function updateSettings(patch: Partial<Settings>) {
  const next = { ...settings(), ...patch };
  await saveSettings(next);
  cached = next;
  return next;
}

// ---- instances ----

export const instanceDir = (id: string) => join(paths.instances, id);
export const serverDir = (id: string) => join(paths.instances, id, 'server');
const instanceFile = (id: string) => join(paths.instances, id, 'instance.json');

export function newInstanceId(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 40);
  return `${slug || 'server'}-${randomBytes(3).toString('hex')}`;
}

export const isValidInstanceId = (id: string) => /^[a-z0-9-]{1,60}$/.test(id);

export async function listInstances(): Promise<Instance[]> {
  if (!existsSync(paths.instances)) return [];
  const ids = await readdir(paths.instances);
  const all = await Promise.all(ids.map((id) => readJson<Instance | null>(instanceFile(id), null)));
  return all.filter((i): i is Instance => i !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getInstance(id: string | null | undefined) {
  if (!id || !isValidInstanceId(id)) return null;
  return readJson<Instance | null>(instanceFile(id), null);
}

export async function saveInstance(inst: Instance) {
  await mkdir(instanceDir(inst.id), { recursive: true });
  await writeJson(instanceFile(inst.id), inst);
}

/** Removes folders of installs that never finished (no instance.json), e.g. when the backend was closed mid-install. */
export async function removeIncompleteInstances() {
  if (!existsSync(paths.instances)) return [];
  const removed: string[] = [];
  for (const id of await readdir(paths.instances)) {
    if (!existsSync(instanceFile(id))) {
      await rm(instanceDir(id), { recursive: true, force: true, maxRetries: 3 });
      removed.push(id);
    }
  }
  return removed;
}

export async function deleteInstance(id: string) {
  if (!isValidInstanceId(id)) return;
  await rm(instanceDir(id), { recursive: true, force: true, maxRetries: 3 });
}
