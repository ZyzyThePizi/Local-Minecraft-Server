import { existsSync } from 'node:fs';
import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { restoreRequiredMods } from '../moddeps.ts';
import { extractZip } from '../unzip.ts';
import { config, HttpError } from '../config.ts';
import { download, downloadAll, fetchJson, formatBytes, safeJoin, type DownloadItem } from '../download.ts';
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

const toSummary = (m: CfMod): PackSummary => ({
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
});

/**
 * Some CurseForge keys are valid for every endpoint except /mods/search (403). For those, the search
 * itself goes through the public api.curse.tools mirror; everything that is installed (mod details,
 * file list, downloads) still comes from the official API with the user's own key.
 */
const SEARCH_MIRROR = 'https://api.curse.tools/v1/cf';
const SEARCH_BLOCK_MS = 30 * 60 * 1000;
let officialSearchBlockedUntil = 0;

export type SearchVia = 'official' | 'mirror' | 'direct';

/** A pasted project ID or curseforge.com modpack link resolves straight to that pack. */
async function resolveDirect(query: string) {
  const q = query.trim();
  let id: number | null = /^\d{3,9}$/.test(q) ? Number(q) : null;
  const slug = /curseforge\.com\/minecraft\/modpacks\/([a-z0-9][a-z0-9-]*)/i.exec(q)?.[1];
  if (!id && slug) {
    // cfwidget maps slugs to project IDs (the official slug lookup is the blocked search endpoint).
    const widget = await fetchJson<{ id?: number }>(`https://api.cfwidget.com/minecraft/modpacks/${slug.toLowerCase()}`).catch(() => null);
    id = widget?.id ?? null;
    if (!id) throw new HttpError(404, 'NOT_FOUND', `Nem található ilyen CurseForge modpack: ${slug}`);
  }
  if (!id) return null;
  const mod = await cf<CfMod>(`/v1/mods/${id}`);
  if (mod.classId !== CLASS.modpacks) throw new HttpError(400, 'NOT_MODPACK', `${mod.name} nem modpack, hanem egy mod vagy más tartalom.`);
  return toSummary(mod);
}

export async function search(query: string, page = 0): Promise<{ results: PackSummary[]; via: SearchVia }> {
  const direct = await resolveDirect(query);
  if (direct) return { results: [direct], via: 'direct' };

  const params = new URLSearchParams({
    gameId: String(GAME_MINECRAFT),
    classId: String(CLASS.modpacks),
    searchFilter: query,
    sortField: '2',
    sortOrder: 'desc',
    pageSize: '20',
    index: String(page * 20),
  });

  if (Date.now() > officialSearchBlockedUntil) {
    try {
      return { results: (await cf<CfMod[]>(`/v1/mods/search?${params}`)).map(toSummary), via: 'official' };
    } catch (err) {
      if (!(err instanceof HttpError && err.code === 'CURSEFORGE_KEY_INVALID')) throw err;
      // Search refused: only fall back if the key itself works (this throws when it does not).
      await cf(`/v1/games/${GAME_MINECRAFT}`);
      officialSearchBlockedUntil = Date.now() + SEARCH_BLOCK_MS;
      console.log('  A CurseForge kulcs a keresésre nem kap jogot, a keresés a nyilvános tükrön megy (a letöltés a saját kulccsal).');
    }
  }
  const res = await fetchJson<{ data: CfMod[] }>(`${SEARCH_MIRROR}/mods/search?${params}`);
  return { results: res.data.filter((m) => m.classId === CLASS.modpacks).map(toSummary), via: 'mirror' };
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
  if (!done) await installFromManifest(ctx, manifest, packDir, dir, tmp, mod.slug);

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

/**
 * The CurseForge CDN is often throttled to well under 1 MB/s. Many of the same files are on Modrinth,
 * so look them up by SHA-1 and download those from Modrinth's CDN first. The hash check guarantees
 * the bytes are identical; CurseForge stays as the fallback for every file.
 */
async function preferModrinthMirror(ctx: JobContext, plan: DownloadItem[]) {
  const withHash = plan.filter((p) => p.sha1);
  if (!withHash.length) return;
  const mirrors = new Map<string, string>();
  try {
    for (let i = 0; i < withHash.length; i += 500) {
      const hashes = withHash.slice(i, i + 500).map((p) => p.sha1!.toLowerCase());
      const wanted = new Set(hashes);
      const res = await fetchJson<Record<string, { files: { url: string; hashes: { sha1?: string } }[] }>>(
        'https://api.modrinth.com/v2/version_files',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes, algorithm: 'sha1' }) },
      );
      for (const version of Object.values(res)) {
        for (const file of version.files) {
          const h = file.hashes.sha1?.toLowerCase();
          if (h && wanted.has(h)) mirrors.set(h, file.url);
        }
      }
    }
  } catch {
    ctx.log('A Modrinth tükör nem érhető el, minden fájl a CurseForge-ról jön.');
    return;
  }
  let bytes = 0;
  for (const p of withHash) {
    const url = mirrors.get(p.sha1!.toLowerCase());
    if (!url) continue;
    p.urls.unshift(url);
    bytes += p.size ?? 0;
  }
  if (mirrors.size) ctx.log(`Gyorsítás: ${mirrors.size} / ${plan.length} fájl (${formatBytes(bytes)}) a gyorsabb Modrinth CDN-ről jön, ugyanazzal a hash-sel.`);
}

async function installFromManifest(ctx: JobContext, manifest: CfManifest, packDir: string, dir: string, tmp: string, packSlug: string) {
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

  const plan: DownloadItem[] = [];
  const skipped: (DownloadItem & { name: string })[] = [];
  for (const f of files) {
    const m = modById.get(f.modId);
    const classId = m?.classId ?? CLASS.mods;
    if (classId === CLASS.resourcePacks || classId === CLASS.shaders) continue;
    const folder = classId === CLASS.dataPacks ? 'world/datapacks' : 'mods';
    const item = { urls: [fileUrl(f)], dest: safeJoin(dir, `${folder}/${f.fileName}`), sha1: sha1Of(f), size: f.fileLength };
    const slug = m?.slug ?? '';
    const clientOnly = f.gameVersions.includes('Client') && !f.gameVersions.includes('Server');
    if (!rules.forceInclude.has(slug) && (rules.exclude.has(slug) || clientOnly)) {
      if (folder === 'mods') skipped.push({ ...item, name: m?.name ?? f.fileName });
      continue;
    }
    plan.push(item);
  }
  if (skipped.length) ctx.log(`Kliens oldali modok (${skipped.length}): ${skipped.map((s) => s.name).join(', ')}`);

  await preferModrinthMirror(ctx, [...plan, ...skipped]);
  ctx.stage(`Modok letöltése (${plan.length} db)`, 0);
  await downloadAll(ctx, plan, 'Modok letöltése');
  await restoreRequiredMods(ctx, join(dir, 'mods'), join(tmp, 'client-mods'), skipped);

  ctx.stage('Konfigurációk másolása');
  await copyOverrides(join(packDir, manifest.overrides ?? 'overrides'), dir);
  if (!existsSync(join(dir, 'mods'))) ctx.log('Figyelem: a modpack nem tartalmaz modokat.');
}
