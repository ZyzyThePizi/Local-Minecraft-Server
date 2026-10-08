import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { extract as extractTar } from 'tar';
import { paths } from './config.ts';
import { download, formatBytes } from './download.ts';
import { extractZip } from './unzip.ts';

/** Adoptium ships LTS builds; map Mojang's required major to the nearest one that runs it. */
export function javaMajorFor(required: number) {
  if (required <= 8) return 8;
  if (required <= 17) return 17;
  if (required <= 21) return 21;
  return required;
}

const exe = process.platform === 'win32' ? 'java.exe' : 'java';
const inflight = new Map<string, Promise<string>>();

async function findJava(dir: string, depth = 0): Promise<string | null> {
  if (!existsSync(dir) || depth > 4) return null;
  const candidate = join(dir, 'bin', exe);
  if (existsSync(candidate)) return candidate;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const found = await findJava(join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Returns the path of a Java executable for `major`, downloading a Temurin JRE on first use. */
export function ensureJava(major: number, log: (line: string) => void = () => {}): Promise<string> {
  const key = String(major);
  let p = inflight.get(key);
  if (!p) {
    p = installJava(major, log).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

async function installJava(major: number, log: (line: string) => void) {
  const dir = join(paths.java, String(major));
  const existing = await findJava(dir);
  if (existing) return existing;

  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
  const archive = join(paths.java, `${major}.${os === 'windows' ? 'zip' : 'tar.gz'}`);

  log(`Java ${major} letöltése (Eclipse Temurin)…`);
  let lastLogged = 0;
  await download(url, archive, {
    onProgress(received, total) {
      if (received - lastLogged > 20 << 20) {
        lastLogged = received;
        log(`  ${formatBytes(received)}${total ? ` / ${formatBytes(total)}` : ''}`);
      }
    },
  });

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  if (archive.endsWith('.zip')) await extractZip(archive, dir);
  else await extractTar({ file: archive, cwd: dir });
  await rm(archive, { force: true });

  const java = await findJava(dir);
  if (!java) throw new Error(`A Java ${major} kicsomagolása után nem található a java futtatható fájl.`);
  log(`Java ${major} kész.`);
  return java;
}
