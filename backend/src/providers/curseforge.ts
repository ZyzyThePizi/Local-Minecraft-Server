import { existsSync } from 'node:fs';
import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractZip } from '../unzip.ts';
import { config, HttpError } from '../config.ts';
import { download, fetchJson, mapLimit, safeJoin } from '../download.ts';
import type { JobContext } from '../jobs.ts';
import type { Loader } from '../store.ts';
import { copyOverrides, findPackRoot, sortMcVersions, type InstalledPack, type PackSummary, type PackVersion } from './common.ts';

const API = 'https://api.curseforge.com';
const GAME_MINECRAFT = 432;
const CLASS = { mods: 6, resourcePacks: 12, modpacks: 4471, shaders: 6552, dataPacks: 6945 };
const LOADER_NAMES: Record<number, string> = { 1: 'Forge', 4: 'Fabric', 5: 'Quilt', 6: 'NeoForge' };
const EXCLUDES_URL = 'https://raw.githubusercontent.com/itzg/docker-minecraft-server/master/files/cf-exclude-include.json';

interface CfFile {
  id: number;
  modId: number;
  displayName: string;
  fileName: string;
  releaseType: 1 | 2 | 3;
  fileDate: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
  hashes?: { value: string; algo: number }[];
  serverPackFileId?: number | null;
  isServerPack?: boolean;
}

interface CfMod {
  id: number;
  name: string;
  slug: string;
  summary: string;
  classId: number;
  downloadCount: number;
  logo?: { thumbnailUrl: string } | null;
  links?: { websiteUrl?: string };
  authors?: { name: string }[];
  latestFilesIndexes?: { gameVersion: string; modLoader?: number }[];
}

interface CfManifest {
  minecraft: { version: string; modLoaders: { id: string; primary?: boolean }[] };
  files: { projectID: number; fileID: number; required?: boolean }[];
  overrides?: string;
}

async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!config.curseforgeApiKey) {
    throw new HttpError(400, 'CURSEFORGE_KEY_MISSING', 'Nincs CurseForge API kulcs a backend .env fájljában (CURSEFORGE_API_KEY).');
  }
  try {
    const res = await fetchJson<{ data: T }>(API + path, {
      ...init,
      headers: { 'x-api-key': config.curseforgeApiKey, 'Content-Type': 'application/json' },
    });
    return res.data;
  } catch (err) {
    if (err instanceof Error && /^40[13]\b/.test(err.message)) {
      throw new HttpError(400, 'CURSEFORGE_KEY_INVALID', 'A CurseForge API kulcs érvénytelen.');
    }
    throw err;
  }
}

// Some authors opt out of third-party downloads (downloadUrl is null); the CDN path is still predictable.
const fileUrl = (f: CfFile) =>
  f.downloadUrl ?? `https://mediafilez.forgecdn.net/files/${Math.floor(f.id / 1000)}/${f.id % 1000}/${encodeURIComponent(f.fileName)}`;
const sha1Of = (f: CfFile) => f.hashes?.find((h) => h.algo === 1)?.value;
const RELEASE_TYPES = { 1: 'release', 2: 'beta', 3: 'alpha' } as const;

export async function search(query: string, page = 0): Promise<PackSummary[]> {
  const params = new URLSearchParams({
    gameId: String(GAME_MINECRAFT),
    classId: String(CLASS.modpacks),
    searchFilter: query,
    sortField: '2',
    sortOrder: 'desc',
    pageSize: '20',
    index: String(page * 20),
  });
  const mods = await cf<CfMod[]>(`/v1/mods/search?${params}`);
  return mods.map((m) => ({
    source: 'curseforge',
    id: String(m.id),
    slug: m.slug,
    name: m.name,
    summary: m.summary,
    iconUrl: m.logo?.thumbnailUrl,
    downloads: m.downloadCount,
    author: m.authors?.[0]?.name,
    websiteUrl: m.links?.websiteUrl,
    mcVersions: sortMcVersions((m.latestFilesIndexes ?? []).map((i) => i.gameVersion)),
    loaders: [...new Set((m.latestFilesIndexes ?? []).map((i) => LOADER_NAMES[i.modLoader ?? 0]).filter(Boolean) as string[])],
  }));
}

