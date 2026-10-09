import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, watchFile } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { app, VERSION } from './app.ts';
import { initAuth } from './auth.ts';
import { config, envFile, MIN_PASSWORD_LENGTH, paths, reloadEnv } from './config.ts';
import { server } from './server.ts';
import { getInstance, getSettings, removeIncompleteInstances } from './store.ts';

// First run without a password: generate one and save it to .env, so the panel is never left open.
if (!config.adminPassword) {
  config.adminPassword = randomBytes(12).toString('base64url');
  appendFileSync(envFile, `${existsSync(envFile) ? '\n' : ''}ADMIN_PASSWORD=${config.adminPassword}\n`);
  console.log('\n  Nem volt beállítva admin jelszó, generáltam egyet (backend/.env):');
  console.log(`\n      ${config.adminPassword}\n`);
}
if (config.adminPassword.length < MIN_PASSWORD_LENGTH) {
  console.error(`Az ADMIN_PASSWORD legalább ${MIN_PASSWORD_LENGTH} karakter legyen (backend/.env).`);
  process.exit(1);
}

// A second copy must stop before touching tmp/ or instances/: it would wipe the running copy's install.
const alreadyRunning = await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);
if (alreadyRunning) {
  console.error(`\n  A backend már fut egy másik ablakban (${config.port}-es port). Nem kell újra elindítani.`);
  process.exit(1);
}

initAuth();
await mkdir(paths.instances, { recursive: true });
await rm(paths.tmp, { recursive: true, force: true }); // leftovers of an interrupted install
await mkdir(paths.tmp, { recursive: true });
for (const id of await removeIncompleteInstances()) console.log(`  Félbeszakadt telepítés maradéka törölve: ${id}`);

const httpServer = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, ({ port }) => {
  console.log(`  ✔ A backend fut: http://${config.host}:${port}  (gép: ${config.panelName}, v${VERSION})`);
  console.log(`  Adatmappa: ${config.dataDir}`);
  if (!config.curseforgeApiKey) console.log('  CurseForge API kulcs nincs megadva, ezért csak a Modrinth és a Vanilla keresés működik.');
  console.log('  A jelszót és a CurseForge kulcsot a backend/.env fájlban módosíthatod, újraindítás nélkül is életbe lép.\n');
});
httpServer.on('error', async (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;
  const running = await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
  console.error(
    running
      ? `\n  A backend már fut egy másik ablakban (${config.port}-es port). Nem kell újra elindítani.`
      : `\n  A ${config.port}-es portot egy másik program foglalja. Állítsd le, vagy írj másik PORT-ot a backend/.env-be.`,
  );
  process.exit(1);
});

// Pick up a new password / CurseForge key saved into .env while running.
watchFile(envFile, { interval: 2000 }, () => {
  const changed = reloadEnv();
  if (changed.length) console.log(`  .env frissítve: ${changed.join(', ')}`);
});

const settings = await getSettings();
if (settings.autoStart && settings.eulaAccepted) {
  const inst = await getInstance(settings.activeInstanceId);
  if (inst) {
    console.log(`Automatikus indítás: ${inst.name}`);
    await server.start(inst);
  }
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) process.exit(1); // second Ctrl+C: leave immediately
  shuttingDown = true;
  if (server.isActive()) {
    console.log('A Minecraft szerver leállítása… (még egy Ctrl+C a kényszerített kilépéshez)');
    await server.stop();
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.platform === 'win32') process.on('SIGBREAK', shutdown);
