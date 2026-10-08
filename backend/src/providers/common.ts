import { existsSync } from 'node:fs';
import { cp, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Loader, Source } from '../store.ts';

export interface PackSummary {
  source: Source;
  id: string;
  slug: string;
  name: string;
  summary: string;
  iconUrl?: string;
  downloads: number;
  author?: string;
  websiteUrl?: string;
  mcVersions: string[];
  loaders: string[];
}

export interface PackVersion {
  id: string;
  name: string;
  mcVersions: string[];
  loaders: string[];
  type: 'release' | 'beta' | 'alpha';
  date: string;
  hasServerPack?: boolean;
}

/** What a provider hands back after putting the pack's files into the server folder. */
export interface InstalledPack {
  name: string;
  versionName: string;
  iconUrl?: string;
  websiteUrl?: string;
  mcVersion: string;
  loader: Loader;
  loaderVersion?: string;
}

const versionKey = (v: string) => v.split('.').map((n) => n.padStart(4, '0')).join('.');
export const sortMcVersions = (list: Iterable<string>) =>
  [...new Set(list)].filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)).sort((a, b) => versionKey(b).localeCompare(versionKey(a)));

// Client-side folders that only waste disk space on a server.
const CLIENT_ONLY_DIRS = new Set(['resourcepacks', 'shaderpacks', 'screenshots', 'saves']);

export async function copyOverrides(src: string, dest: string) {
  if (!existsSync(src)) return;
  await cp(src, dest, {
    recursive: true,
    force: true,
    filter: (file) => !CLIENT_ONLY_DIRS.has(relative(src, file).split(sep)[0] ?? ''),
  });
}

/** Server packs are often zipped inside one or two wrapper folders; find the folder that holds `mods`. */
export async function findPackRoot(dir: string) {
  let root = dir;
  for (let depth = 0; depth < 3; depth++) {
    if (existsSync(join(root, 'mods'))) return root;
    const entries = (await readdir(root, { withFileTypes: true })).filter((e) => e.name !== '__MACOSX');
    const only = entries.length === 1 ? entries[0] : undefined;
    if (!only?.isDirectory()) break;
    root = join(root, only.name);
  }
  return existsSync(join(root, 'mods')) ? root : null;
}
