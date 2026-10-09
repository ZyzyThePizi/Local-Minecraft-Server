import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { checkPassword, issueToken, loginRetryAfter, recordLoginFailure, recordLoginSuccess, verifyToken } from './auth.ts';
import { config, HttpError, reloadEnv } from './config.ts';
import { recommendedMemory, startInstall, totalMemoryMb, type InstallRequest } from './install.ts';
import { getJob, latestJob, runningJob } from './jobs.ts';
import { readProperties, writeProperties } from './properties.ts';
import * as curseforge from './providers/curseforge.ts';
import * as modrinth from './providers/modrinth.ts';
import * as vanilla from './providers/vanilla.ts';
import { server } from './server.ts';
import {
  deleteInstance,
  getInstance,
  getSettings,
  isValidInstanceId,
  listInstances,
  saveInstance,
  serverDir,
  updateSettings,
  type Instance,
} from './store.ts';

export const VERSION = '1.0.0';

const bad = (message: string) => new HttpError(400, 'BAD_REQUEST', message);

async function body<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw bad('Hibás JSON törzs.');
  }
}

// Behind Tailscale Funnel every request arrives from loopback; the proxy appends the real client to
// X-Forwarded-For. Take the last entry: earlier ones are whatever the client chose to send.
const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'local';

async function activeInstance() {
  const settings = await getSettings();
  const inst = await getInstance(settings.activeInstanceId);
  return { settings, inst };
}

async function requireActiveInstance() {
  const { inst } = await activeInstance();
  if (!inst) throw new HttpError(409, 'NO_INSTANCE', 'Még nincs telepített szerver. Válassz egy modpacket vagy vanilla verziót.');
  return inst;
}

const instanceSummary = (i: Instance) => ({
  id: i.id,
  name: i.name,
  source: i.source,
  versionName: i.versionName,
  mcVersion: i.mcVersion,
  loader: i.loader,
  loaderVersion: i.loaderVersion,
  iconUrl: i.iconUrl,
  websiteUrl: i.websiteUrl,
  memoryMb: i.memoryMb,
  jvmArgs: i.jvmArgs ?? '',
  javaMajor: i.javaMajor,
  createdAt: i.createdAt,
});

export const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }),
);

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
  console.error(err);
  return c.json({ error: { code: 'INTERNAL', message: err.message || 'Belső hiba.' } }, 500);
});

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Nincs ilyen végpont.' } }, 404));

// ---------- public ----------

app.get('/api/health', (c) => c.json({ ok: true, name: config.panelName, version: VERSION }));

app.get('/api/status', async (c) => {
  const { settings, inst } = await activeInstance();
  const props = inst ? await readProperties(join(serverDir(inst.id), 'server.properties')) : {};
  return c.json({
    name: config.panelName,
    state: server.state,
    players: server.players.size,
    maxPlayers: Number(props['max-players'] ?? 20),
    motd: props.motd ?? null,
    gameAddress: settings.gameAddress || null,
    instance: inst
      ? { name: inst.name, versionName: inst.versionName, mcVersion: inst.mcVersion, loader: inst.loader, iconUrl: inst.iconUrl, websiteUrl: inst.websiteUrl }
      : null,
  });
});

