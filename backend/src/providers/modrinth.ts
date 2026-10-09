import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { restoreRequiredMods } from '../moddeps.ts';
import { extractZip } from '../unzip.ts';
import { download, downloadAll, fetchJson, safeJoin } from '../download.ts';
import type { JobContext } from '../jobs.ts';
import type { Loader } from '../store.ts';
import { copyOverrides, sortMcVersions, type InstalledPack, type PackSummary, type PackVersion } from './common.ts';

const API = 'https://api.modrinth.com/v2';
const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];
const LOADER_LABEL: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };

interface MrHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string | null;
  downloads: number;
  author: string;
  versions: string[];
  categories: string[];
}

interface MrVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  version_type: 'release' | 'beta' | 'alpha';
  date_published: string;
  files: { url: string; filename: string; primary: boolean; hashes: { sha1?: string } }[];
}

interface MrIndex {
  name: string;
  files: { path: string; hashes: { sha1?: string }; env?: { client?: string; server?: string }; downloads: string[] }[];
  dependencies: Record<string, string>;
}

export async function search(query: string, page = 0): Promise<PackSummary[]> {
  const params = new URLSearchParams({
    query,
    facets: JSON.stringify([['project_type:modpack']]),
    limit: '20',
    offset: String(page * 20),
    index: query ? 'relevance' : 'downloads',
  });
  const { hits } = await fetchJson<{ hits: MrHit[] }>(`${API}/search?${params}`);
  return hits.map((h) => ({
    source: 'modrinth',
    id: h.project_id,
    slug: h.slug,
    name: h.title,
    summary: h.description,
    iconUrl: h.icon_url ?? undefined,
    downloads: h.downloads,
    author: h.author,
    websiteUrl: `https://modrinth.com/modpack/${h.slug}`,
    mcVersions: sortMcVersions(h.versions),
    loaders: h.categories.filter((c) => LOADERS.includes(c)).map((c) => LOADER_LABEL[c]!),
  }));
}

export async function versions(projectId: string): Promise<PackVersion[]> {
  const list = await fetchJson<MrVersion[]>(`${API}/project/${encodeURIComponent(projectId)}/version`);
  return list.map((v) => ({
    id: v.id,
    name: v.name || v.version_number,
    mcVersions: sortMcVersions(v.game_versions),
    loaders: v.loaders.map((l) => LOADER_LABEL[l] ?? l),
    type: v.version_type,
    date: v.date_published,
  }));
}

function loaderFrom(deps: Record<string, string>): { loader: Loader; loaderVersion?: string } {
  if (deps.neoforge) return { loader: 'neoforge', loaderVersion: deps.neoforge };
  if (deps.forge) return { loader: 'forge', loaderVersion: deps.forge };
  if (deps['fabric-loader']) return { loader: 'fabric', loaderVersion: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { loader: 'quilt', loaderVersion: deps['quilt-loader'] };
  return { loader: 'vanilla' };
}

export async function install(ctx: JobContext, projectId: string, versionId: string, dir: string, tmp: string): Promise<InstalledPack> {
  ctx.stage('Modpack adatainak lekérése');
  const version = await fetchJson<MrVersion>(`${API}/version/${encodeURIComponent(versionId)}`);
  if (version.project_id !== projectId) throw new Error('A verzió nem ehhez a modpackhez tartozik.');
  const project = await fetchJson<{ title: string; slug: string; icon_url?: string | null }>(`${API}/project/${encodeURIComponent(projectId)}`);
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) throw new Error('Ehhez a verzióhoz nincs letölthető fájl.');

  ctx.stage(`${file.filename} letöltése`, 0);
  const zip = join(tmp, 'pack.mrpack');
  await download(file.url, zip, { sha1: file.hashes.sha1, onProgress: (r, t) => t && ctx.progress(r / t) });
  const packDir = join(tmp, 'pack');
  await extractZip(zip, packDir);
  const index = JSON.parse(await readFile(join(packDir, 'modrinth.index.json'), 'utf8')) as MrIndex;
  const { loader, loaderVersion } = loaderFrom(index.dependencies);
  const mcVersion = index.dependencies.minecraft;
  if (!mcVersion) throw new Error('A modpack nem adja meg a Minecraft verziót.');
  ctx.log(`Minecraft ${mcVersion}, ${loader} ${loaderVersion ?? ''}`);

  // Modrinth marks each file's environment; a client-only mod that a server mod still requires is put back below.
  const files = index.files.filter((f) => f.env?.server !== 'unsupported');
  const skipped = index.files
    .filter((f) => f.env?.server === 'unsupported' && f.path.startsWith('mods/'))
    .map((f) => ({ urls: f.downloads, dest: safeJoin(dir, f.path), sha1: f.hashes.sha1, name: f.path.slice(5) }));
  if (skipped.length) ctx.log(`Kliens oldali modok (${skipped.length}): ${skipped.map((s) => s.name).join(', ')}`);

  ctx.stage(`Modok letöltése (${files.length} db)`, 0);
  await downloadAll(
    ctx,
    files.map((f) => ({ urls: f.downloads, dest: safeJoin(dir, f.path), sha1: f.hashes.sha1 })),
    'Modok letöltése',
  );
  await restoreRequiredMods(ctx, join(dir, 'mods'), join(tmp, 'client-mods'), skipped);

  ctx.stage('Konfigurációk másolása');
  await copyOverrides(join(packDir, 'overrides'), dir);
  await copyOverrides(join(packDir, 'server-overrides'), dir);

  return {
    name: project.title,
    versionName: version.name || version.version_number,
    iconUrl: project.icon_url ?? undefined,
    websiteUrl: `https://modrinth.com/modpack/${project.slug}`,
    mcVersion,
    loader,
    loaderVersion,
  };
}
