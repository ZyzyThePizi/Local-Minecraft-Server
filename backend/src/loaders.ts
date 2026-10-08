import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { download, fetchJson } from './download.ts';
import type { JobContext } from './jobs.ts';
import { versionInfo } from './mojang.ts';
import type { Launch, Loader } from './store.ts';

/** Runs a command to completion, streaming its output into the job log. */
export function runProcess(cmd: string, args: string[], cwd: string, ctx: JobContext) {
  return new Promise<void>((resolveRun, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let lines = 0;
    const onData = (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        // Installers print thousands of lines; keep every 25th so the log stays readable.
        if (line.trim() && lines++ % 25 === 0) ctx.log(`  ${line.trim().slice(0, 200)}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolveRun() : reject(new Error(`${cmd} kilépési kód: ${code}`))));
  });
}

async function tryDownload(urls: string[], dest: string) {
  let lastError: unknown;
  for (const url of urls) {
    try {
      await download(url, dest, { retries: 1 });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function latestFabricLoader(mc: string) {
  const list = await fetchJson<{ loader: { version: string; stable: boolean } }[]>(
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`,
  );
  const pick = list.find((l) => l.loader.stable) ?? list[0];
  if (!pick) throw new Error(`A Fabric nem támogatja ezt a verziót: ${mc}`);
  return pick.loader.version;
}

/**
 * Installs the server side of a mod loader into `dir` and returns how to launch it.
 * Mods and configs are already in place; this only adds the loader and the game jar.
 */
export async function installLoader(
  ctx: JobContext,
  dir: string,
  mc: string,
  loader: Loader,
  loaderVersion: string | undefined,
  java: string,
): Promise<Launch> {
  switch (loader) {
    case 'vanilla': {
      ctx.stage(`Minecraft ${mc} szerver letöltése`);
      const { server } = await versionInfo(mc);
      if (!server) throw new Error(`Ehhez a verzióhoz nincs hivatalos szerver: ${mc}`);
      await download(server.url, join(dir, 'server.jar'), { sha1: server.sha1 });
      return { kind: 'jar', jar: 'server.jar' };
    }

    case 'fabric': {
      const version = loaderVersion ?? (await latestFabricLoader(mc));
      ctx.stage(`Fabric ${version} telepítése`);
      const installers = await fetchJson<{ version: string; stable: boolean }[]>(
        'https://meta.fabricmc.net/v2/versions/installer',
      );
      const installer = (installers.find((i) => i.stable) ?? installers[0])!.version;
      await download(
        `https://meta.fabricmc.net/v2/versions/loader/${mc}/${version}/${installer}/server/jar`,
        join(dir, 'fabric-server-launch.jar'),
      );
      // The launcher downloads the vanilla jar itself on first start; prefetch it so the first start is quick.
      const { server } = await versionInfo(mc);
      if (server) await download(server.url, join(dir, 'server.jar'), { sha1: server.sha1 });
      return { kind: 'jar', jar: 'fabric-server-launch.jar' };
    }

    case 'quilt': {
      const meta = await fetchJson<{ version: string }[]>('https://meta.quiltmc.org/v3/versions/installer');
      const installer = meta[0]!.version;
      const version =
        loaderVersion ?? (await fetchJson<{ version: string }[]>('https://meta.quiltmc.org/v3/versions/loader'))[0]!.version;
      ctx.stage(`Quilt ${version} telepítése`);
      const jar = join(dir, 'quilt-installer.jar');
      await download(
        `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${installer}/quilt-installer-${installer}.jar`,
        jar,
      );
      await runProcess(java, ['-jar', jar, 'install', 'server', mc, version, '--download-server', '--install-dir=.'], dir, ctx);
      await rm(jar, { force: true });
      return { kind: 'jar', jar: 'quilt-server-launch.jar' };
    }

    case 'forge':
    case 'neoforge': {
      if (!loaderVersion) throw new Error(`Hiányzik a ${loader} verziója.`);
      ctx.stage(`${loader === 'forge' ? 'Forge' : 'NeoForge'} ${loaderVersion} telepítése (ez eltarthat pár percig)`);
      const jar = join(dir, `${loader}-installer.jar`);
      await tryDownload(installerUrls(loader, mc, loaderVersion), jar);
      await runProcess(java, ['-jar', jar, '--installServer'], dir, ctx);
      await rm(jar, { force: true });
      await rm(`${jar}.log`, { force: true });
      return detectForgeLaunch(dir, loaderVersion);
    }
  }
}

function installerUrls(loader: 'forge' | 'neoforge', mc: string, v: string) {
  if (loader === 'neoforge') {
    // NeoForge for 1.20.1 still used the old "forge" artifact and MC-prefixed versions.
    if (v.startsWith('1.20.1')) {
      const full = v.startsWith('1.20.1-') ? v : `1.20.1-${v}`;
      return [`https://maven.neoforged.net/releases/net/neoforged/forge/${full}/forge-${full}-installer.jar`];
    }
    return [`https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`];
  }
  const base = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
  const full = `${mc}-${v}`;
  // Some older Forge builds carry the MC version as a suffix, e.g. 1.7.10-10.13.4.1614-1.7.10.
  return [`${base}/${full}/forge-${full}-installer.jar`, `${base}/${full}-${mc}/forge-${full}-${mc}-installer.jar`];
}

/** Modern Forge/NeoForge launch through an args file; older Forge ships a runnable jar. */
async function detectForgeLaunch(dir: string, version: string): Promise<Launch> {
  const argsName = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  const roots = ['libraries/net/minecraftforge/forge', 'libraries/net/neoforged/neoforge', 'libraries/net/neoforged/forge'];
  const found: string[] = [];
  for (const root of roots) {
    const abs = join(dir, root);
    if (!existsSync(abs)) continue;
    for (const sub of await readdir(abs)) {
      const file = join(abs, sub, argsName);
      if (existsSync(file)) found.push(file);
    }
  }
  const args = found.find((f) => f.includes(version)) ?? found[0];
  if (args) return { kind: 'argsfile', file: relative(dir, args).replaceAll('\\', '/') };

  const jars = (await readdir(dir)).filter((f) => /^(neo)?forge-.*\.jar$/.test(f) && !f.includes('installer'));
  const jar = jars.find((f) => f.includes('universal')) ?? jars[0];
  if (jar) return { kind: 'jar', jar };
  throw new Error('A Forge telepítő lefutott, de nem található indítható szerver.');
}
