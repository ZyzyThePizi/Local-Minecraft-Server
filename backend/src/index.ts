import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { app, VERSION } from './app.ts';
import { initAuth } from './auth.ts';
import { config, envFile, paths } from './config.ts';
import { server } from './server.ts';
import { getInstance, getSettings } from './store.ts';

// First run without a password: generate one and save it to .env, so the panel is never left open.
if (!config.adminPassword) {
  config.adminPassword = randomBytes(12).toString('base64url');
  appendFileSync(envFile, `${existsSync(envFile) ? '\n' : ''}ADMIN_PASSWORD=${config.adminPassword}\n`);
  console.log('\n  Nem volt beállítva admin jelszó, generáltam egyet (backend/.env):');
  console.log(`\n      ${config.adminPassword}\n`);
}
if (config.adminPassword.length < 10) {
  console.error('Az ADMIN_PASSWORD legalább 10 karakter legyen (backend/.env).');
  process.exit(1);
}

initAuth();
await mkdir(paths.instances, { recursive: true });
await rm(paths.tmp, { recursive: true, force: true }); // leftovers of an interrupted install
await mkdir(paths.tmp, { recursive: true });

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, ({ port }) => {
  console.log(`Minecraft panel backend v${VERSION} – http://${config.host}:${port}  (${config.panelName})`);
  console.log(`Adatmappa: ${config.dataDir}`);
  if (!config.curseforgeApiKey) console.log('CurseForge API kulcs nincs megadva – csak a Modrinth és a Vanilla keresés működik.');
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