export async function versions(projectId: string): Promise<PackVersion[]> {
  const files = await cf<CfFile[]>(`/v1/mods/${Number(projectId)}/files?pageSize=50`);
  return files
    .filter((f) => !f.isServerPack)
    .sort((a, b) => b.fileDate.localeCompare(a.fileDate))
    .map((f) => ({
      id: String(f.id),
      name: f.displayName,
      mcVersions: sortMcVersions(f.gameVersions),
      loaders: f.gameVersions.filter((v) => Object.values(LOADER_NAMES).includes(v)),
      type: RELEASE_TYPES[f.releaseType] ?? 'release',
      date: f.fileDate,
      hasServerPack: Boolean(f.serverPackFileId),
    }));
}

function parseLoader(id: string | undefined): { loader: Loader; loaderVersion?: string } {
  if (!id) return { loader: 'vanilla' };
  const dash = id.indexOf('-');
  const name = id.slice(0, dash).toLowerCase();
  const version = id.slice(dash + 1);
  if (name === 'forge' || name === 'neoforge' || name === 'fabric' || name === 'quilt') return { loader: name, loaderVersion: version };
  throw new Error(`Nem támogatott mod loader: ${id}`);
}

export async function install(ctx: JobContext, projectId: string, fileId: string, dir: string, tmp: string): Promise<InstalledPack> {
  const pid = Number(projectId);
  ctx.stage('Modpack adatainak lekérése');
  const [mod, file] = await Promise.all([cf<CfMod>(`/v1/mods/${pid}`), cf<CfFile>(`/v1/mods/${pid}/files/${Number(fileId)}`)]);
  if (mod.classId !== CLASS.modpacks) throw new Error(`${mod.name} nem modpack.`);

  ctx.stage(`${file.displayName} letöltése`, 0);
  const packZip = join(tmp, 'pack.zip');
  await download(fileUrl(file), packZip, { sha1: sha1Of(file), onProgress: (r, t) => t && ctx.progress(r / t) });
  const packDir = join(tmp, 'pack');
  await extractZip(packZip, packDir);
  const manifest = JSON.parse(await readFile(join(packDir, 'manifest.json'), 'utf8')) as CfManifest;
  const loaders = manifest.minecraft.modLoaders;
  const { loader, loaderVersion } = parseLoader((loaders.find((l) => l.primary) ?? loaders[0])?.id);
  ctx.log(`Minecraft ${manifest.minecraft.version}, ${loader} ${loaderVersion ?? ''}`);

  // The author's server pack is the most reliable source of the right server-side mod list.
  let done = false;
  if (file.serverPackFileId) {
    try {
      done = await installServerPack(ctx, pid, file.serverPackFileId, dir, tmp);
    } catch (err) {
      ctx.log(`A szervercsomag nem használható (${err instanceof Error ? err.message : err}), a modlista alapján telepítek.`);
    }
  }
  if (!done) await installFromManifest(ctx, manifest, packDir, dir, mod.slug);

  return {
    name: mod.name,
    versionName: file.displayName,
    iconUrl: mod.logo?.thumbnailUrl,
    websiteUrl: mod.links?.websiteUrl,
    mcVersion: manifest.minecraft.version,
    loader,
    loaderVersion,
  };
}

