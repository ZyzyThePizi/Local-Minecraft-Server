import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import { HttpError, paths } from './config.ts';
import { ensureJava, javaMajorFor } from './java.ts';
import { createJob, runningJob } from './jobs.ts';
import { installLoader } from './loaders.ts';
import { versionInfo } from './mojang.ts';
import { readProperties, writeProperties } from './properties.ts';
import type { InstalledPack } from './providers/common.ts';
import * as curseforge from './providers/curseforge.ts';
import * as modrinth from './providers/modrinth.ts';
import { server } from './server.ts';
import { getSettings, instanceDir, newInstanceId, saveInstance, serverDir, updateSettings, type Instance, type Source } from './store.ts';

export interface InstallRequest {
  source: Source;
  projectId?: string;
  versionId: string;
  name?: string;
}

export const totalMemoryMb = () => Math.floor(totalmem() / 1048576);

/** A sensible -Xmx: modpacks get up to 8 GB, vanilla up to 4 GB, never more than the machine can spare. */
export function recommendedMemory(modded: boolean) {
  const total = totalMemoryMb();
  const target = modded ? Math.min(8192, total * 0.4) : Math.min(4096, total * 0.25);
  return Math.max(1024, Math.floor(target / 512) * 512);
}

export function startInstall(req: InstallRequest) {
  if (runningJob('install')) throw new HttpError(409, 'INSTALL_RUNNING', 'Már fut egy telepítés.');
  if (req.source !== 'vanilla' && !req.projectId) throw new HttpError(400, 'BAD_REQUEST', 'Hiányzik a modpack azonosítója.');

  const title = req.name ?? (req.source === 'vanilla' ? `Vanilla ${req.versionId}` : 'Modpack');
  return createJob('install', title, async (ctx) => {
    const id = newInstanceId(title);
    const dir = serverDir(id);
    const tmp = join(paths.tmp, randomBytes(6).toString('hex'));
    await mkdir(dir, { recursive: true });
    await mkdir(tmp, { recursive: true });
    try {
      let pack: InstalledPack;
      if (req.source === 'curseforge') pack = await curseforge.install(ctx, req.projectId!, req.versionId, dir, tmp);
      else if (req.source === 'modrinth') pack = await modrinth.install(ctx, req.projectId!, req.versionId, dir, tmp);
      else pack = { name: `Vanilla ${req.versionId}`, versionName: req.versionId, mcVersion: req.versionId, loader: 'vanilla' };

      ctx.stage('Java ellenőrzése');
      const javaMajor = javaMajorFor((await versionInfo(pack.mcVersion)).javaMajor);
      const java = await ensureJava(javaMajor, (l) => ctx.log(l));
      const launch = await installLoader(ctx, dir, pack.mcVersion, pack.loader, pack.loaderVersion, java);

      ctx.stage('Szerver előkészítése');
      const propsFile = join(dir, 'server.properties');
      if (!(await readProperties(propsFile)).motd) await writeProperties(propsFile, { motd: pack.name.slice(0, 59) });

      const instance: Instance = {
        id,
        name: pack.name,
        createdAt: new Date().toISOString(),
        source: req.source,
        projectId: req.projectId,
        versionId: req.versionId,
        versionName: pack.versionName,
        iconUrl: pack.iconUrl,
        websiteUrl: pack.websiteUrl,
        mcVersion: pack.mcVersion,
        loader: pack.loader,
        loaderVersion: pack.loaderVersion,
        javaMajor,
        launch,
        memoryMb: recommendedMemory(pack.loader !== 'vanilla'),
      };
      await saveInstance(instance);

      // Switch to the new server unless another one is running right now.
      const settings = await getSettings();
      const activated = !server.isActive() || !settings.activeInstanceId;
      if (activated) await updateSettings({ activeInstanceId: id });
      ctx.log(`Kész: ${pack.name} (${pack.mcVersion}, ${pack.loader})`);
      return { instanceId: id, activated };
    } catch (err) {
      await rm(instanceDir(id), { recursive: true, force: true, maxRetries: 3 });
      throw err;
    } finally {
      await rm(tmp, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
