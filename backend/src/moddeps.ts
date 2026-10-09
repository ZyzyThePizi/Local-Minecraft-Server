import { existsSync } from 'node:fs';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import yauzl from 'yauzl';
import { download, mapLimit, type DownloadItem } from './download.ts';
import type { JobContext } from './jobs.ts';

/**
 * Client-only filtering is a guess: CurseForge's "Client" tag and the exclude lists are sometimes wrong,
 * and a mod that another server-side mod hard-depends on stops the server at boot
 * ("Mod X requires Y, currently Y is not installed"). So the skipped files are downloaded aside, and every
 * one that a kept mod declares as a required dependency in its own metadata is put back.
 */

interface ModMeta {
  provides: string[];
  requires: string[];
}

// Provided by the loader or the game itself, never by a mod jar.
const BUILTIN = new Set(['minecraft', 'java', 'forge', 'neoforge', 'fml', 'javafml', 'fabricloader', 'fabric-loader', 'quilt_loader']);

const METADATA_FILES = ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'fabric.mod.json', 'quilt.mod.json'];

function readEntries(file: string, names: string[]) {
  return new Promise<Map<string, string>>((resolveAll, reject) => {
    const out = new Map<string, string>();
    yauzl.open(file, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) return reject(openErr ?? new Error(`Nem nyitható meg: ${file}`));
      zip.on('error', reject);
      zip.on('end', () => resolveAll(out));
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!names.includes(entry.fileName) || entry.uncompressedSize > 1 << 20) return zip.readEntry();
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            out.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

/** Just enough TOML for mods.toml: `[[mods]]` and `[[dependencies.x]]` tables with scalar keys. */
function parseModsToml(text: string): ModMeta {
  type Table = Record<string, string | boolean>;
  const mods: Table[] = [];
  const deps: Table[] = [];
  let table: Table | null = null;
  let inMultiline = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const quotes = (line.match(/'''|"""/g) ?? []).length;
    if (inMultiline) {
      if (quotes % 2 === 1) inMultiline = false;
      continue;
    }
    if (quotes % 2 === 1) {
      inMultiline = true;
      continue;
    }
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?/.exec(line);
    if (header) {
      const name = header[1]!;
      table = null;
      if (name === 'mods') mods.push((table = {}));
      else if (name.startsWith('dependencies.')) deps.push((table = {}));
      continue;
    }
    const kv = /^([A-Za-z0-9_]+)\s*=\s*("([^"]*)"|'([^']*)'|true|false)/.exec(line);
    if (table && kv) table[kv[1]!] = kv[3] ?? kv[4] ?? kv[2] === 'true';
  }
  const ids = (list: Table[]) => list.map((t) => t.modId).filter((id): id is string => typeof id === 'string');
  const required = deps.filter((t) => {
    // Forge uses `mandatory = true`, NeoForge `type = "required"`; CLIENT-side dependencies are not checked on a server.
    const side = typeof t.side === 'string' ? t.side.toUpperCase() : 'BOTH';
    return (t.mandatory === true || t.type === 'required') && side !== 'CLIENT';
  });
  return { provides: ids(mods), requires: ids(required) };
}

function parseFabric(text: string): ModMeta | null {
  const j = JSON.parse(text) as { id?: string; provides?: string[]; environment?: string; depends?: Record<string, unknown> };
  if (!j.id) return null;
  // A client-only mod is not loaded on the server, so its dependencies do not matter there.
  const requires = j.environment === 'client' ? [] : Object.keys(j.depends ?? {});
  return { provides: [j.id, ...(j.provides ?? [])], requires };
}

function parseQuilt(text: string): ModMeta | null {
  const j = JSON.parse(text) as {
    quilt_loader?: {
      id?: string;
      provides?: (string | { id: string })[];
      depends?: (string | { id: string; optional?: boolean })[];
    };
    minecraft?: { environment?: string };
  };
  const q = j.quilt_loader;
  if (!q?.id) return null;
  const id = (d: string | { id: string }) => (typeof d === 'string' ? d : d.id);
  const requires =
    j.minecraft?.environment === 'client' ? [] : (q.depends ?? []).filter((d) => typeof d === 'string' || !d.optional).map(id);
  return { provides: [q.id, ...(q.provides ?? []).map(id)], requires: requires.map((r) => r.replace(/^.*:/, '')) };
}

export async function readModMeta(jar: string): Promise<ModMeta | null> {
  try {
    const entries = await readEntries(jar, METADATA_FILES);
    const toml = entries.get('META-INF/neoforge.mods.toml') ?? entries.get('META-INF/mods.toml');
    if (toml) return parseModsToml(toml);
    const quilt = entries.get('quilt.mod.json');
    if (quilt) return parseQuilt(quilt);
    const fabric = entries.get('fabric.mod.json');
    if (fabric) return parseFabric(fabric);
  } catch {
    // Not a readable jar (or broken metadata): treat it as providing nothing.
  }
  return null;
}

/**
 * Downloads the skipped mods into `holdDir`, then moves every one that a mod in `modsDir` (directly or
 * through another restored mod) requires into `modsDir`. Returns the names of the restored mods.
 */
export async function restoreRequiredMods(
  ctx: JobContext,
  modsDir: string,
  holdDir: string,
  skipped: (DownloadItem & { name: string })[],
) {
  if (!skipped.length || !existsSync(modsDir)) return [];
  ctx.stage('Függőségek ellenőrzése');
  await mkdir(holdDir, { recursive: true });
  const held: { name: string; path: string; meta: ModMeta }[] = [];
  await mapLimit(skipped, 8, async (item) => {
    const path = join(holdDir, basename(item.dest));
    for (const url of item.urls) {
      try {
        await download(url, path, { sha1: item.sha1, retries: 1 });
        const meta = await readModMeta(path);
        if (meta) held.push({ name: item.name, path, meta });
        return;
      } catch {
        // try the next source
      }
    }
  });

  const provided = new Set<string>(BUILTIN);
  const required = new Set<string>();
  const jars = (await readdir(modsDir)).filter((f) => f.endsWith('.jar'));
  await mapLimit(jars, 16, async (f) => {
    const meta = await readModMeta(join(modsDir, f));
    meta?.provides.forEach((id) => provided.add(id));
    meta?.requires.forEach((id) => required.add(id));
  });

  const restored: string[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const h of held) {
      if (restored.includes(h.name)) continue;
      const needed = h.meta.provides.some((id) => required.has(id) && !provided.has(id));
      if (!needed) continue;
      await rename(h.path, join(modsDir, basename(h.path)));
      h.meta.provides.forEach((id) => provided.add(id));
      h.meta.requires.forEach((id) => required.add(id));
      restored.push(h.name);
      changed = true;
    }
  }
  if (restored.length) ctx.log(`Mégis telepítve, mert egy szerver oldali mod igényli (${restored.length}): ${restored.join(', ')}`);
  return restored;
}
