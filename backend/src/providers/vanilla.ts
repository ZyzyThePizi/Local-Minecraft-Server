import { mojangVersions } from '../mojang.ts';
import type { PackVersion } from './common.ts';

export async function versions(): Promise<PackVersion[]> {
  return (await mojangVersions())
    .filter((v) => v.type === 'release')
    .map((v) => ({ id: v.id, name: `Minecraft ${v.id}`, mcVersions: [v.id], loaders: [], type: 'release', date: v.releaseTime }));
}