app.post('/api/auth/login', async (c) => {
  const ip = clientIp(c);
  const wait = loginRetryAfter(ip);
  if (wait) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Túl sok sikertelen próbálkozás. Próbáld újra ${Math.ceil(wait / 60)} perc múlva.`);
  const { password } = await body<{ password?: unknown }>(c);
  reloadEnv(); // a password just edited in .env works right away
  if (typeof password !== 'string' || !checkPassword(password.trim())) {
    recordLoginFailure(ip);
    throw new HttpError(401, 'BAD_PASSWORD', 'Hibás jelszó.');
  }
  recordLoginSuccess(ip);
  return c.json(issueToken());
});

// ---------- admin ----------

app.use('/api/admin/*', async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!verifyToken(token)) throw new HttpError(401, 'UNAUTHORIZED', 'Lejárt vagy érvénytelen belépés.');
  await next();
});

app.get('/api/admin/overview', async (c) => {
  const { settings, inst } = await activeInstance();
  return c.json({
    server: {
      state: server.state,
      players: [...server.players],
      startedAt: server.startedAt,
      instanceId: server.instanceId,
    },
    instance: inst ? instanceSummary(inst) : null,
    settings,
    system: {
      totalMemoryMb: totalMemoryMb(),
      recommendedMemoryMb: recommendedMemory(true),
      platform: process.platform,
    },
    curseforgeConfigured: Boolean(config.curseforgeApiKey),
    installing: runningJob('install') !== null,
  });
});

app.post('/api/admin/server/start', async (c) => {
  await server.start(await requireActiveInstance());
  return c.json({ state: server.state });
});

app.post('/api/admin/server/stop', async (c) => {
  const { force } = await body<{ force?: boolean }>(c).catch(() => ({ force: false }));
  void server.stop(Boolean(force));
  return c.json({ state: server.state });
});

app.post('/api/admin/server/restart', async (c) => {
  const inst = await requireActiveInstance();
  if (!(await getSettings()).eulaAccepted) throw new HttpError(409, 'EULA_REQUIRED', 'Indítás előtt el kell fogadni a Minecraft EULA-t.');
  void server
    .stop()
    .then(() => server.start(inst))
    .catch((err: unknown) => server.panel(`Újraindítás sikertelen: ${err instanceof Error ? err.message : err}`));
  return c.json({ state: server.state });
});

app.post('/api/admin/server/command', async (c) => {
  const { command } = await body<{ command?: unknown }>(c);
  if (typeof command !== 'string' || !command.trim() || command.length > 1000 || /[\r\n]/.test(command)) {
    throw bad('Érvénytelen parancs.');
  }
  server.send(command.trim().replace(/^\//, ''));
  return c.json({ ok: true });
});

app.get('/api/admin/server/logs', (c) => c.json(server.logsSince(Number(c.req.query('since') ?? 0) || 0)));

app.get('/api/admin/properties', async (c) => {
  const inst = await requireActiveInstance();
  return c.json({ instanceId: inst.id, properties: await readProperties(join(serverDir(inst.id), 'server.properties')) });
});

app.put('/api/admin/properties', async (c) => {
  const inst = await requireActiveInstance();
  const { properties } = await body<{ properties?: Record<string, unknown> }>(c);
  if (!properties || typeof properties !== 'object') throw bad('Hiányzik a properties objektum.');
  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!/^[a-z0-9][a-z0-9.\-_]{0,63}$/i.test(key)) throw bad(`Érvénytelen kulcs: ${key}`);
    const str = String(value);
    if (/[\r\n]/.test(str) || str.length > 500) throw bad(`Érvénytelen érték: ${key}`);
    updates[key] = str;
  }
  const file = join(serverDir(inst.id), 'server.properties');
  await writeProperties(file, updates);
  return c.json({ properties: await readProperties(file), restartRequired: server.isActive() });
});

app.put('/api/admin/settings', async (c) => {
  const input = await body<{ eulaAccepted?: unknown; autoStart?: unknown; gameAddress?: unknown }>(c);
  const patch: Parameters<typeof updateSettings>[0] = {};
  if (typeof input.eulaAccepted === 'boolean') patch.eulaAccepted = input.eulaAccepted;
  if (typeof input.autoStart === 'boolean') patch.autoStart = input.autoStart;
  if (typeof input.gameAddress === 'string') {
    if (input.gameAddress.length > 200) throw bad('Túl hosszú cím.');
    patch.gameAddress = input.gameAddress.trim();
  }
  return c.json(await updateSettings(patch));
});

app.get('/api/admin/instances', async (c) => {
  const settings = await getSettings();
  return c.json({ instances: (await listInstances()).map(instanceSummary), activeInstanceId: settings.activeInstanceId });
});

async function instanceParam(c: Context) {
  const id = c.req.param('id') ?? '';
  const inst = isValidInstanceId(id) ? await getInstance(id) : null;
  if (!inst) throw new HttpError(404, 'NOT_FOUND', 'Nincs ilyen szerver.');
  return inst;
}

app.post('/api/admin/instances/:id/activate', async (c) => {
  const inst = await instanceParam(c);
  if (server.isActive() && server.instanceId !== inst.id) {
    throw new HttpError(409, 'SERVER_RUNNING', 'Előbb állítsd le a futó szervert.');
  }
  return c.json(await updateSettings({ activeInstanceId: inst.id }));
});

app.patch('/api/admin/instances/:id', async (c) => {
  const inst = await instanceParam(c);
  const input = await body<{ name?: unknown; memoryMb?: unknown; jvmArgs?: unknown }>(c);
  if (typeof input.name === 'string' && input.name.trim()) inst.name = input.name.trim().slice(0, 80);
  if (typeof input.memoryMb === 'number') {
    if (!Number.isInteger(input.memoryMb) || input.memoryMb < 512 || input.memoryMb > totalMemoryMb()) {
      throw bad(`A memória 512 és ${totalMemoryMb()} MB között lehet.`);
    }
    inst.memoryMb = input.memoryMb;
  }
  if (typeof input.jvmArgs === 'string') {
    if (input.jvmArgs.length > 1000 || /[\r\n]/.test(input.jvmArgs)) throw bad('Érvénytelen JVM argumentumok.');
    inst.jvmArgs = input.jvmArgs.trim();
  }
  await saveInstance(inst);
  return c.json({ instance: instanceSummary(inst), restartRequired: server.isActive() && server.instanceId === inst.id });
});

app.delete('/api/admin/instances/:id', async (c) => {
  const inst = await instanceParam(c);
  if (server.isActive() && server.instanceId === inst.id) throw new HttpError(409, 'SERVER_RUNNING', 'Előbb állítsd le ezt a szervert.');
  await deleteInstance(inst.id);
  const settings = await getSettings();
  if (settings.activeInstanceId === inst.id) {
    await updateSettings({ activeInstanceId: (await listInstances())[0]?.id ?? null });
  }
  return c.json({ ok: true });
});

const SOURCES = ['curseforge', 'modrinth', 'vanilla'] as const;
function sourceParam(c: Context) {
  const source = c.req.query('source');
  if (!SOURCES.includes(source as (typeof SOURCES)[number])) throw bad('Ismeretlen forrás.');
  return source as (typeof SOURCES)[number];
}

app.get('/api/admin/packs/search', async (c) => {
  const source = sourceParam(c);
  const q = (c.req.query('q') ?? '').slice(0, 100);
  const page = Math.max(0, Math.min(50, Number(c.req.query('page') ?? 0) || 0));
  if (source === 'vanilla') return c.json({ results: [] });
  const results = source === 'curseforge' ? await curseforge.search(q, page) : await modrinth.search(q, page);
  return c.json({ results });
});

app.get('/api/admin/packs/versions', async (c) => {
  const source = sourceParam(c);
  const id = c.req.query('id') ?? '';
  if (source !== 'vanilla' && !/^[\w-]{1,40}$/.test(id)) throw bad('Érvénytelen azonosító.');
  const versions =
    source === 'vanilla' ? await vanilla.versions() : source === 'curseforge' ? await curseforge.versions(id) : await modrinth.versions(id);
  return c.json({ versions });
});

app.post('/api/admin/packs/install', async (c) => {
  const input = await body<Partial<InstallRequest>>(c);
  if (!SOURCES.includes(input.source as (typeof SOURCES)[number])) throw bad('Ismeretlen forrás.');
  if (typeof input.versionId !== 'string' || !/^[\w.+-]{1,60}$/.test(input.versionId)) throw bad('Érvénytelen verzió.');
  if (input.projectId !== undefined && (typeof input.projectId !== 'string' || !/^[\w-]{1,40}$/.test(input.projectId))) {
    throw bad('Érvénytelen modpack azonosító.');
  }
  const job = startInstall({
    source: input.source!,
    projectId: input.projectId,
    versionId: input.versionId,
    name: typeof input.name === 'string' ? input.name.slice(0, 80) : undefined,
  });
  return c.json({ job });
});

app.get('/api/admin/jobs/latest/:kind', (c) => c.json({ job: latestJob(c.req.param('kind')) }));

app.get('/api/admin/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) throw new HttpError(404, 'NOT_FOUND', 'Nincs ilyen feladat.');
  return c.json({ job });
});
