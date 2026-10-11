import { existsSync } from 'node:fs';
import { readdir, rm, rmdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { HttpError } from './config.ts';
import { tx } from './i18n.ts';
import { worldDir } from './players.ts';
import { serverDir } from './store.ts';

/**
 * A fresh start for a server:
 * - players: every player's character data; the world itself stays
 * - world: the world (and with it the character data stored inside it); a new one is generated on the next start
 * - all: the world, the list of known players and the backups of backup mods
 * Mods, configs, server.properties, operators, the whitelist and bans are never touched.
 */
export const WIPE_SCOPES = ['players', 'world', 'all'] as const;
export type WipeScope = (typeof WIPE_SCOPES)[number];

/** Vanilla keeps one file per player in these world folders. */
const PLAYER_DIRS = ['playerdata', 'stats', 'advancements'];
/** Name → UUID caches at the server root: the list of everyone who ever joined. */
const PLAYER_CACHES = ['usercache.json', 'usernamecache.json'];
/** Settings that live inside the world folder and have to survive a new world. */
const WORLD_KEEP = new Set(['datapacks', 'serverconfig']);
/** Folders of backup mods (Simple Backups, FTB Backups): old copies of the world. */
const BACKUP_DIRS = ['simplebackups', 'backups'];
/** What a folder has when it is a Minecraft world (and not, say, the mods folder named in level-name by mistake). */
const WORLD_MARKERS = ['level.dat', 'session.lock', 'region', 'playerdata', 'data'];

const UUID_NAME = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

async function remove(path: string) {
  await rm(path, { recursive: true, force: true, maxRetries: 3 });
}

async function looksLikeWorld(dir: string) {
  const names = await readdir(dir);
  // Empty, or only what an earlier wipe left behind, also counts.
  return names.every((n) => WORLD_KEEP.has(n)) || names.some((n) => WORLD_MARKERS.includes(n));
}

/**
 * Every file and folder named after a UUID, anywhere in the world: mods keep per-player and
 * per-team data that way (FTB Quests, Teams and Chunks, death chests…).
 */
async function uuidNamed(dir: string, out: string[] = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (UUID_NAME.test(entry.name.split('.')[0]!)) out.push(path);
    else if (entry.isDirectory()) await uuidNamed(path, out);
  }
  return out;
}

async function wipePlayers(id: string, world: string) {
  const removed: string[] = [];
  if (existsSync(world)) {
    for (const name of PLAYER_DIRS) {
      if (!existsSync(join(world, name))) continue;
      await remove(join(world, name));
      removed.push(name);
    }
    // Report the mod data by folder: "ftbquests (12)" instead of a dozen UUIDs.
    const byFolder = new Map<string, number>();
    for (const path of await uuidNamed(world)) {
      await remove(path);
      const folder = relative(world, path).split(/[\\/]/)[0]!;
      byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
    }
    for (const [folder, count] of byFolder) removed.push(`${folder} (${count})`);
  }
  for (const name of PLAYER_CACHES) {
    if (!existsSync(join(serverDir(id), name))) continue;
    await remove(join(serverDir(id), name));
    removed.push(name);
  }
  return removed;
}

async function wipeWorld(world: string) {
  if (!existsSync(world)) return [];
  const names = await readdir(world);
  const gone = names.filter((n) => !WORLD_KEEP.has(n));
  for (const name of gone) await remove(join(world, name));
  if (gone.length === names.length) await rmdir(world);
  // A folder that only held the kept settings had no world in it.
  return gone.length || !names.length ? [world.split(/[\\/]/).at(-1)!] : [];
}

/** Deletes the chosen data of a stopped server and returns what was removed (names relative to the server folder). */
export async function wipeServer(id: string, scope: WipeScope) {
  const root = serverDir(id);
  const world = await worldDir(id);
  if (existsSync(world) && !(await looksLikeWorld(world))) {
    throw new HttpError(
      409,
      'NOT_A_WORLD',
      tx('The folder named in level-name does not look like a Minecraft world, so nothing was deleted.', 'A level-name-ben megadott mappa nem tűnik Minecraft világnak, ezért semmit nem töröltem.'),
    );
  }
  if (scope === 'players') return wipePlayers(id, world);

  const removed = await wipeWorld(world);
  // Servers that split the dimensions into sibling folders (world_nether, world_the_end).
  for (const suffix of ['_nether', '_the_end']) {
    if (!existsSync(world + suffix) || !(await looksLikeWorld(world + suffix))) continue;
    await remove(world + suffix);
    removed.push((world + suffix).split(/[\\/]/).at(-1)!);
  }
  if (scope === 'world') return removed;

  for (const name of [...PLAYER_CACHES, ...BACKUP_DIRS]) {
    if (!existsSync(join(root, name))) continue;
    await remove(join(root, name));
    removed.push(name);
  }
  return removed;
}
