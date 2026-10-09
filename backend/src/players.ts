import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { HttpError } from './config.ts';
import { readProperties } from './properties.ts';
import { readJson, serverDir } from './store.ts';

export interface KnownPlayer {
  name: string;
  uuid: string;
  op: boolean;
  online: boolean;
  /** Number of files the world keeps for this player (inventory, stats, quests, claims…). */
  dataFiles: number;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function worldDir(instanceId: string) {
  const level = (await readProperties(join(serverDir(instanceId), 'server.properties')))['level-name'] || 'world';
  if (/[\\/]|\.\./.test(level)) throw new HttpError(400, 'BAD_LEVEL', 'Érvénytelen level-name a server.properties-ben.');
  return join(serverDir(instanceId), level);
}

/**
 * Every file in the world named after a player's UUID (with or without dashes): vanilla
 * playerdata/stats/advancements plus per-player files of mods such as FTB Quests, Teams and Chunks.
 */
async function filesByPlayer(world: string) {
  const byId = new Map<string, string[]>();
  if (!existsSync(world)) return byId;
  for (const entry of await readdir(world, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const id = entry.name.split('.')[0]!.toLowerCase();
    if (!/^[0-9a-f-]{32,36}$/.test(id)) continue;
    const key = id.replaceAll('-', '');
    byId.set(key, [...(byId.get(key) ?? []), join(entry.parentPath, entry.name)]);
  }
  return byId;
}

export async function listPlayers(instanceId: string, online: string[]): Promise<KnownPlayer[]> {
  const dir = serverDir(instanceId);
  const cache = await readJson<{ name: string; uuid: string }[]>(join(dir, 'usercache.json'), []);
  const ops = new Set((await readJson<{ uuid: string }[]>(join(dir, 'ops.json'), [])).map((o) => o.uuid.toLowerCase()));
  const files = await filesByPlayer(await worldDir(instanceId));
  const onlineSet = new Set(online.map((n) => n.toLowerCase()));
  return cache
    .filter((p) => isUuid(p.uuid))
    .map((p) => ({
      name: p.name,
      uuid: p.uuid,
      op: ops.has(p.uuid.toLowerCase()),
      online: onlineSet.has(p.name.toLowerCase()),
      dataFiles: files.get(p.uuid.toLowerCase().replaceAll('-', ''))?.length ?? 0,
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

/** Deletes a player's character data so they start fresh; the world itself and their OP/whitelist status stay. */
export async function resetPlayer(instanceId: string, uuid: string) {
  const world = await worldDir(instanceId);
  const files = (await filesByPlayer(world)).get(uuid.toLowerCase().replaceAll('-', '')) ?? [];
  for (const file of files) await rm(file, { force: true });
  return files.map((f) => relative(world, f).replaceAll('\\', '/'));
}
