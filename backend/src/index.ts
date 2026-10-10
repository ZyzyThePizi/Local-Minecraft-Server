import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, watchFile, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { app, runtime } from './app.ts';
import { audit } from './audit.ts';
import { config, envFile, MIN_PASSWORD_LENGTH, paths, reloadEnv, VERSION, writeEnvValue } from './config.ts';
import { exposeViaFunnel } from './funnel.ts';
import { initNode, nodeId, shortId } from './node.ts';
import { findFreePort, isPortFree } from './ports.ts';
import { REGISTRY_URL, startRegistry } from './registry.ts';
import { servers } from './servers.ts';
import { initSessions } from './sessions.ts';
import { initSettings, listInstances, removeIncompleteInstances, settings, updateSettings } from './store.ts';

const HUB = 'https://zyzythepizi.github.io/Local-Minecraft-Server/';

// First run without a password: generate one and save it to .env, so the panel is never left open.
if (!config.adminPassword) {
  config.adminPassword = randomBytes(12).toString('base64url');
  writeEnvValue('ADMIN_PASSWORD', config.adminPassword);
  console.log('\n  Nem volt beállítva admin jelszó, generáltam egyet (backend/.env):');
  console.log(`\n      ${config.adminPassword}\n`);
}
if (config.adminPassword.length < MIN_PASSWORD_LENGTH) {
  console.error(`Az ADMIN_PASSWORD legalább ${MIN_PASSWORD_LENGTH} karakter legyen (backend/.env).`);
  process.exit(1);
}

// One backend per data folder. A second copy must stop before touching tmp/ or instances/.
await mkdir(config.dataDir, { recursive: true });
if (existsSync(paths.lock)) {
  const pid = Number(readFileSync(paths.lock, 'utf8'));
  let alive = false;
  try {
    if (pid && pid !== process.pid) alive = process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (alive) {
    console.error(`\n  Ebből a mappából már fut egy backend (folyamat: ${pid}). Nem kell újra elindítani.`);
    console.error('  Másik backendet egy másik mappából (külön másolatból) indíthatsz.');
    process.exit(1);
  }
}
writeFileSync(paths.lock, String(process.pid));
const releaseLock = () => rmSync(paths.lock, { force: true });
process.on('exit', releaseLock);

initNode();
const { migrated } = await initSettings();
await initSessions();
if (migrated) console.log('  A régi beállításokat átköltöztettem a data/settings.json-ba. A .env-ben már csak a jelszó és a CurseForge kulcs kell.');

await mkdir(paths.instances, { recursive: true });
await rm(paths.tmp, { recursive: true, force: true }); // leftovers of an interrupted install
await mkdir(paths.tmp, { recursive: true });
for (const id of await removeIncompleteInstances()) console.log(`  Félbeszakadt telepítés maradéka törölve: ${id}`);

// Another backend (from another folder) may already listen on the saved port: move to a free one.
let port = settings().apiPort;
if (!(await isPortFree(port, '127.0.0.1'))) {
  const next = await findFreePort(port + 1, new Set(), '127.0.0.1');
  console.log(`  A ${port}-es portot már más használja, ez a backend a ${next}-es portra költözik.`);
  port = next;
  await updateSettings({ apiPort: port });
}

// Tailscale Funnel may forward a sub-path (when another backend owns the root); strip it either way.
const fetchWithPrefix = (req: Request) => {
  const prefix = settings().funnel.path;
  if (prefix && prefix !== '/') {
    const url = new URL(req.url);
    if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
      url.pathname = url.pathname.slice(prefix.length) || '/';
      return app.fetch(new Request(url, req));
    }
  }
  return app.fetch(req);
};

const httpServer = serve({ fetch: fetchWithPrefix, port, hostname: '127.0.0.1' }, async () => {
  console.log(`  ✔ A backend fut: http://127.0.0.1:${port}  (gép: ${settings().panelName}, v${VERSION})`);
  console.log(`  Gépazonosító: ${shortId()}  (${nodeId})`);
  console.log(`  Adatmappa: ${config.dataDir}`);
  if (!config.curseforgeApiKey) console.log('  CurseForge API kulcs nincs megadva, ezért csak a Modrinth és a Vanilla keresés működik.');

  if (process.env.LMS_NO_FUNNEL !== '1') {
    const funnel = await exposeViaFunnel(port);
    runtime.publicUrl = funnel.url;
    runtime.funnelNote = funnel.note ?? null;
    if (funnel.note) console.log(`  [FIGYELEM] ${funnel.note}`);
  }
  const publicUrl = settings().publicUrl || runtime.publicUrl;
  if (publicUrl) {
    console.log(`\n  Nyilvános cím: ${publicUrl}`);
    console.log(`  Hozzáadás a panelhez: ${HUB}#add=${encodeURIComponent(publicUrl)}`);
  } else {
    console.log('\n  Nincs nyilvános cím: a panel csak ezen a gépen éri el (http://127.0.0.1). Tailscale-lel automatikus.');
  }
  console.log('  A jelszót és a CurseForge kulcsot a backend/.env-ben módosíthatod, minden mást a panelen.');
  if (REGISTRY_URL) {
    console.log('  Hálózat: ez a gép jelentkezik a hálózat nyilvántartásánál (gépnév, verzió, a szerverek neve, állapota és játékosszáma).');
    console.log('  Jelszó, cím és játékosnév nem megy át.');
  }
  console.log('');
  void autoStart();
});

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`\n  A ${port}-es portot közben egy másik program foglalta el. Indítsd újra a backendet.`);
  process.exit(1);
});

// Pick up a new password / CurseForge key saved into .env while running.
watchFile(envFile, { interval: 2000 }, () => {
  const changed = reloadEnv();
  if (changed.length) {
    console.log(`  .env frissítve: ${changed.join(', ')}`);
    audit(null, '.env frissítve', changed.join(', '));
  }
});

async function autoStart() {
  for (const inst of await listInstances()) {
    if (!inst.autoStart) continue;
    if (!settings().eulaAccepted) {
      console.log(`  Automatikus indítás kihagyva (${inst.name}): az EULA még nincs elfogadva.`);
      continue;
    }
    console.log(`  Automatikus indítás: ${inst.name}`);
    try {
      await servers.get(inst.id).start(inst);
    } catch (err) {
      console.log(`  Nem indult el (${inst.name}): ${(err as Error).message}`);
    }
  }
  startRegistry();
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) process.exit(1); // second Ctrl+C: leave immediately
  shuttingDown = true;
  const active = servers.active();
  if (active.length) {
    console.log(`${active.length} Minecraft szerver leállítása… (még egy Ctrl+C a kényszerített kilépéshez)`);
    await Promise.all(active.map((s) => s.stop()));
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.platform === 'win32') process.on('SIGBREAK', shutdown);