async function installServerPack(ctx: JobContext, pid: number, serverFileId: number, dir: string, tmp: string) {
  const sp = await cf<CfFile>(`/v1/mods/${pid}/files/${serverFileId}`);
  ctx.stage(`Szervercsomag letöltése (${sp.fileName})`, 0);
  const zip = join(tmp, 'server.zip');
  await download(fileUrl(sp), zip, { sha1: sha1Of(sp), onProgress: (r, t) => t && ctx.progress(r / t) });
  ctx.stage('Szervercsomag kicsomagolása');
  const spDir = join(tmp, 'server');
  await extractZip(zip, spDir);
  const root = await findPackRoot(spDir);
  if (!root) throw new Error('nincs benne mods mappa');
  await cp(root, dir, { recursive: true, force: true });
  return true;
}

async function loadExcludeRules(ctx: JobContext, packSlug: string) {
  try {
    const j = await fetchJson<{
      globalExcludes?: string[];
      globalForceIncludes?: string[];
      modpacks?: Record<string, { excludes?: string[]; forceIncludes?: string[] }>;
    }>(EXCLUDES_URL);
    const pack = j.modpacks?.[packSlug];
    return {
      exclude: new Set([...(j.globalExcludes ?? []), ...(pack?.excludes ?? [])]),
      forceInclude: new Set([...(j.globalForceIncludes ?? []), ...(pack?.forceIncludes ?? [])]),
    };
  } catch {
    ctx.log('A kliens-oldali modok kizárólistája nem érhető el, csak a CurseForge jelölései alapján szűrök.');
    return { exclude: new Set<string>(), forceInclude: new Set<string>() };
  }
}

async function chunked<T, R>(items: T[], size: number, fn: (chunk: T[]) => Promise<R[]>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await fn(items.slice(i, i + size))));
  return out;
}

async function installFromManifest(ctx: JobContext, manifest: CfManifest, packDir: string, dir: string, packSlug: string) {
  ctx.stage('Modlista feldolgozása');
  const rules = await loadExcludeRules(ctx, packSlug);
  const required = manifest.files.filter((f) => f.required !== false);
  const files = await chunked(required.map((f) => f.fileID), 100, (fileIds) =>
    cf<CfFile[]>('/v1/mods/files', { method: 'POST', body: JSON.stringify({ fileIds }) }),
  );
  const mods = await chunked([...new Set(required.map((f) => f.projectID))], 100, (modIds) =>
    cf<CfMod[]>('/v1/mods', { method: 'POST', body: JSON.stringify({ modIds }) }),
  );
  const modById = new Map(mods.map((m) => [m.id, m]));
  if (files.length < required.length) ctx.log(`Figyelem: ${required.length - files.length} fájl már nem érhető el a CurseForge-on.`);

  const plan: { url: string; dest: string; sha1?: string }[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const m = modById.get(f.modId);
    const classId = m?.classId ?? CLASS.mods;
    if (classId === CLASS.resourcePacks || classId === CLASS.shaders) continue;
    const slug = m?.slug ?? '';
    const clientOnly = f.gameVersions.includes('Client') && !f.gameVersions.includes('Server');
    if (!rules.forceInclude.has(slug) && (rules.exclude.has(slug) || clientOnly)) {
      skipped.push(m?.name ?? f.fileName);
      continue;
    }
    const folder = classId === CLASS.dataPacks ? 'world/datapacks' : 'mods';
    plan.push({ url: fileUrl(f), dest: safeJoin(dir, `${folder}/${f.fileName}`), sha1: sha1Of(f) });
  }
  if (skipped.length) ctx.log(`Kihagyva, mert csak kliens oldali (${skipped.length}): ${skipped.join(', ')}`);

  ctx.stage(`Modok letöltése (${plan.length} db)`, 0);
  let finished = 0;
  await mapLimit(plan, 6, async (p) => {
    await download(p.url, p.dest, { sha1: p.sha1 });
    ctx.progress(++finished / plan.length);
  });

  ctx.stage('Konfigurációk másolása');
  await copyOverrides(join(packDir, manifest.overrides ?? 'overrides'), dir);
  if (!existsSync(join(dir, 'mods'))) ctx.log('Figyelem: a modpack nem tartalmaz modokat.');
}
