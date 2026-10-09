import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, paths } from './config.ts';

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
}

export interface Settings {
  eulaAccepted: boolean;
  activeInstanceId: string | null;
  autoStart: boolean;
  gameAddress: string;
}

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
  eulaAccepted: false,
  activeInstanceId: null,
  autoStart: false,
  gameAddress: config.gameAddress,
});

export async function getSettings(): Promise<Settings> {
  return { ...defaultSettings(), ...(await readJson<Partial<Settings>>(paths.settings, {})) };
}

export async function updateSettings(patch: Partial<Settings>) {
  const next = { ...(await getSettings()), ...patch };
  await mkdir(config.dataDir, { recursive: true });
  await writeJson(paths.settings, next);
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
