import { join } from 'node:path';
import { cpus, totalmem } from 'node:os';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { audit, readAudit } from './audit.ts';
import { API_VERSION, config, HttpError, MIN_PASSWORD_LENGTH, reloadEnv, VERSION, writeEnvValue } from './config.ts';
import { recommendedMemory, startInstall, type InstallRequest } from './install.ts';
import { getJob, latestJob, runningJob } from './jobs.ts';
import { helloMessage, nodeId, publicKey, shortId, signBytes } from './node.ts';
import { isUuid, listPlayers, resetPlayer } from './players.ts';
import { readProperties, writeProperties } from './properties.ts';
import * as curseforge from './providers/curseforge.ts';
import * as modrinth from './providers/modrinth.ts';
import * as vanilla from './providers/vanilla.ts';
import { registryState, startRegistry } from './registry.ts';
import { ramBudgetMb, servers } from './servers.ts';
import {
  actorOf,
  checkPassword,
  createInvite,
  listInvites,
  listSessions,
  loginWithPassword,
  redeemInvite,
  refresh,
  revokeAllSessions,
  revokeInvite,
  revokeSession,
  verifyAccess,
  viaLabel,
  type Session,
} from './sessions.ts';
import { DEFAULT_REGISTRY_URL, deleteInstance, getInstance, isValidInstanceId, listInstances, readJson, saveInstance, serverDir, settings, updateSettings, type Instance, type Settings } from './store.ts';

/** Filled in by index.ts once the server listens. */
export const runtime = { publicUrl: null as string | null, funnelNote: null as string | null };

type Env = { Variables: { session: Session } };

const bad = (message: string) => new HttpError(400, 'BAD_REQUEST', message);
const totalMemoryMb = () => Math.floor(totalmem() / 1048576);

async function body<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw bad('Hibás JSON törzs.');
  }
}

// Behind Tailscale Funnel every request arrives from loopback; the proxy appends the real client to
// X-Forwarded-For. Take the last entry: earlier ones are whatever the client chose to send.
const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'helyi';
const actor = (c: Context<Env>) => actorOf(c.get('session') ?? null, clientIp(c));

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function serverProps(id: string) {
  return readProperties(join(serverDir(id), 'server.properties'));
}

/** Everything the panel shows about one installed server, including its live process state. */
async function serverSummary(i: Instance) {
  const proc = servers.peek(i.id);
  const props = await serverProps(i.id);
  return {
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
    autoStart: Boolean(i.autoStart),
    gameAddress: i.gameAddress ?? '',
    port: Number(props['server-port']) || 25565,
    maxPlayers: Number(props['max-players'] ?? 20),
    motd: props.motd ?? null,
    state: proc?.state ?? 'stopped',
    players: proc ? [...proc.players] : [],
    startedAt: proc?.startedAt ?? null,
  };
}

/** What anyone may see without a password (when the owner allows it): no ports, paths or settings. */
async function publicSummary(i: Instance) {
  const s = await serverSummary(i);
  return {
    id: s.id,
    name: s.name,
    versionName: s.versionName,
    mcVersion: s.mcVersion,
    loader: s.loader,
    iconUrl: s.iconUrl,
    websiteUrl: s.websiteUrl,
    state: s.state,
    players: s.players.length,
    maxPlayers: s.maxPlayers,
    motd: s.motd,
    gameAddress: s.gameAddress || null,
  };
}

export const app = new Hono<Env>();

app.use(
  '/api/*',
  cors({
    origin: (origin) => (settings().allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }),
);
app.use('/api/*', bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: { code: 'TOO_LARGE', message: 'Túl nagy kérés.' } }, 413) }));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
  console.error(err);
  return c.json({ error: { code: 'INTERNAL', message: err.message || 'Belső hiba.' } }, 500);
});

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Nincs ilyen végpont.' } }, 404));

// ---------- public ----------

app.get('/api/health', (c) => c.json({ ok: true, name: settings().panelName, version: VERSION, apiVersion: API_VERSION, nodeId }));

// The hub pins the public key on first contact and checks this signature on every connect.
app.get('/api/v1/hello', (c) => {
  const nonce = c.req.query('nonce') ?? '';
  if (!/^[\w-]{16,128}$/.test(nonce)) throw bad('Hiányzó vagy hibás nonce.');
  return c.json({
    nodeId,
    publicKey: publicKey(),
    signature: signBytes(helloMessage(nonce, nodeId)),
    name: settings().panelName,
    version: VERSION,
    apiVersion: API_VERSION,
    publicStatus: settings().publicStatus,
  });
});

app.get('/api/v1/status', async (c) => {
  if (!settings().publicStatus) throw new HttpError(403, 'PRIVATE', 'Ennek a gépnek az állapota csak belépés után látható.');
  return c.json({ name: settings().panelName, servers: await Promise.all((await listInstances()).map(publicSummary)) });
});

app.post('/api/v1/session', async (c) => {
  const input = await body<{ password?: unknown; invite?: unknown; device?: unknown }>(c);
  const device = str(input.device, 60);
  const ip = clientIp(c);
  if (typeof input.invite === 'string' && input.invite) {
    try {
      const tokens = await redeemInvite(input.invite.trim(), device, ip);
      const via = listSessions().find((s) => s.id === tokens.sessionId)?.via;
      audit({ sessionId: tokens.sessionId, via: via ? viaLabel(via) : 'meghívó', device, ip }, 'Belépés meghívóval');
      return c.json(tokens);
    } catch (err) {
      audit(actorOf(null, ip), 'Sikertelen belépés (meghívó)', device);
      throw err;
    }
  }
  if (typeof input.password !== 'string' || !input.password) throw bad('Add meg a jelszót vagy a meghívót.');
  reloadEnv(); // a password just edited in .env works right away
  try {
    const tokens = await loginWithPassword(input.password.trim(), device, ip);
    audit({ sessionId: tokens.sessionId, via: 'jelszó', device, ip }, 'Belépés jelszóval');
    return c.json(tokens);
  } catch (err) {
    audit(actorOf(null, ip), 'Sikertelen belépés (hibás jelszó)', device);
    throw err;
  }
});

app.post('/api/v1/session/refresh', async (c) => {
  const { refreshToken } = await body<{ refreshToken?: unknown }>(c);
  if (typeof refreshToken !== 'string') throw bad('Hiányzik a refreshToken.');
  return c.json(await refresh(refreshToken, clientIp(c)));
});

// ---------- signed in ----------

const OPEN = new Set(['/api/v1/hello', '/api/v1/status', '/api/v1/session', '/api/v1/session/refresh']);
app.use('/api/v1/*', async (c, next) => {
  if (OPEN.has(c.req.path) && !(c.req.path === '/api/v1/session' && c.req.method === 'DELETE')) return next();
  const header = c.req.header('authorization') ?? '';
  const session = verifyAccess(header.startsWith('Bearer ') ? header.slice(7) : undefined);
  if (!session) throw new HttpError(401, 'UNAUTHORIZED', 'Lejárt vagy érvénytelen belépés.');
  c.set('session', session);
  await next();
});

app.delete('/api/v1/session', async (c) => {
  await revokeSession(c.get('session').id);
  audit(actor(c), 'Kilépés');
  return c.json({ ok: true });
});

// ---- this machine ----

app.get('/api/v1/node', async (c) => {
  const s = c.get('session');
  return c.json({
    nodeId,
    shortId: shortId(),
    publicKey: publicKey(),
    name: settings().panelName,
    version: VERSION,
    apiVersion: API_VERSION,
    publicUrl: settings().publicUrl || runtime.publicUrl,
    funnelNote: runtime.funnelNote,
    settings: settings(),
    system: { totalMemoryMb: totalMemoryMb(), recommendedMemoryMb: recommendedMemory(true), platform: process.platform, cpus: cpus().length },
    ram: { budgetMb: ramBudgetMb(), reservedMb: servers.reservedMb() },
    curseforgeConfigured: Boolean(config.curseforgeApiKey),
    installing: runningJob('install') !== null,
    registry: { ...registryState, defaultUrl: DEFAULT_REGISTRY_URL },
    session: { id: s.id, via: s.via, device: s.device },
  });
});

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

app.patch('/api/v1/node', async (c) => {
  const input = await body<Partial<Record<keyof Settings, unknown>>>(c);
  const patch: Partial<Settings> = {};
  const changed: string[] = [];
  if (input.panelName !== undefined) {
    const name = str(input.panelName, 40);
    if (!name) throw bad('A gép neve nem lehet üres.');
    patch.panelName = name;
    changed.push(`név: ${name}`);
  }
  if (input.eulaAccepted !== undefined) {
    if (typeof input.eulaAccepted !== 'boolean') throw bad('Érvénytelen EULA érték.');
    patch.eulaAccepted = input.eulaAccepted;
    changed.push(`EULA: ${input.eulaAccepted ? 'elfogadva' : 'visszavonva'}`);
  }
  if (input.maxRamMb !== undefined) {
    const v = input.maxRamMb;
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1024 || v > totalMemoryMb())) {
      throw bad(`A memóriakeret 1024 és ${totalMemoryMb()} MB között lehet (vagy automatikus).`);
    }
    patch.maxRamMb = v as number | null;
    changed.push(`RAM-keret: ${v === null ? 'automatikus' : `${v} MB`}`);
  }
  if (input.publicStatus !== undefined) {
    if (typeof input.publicStatus !== 'boolean') throw bad('Érvénytelen érték.');
    patch.publicStatus = input.publicStatus;
    changed.push(`nyilvános állapot: ${input.publicStatus ? 'be' : 'ki'}`);
  }
  if (input.publicUrl !== undefined) {
    const url = str(input.publicUrl, 200).replace(/\/$/, '');
    if (url && !/^https:\/\/[^\s]+$/.test(url)) throw bad('A nyilvános cím https:// címmel kezdődjön.');
    patch.publicUrl = url;
    changed.push(`nyilvános cím: ${url || 'automatikus'}`);
  }
  if (input.allowedOrigins !== undefined) {
    const list = Array.isArray(input.allowedOrigins) ? input.allowedOrigins.map((o) => str(o, 120).replace(/\/$/, '')).filter(Boolean) : null;
    if (!list || !list.length || list.length > 12 || list.some((o) => !ORIGIN.test(o))) throw bad('Az engedélyezett oldalak listája hibás (pl. https://zyzythepizi.github.io).');
    patch.allowedOrigins = [...new Set(list)];
    changed.push('engedélyezett oldalak');
  }
  if (input.registry !== undefined) {
    const r = input.registry as { enabled?: unknown; url?: unknown };
    const url = str(r?.url, 200).replace(/\/$/, '');
    const okUrl = /^https:\/\/\S+$/.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/\S*)?$/.test(url);
    if (typeof r?.enabled !== 'boolean' || (url && !okUrl)) throw bad('Hibás hálózati beállítás (https:// cím kell).');
    // An empty address means the network's default registry.
    patch.registry = { enabled: r.enabled, url };
    changed.push(`hálózat: ${r.enabled ? 'be' : 'ki'}`);
  }
  const next = await updateSettings(patch);
  if (patch.registry) startRegistry();
  if (changed.length) audit(actor(c), 'Gépbeállítás módosítva', changed.join(', '));
  return c.json({ settings: next });
});

app.post('/api/v1/node/password', async (c) => {
  const input = await body<{ current?: unknown; next?: unknown; device?: unknown }>(c);
  if (typeof input.current !== 'string' || !checkPassword(input.current.trim())) {
    audit(actor(c), 'Sikertelen jelszócsere (hibás jelenlegi jelszó)');
    throw new HttpError(403, 'BAD_PASSWORD', 'A jelenlegi jelszó hibás.');
  }
  const next = typeof input.next === 'string' ? input.next.trim() : '';
  if (next.length < MIN_PASSWORD_LENGTH) throw bad(`Az új jelszó legalább ${MIN_PASSWORD_LENGTH} karakter legyen.`);
  if (/[\r\n]/.test(next)) throw bad('A jelszó nem tartalmazhat sortörést.');
  writeEnvValue('ADMIN_PASSWORD', next);
  config.adminPassword = next;
  const ended = await revokeAllSessions();
  audit(actor(c), 'Jelszó megváltoztatva', `${ended} munkamenet lezárva`);
  // The caller stays signed in with a fresh session.
  return c.json(await loginWithPassword(next, str(input.device, 60) || c.get('session').device, clientIp(c)));
});

app.get('/api/v1/sessions', (c) => c.json({ sessions: listSessions(), currentId: c.get('session').id }));

app.delete('/api/v1/sessions/:id', async (c) => {
  const sid = c.req.param('id') ?? '';
  const target = listSessions().find((s) => s.id === sid);
  if (!target || !(await revokeSession(sid))) throw new HttpError(404, 'NOT_FOUND', 'Nincs ilyen munkamenet.');
  audit(actor(c), 'Munkamenet lezárva', target.device);
  return c.json({ ok: true });
});

app.post('/api/v1/sessions/revoke-all', async (c) => {
  const { includeSelf } = await body<{ includeSelf?: unknown }>(c).catch(() => ({ includeSelf: false }));
  const count = await revokeAllSessions(includeSelf === true ? undefined : c.get('session').id);
  audit(actor(c), 'Kijelentkeztetés mindenhol', `${count} munkamenet`);
  return c.json({ ended: count });
});

app.get('/api/v1/invites', (c) => c.json({ invites: listInvites() }));

app.post('/api/v1/invites', async (c) => {
  const input = await body<{ label?: unknown; expiresInHours?: unknown; maxUses?: unknown }>(c);
  const hours = input.expiresInHours;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 1 || hours > 24 * 90) throw bad('A lejárat 1 óra és 90 nap között lehet.');
  const maxUses = input.maxUses === null ? null : input.maxUses;
  if (maxUses !== null && (typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100)) {
    throw bad('A felhasználások száma 1 és 100 között lehet (vagy korlátlan).');
  }
  const label = str(input.label, 60);
  const created = await createInvite({ label, expiresInHours: hours, maxUses }, `${actor(c).via} · ${actor(c).device}`);
  audit(actor(c), 'Meghívó létrehozva', `${created.invite.label} (${hours} óra, ${maxUses ?? 'korlátlan'} használat)`);
  return c.json(created);
});

app.delete('/api/v1/invites/:id', async (c) => {
  const res = await revokeInvite(c.req.param('id') ?? '');
  if (!res) throw new HttpError(404, 'NOT_FOUND', 'Nincs ilyen meghívó.');
  audit(actor(c), 'Meghívó visszavonva', `${res.endedSessions} munkamenet lezárva`);
  return c.json(res);
});

app.get('/api/v1/audit', async (c) => {
  const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') ?? 100) || 100));
  return c.json({ entries: await readAudit(limit) });
});

// ---- servers (installed modpacks / vanilla versions) ----

app.get('/api/v1/servers', async (c) => c.json({ servers: await Promise.all((await listInstances()).map(serverSummary)) }));

async function instanceParam(c: Context) {
  const id = c.req.param('id') ?? '';
  const inst = isValidInstanceId(id) ? await getInstance(id) : null;
  if (!inst) throw new HttpError(404, 'NOT_FOUND', 'Nincs ilyen szerver.');
  return inst;
}

app.patch('/api/v1/servers/:id', async (c) => {
  const inst = await instanceParam(c);
  const input = await body<{ name?: unknown; memoryMb?: unknown; jvmArgs?: unknown; autoStart?: unknown; gameAddress?: unknown }>(c);
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
  if (typeof input.autoStart === 'boolean') inst.autoStart = input.autoStart;
  if (typeof input.gameAddress === 'string') {
    if (input.gameAddress.length > 200 || /\s/.test(input.gameAddress.trim())) throw bad('Érvénytelen csatlakozási cím.');
    inst.gameAddress = input.gameAddress.trim();
  }
  await saveInstance(inst);
  audit(actor(c), 'Szerver módosítva', `${inst.name}: ${Object.keys(input).join(', ')}`);
  return c.json({ server: await serverSummary(inst), restartRequired: servers.peek(inst.id)?.isActive() ?? false });
});

app.delete('/api/v1/servers/:id', async (c) => {
  const inst = await instanceParam(c);
  if (servers.peek(inst.id)?.isActive()) throw new HttpError(409, 'SERVER_RUNNING', 'Előbb állítsd le ezt a szervert.');
  await deleteInstance(inst.id);
  servers.forget(inst.id);
  audit(actor(c), 'Szerver törölve', inst.name);
  return c.json({ ok: true });
});

app.post('/api/v1/servers/:id/start', async (c) => {
  const inst = await instanceParam(c);
  await servers.get(inst.id).start(inst);
  audit(actor(c), 'Szerver indítása', inst.name);
  return c.json({ state: servers.get(inst.id).state });
});

app.post('/api/v1/servers/:id/stop', async (c) => {
  const inst = await instanceParam(c);
  const { force } = await body<{ force?: boolean }>(c).catch(() => ({ force: false }));
  const proc = servers.get(inst.id);
  void proc.stop(Boolean(force));
  audit(actor(c), force ? 'Szerver kényszerített leállítása' : 'Szerver leállítása', inst.name);
  return c.json({ state: proc.state });
});

app.post('/api/v1/servers/:id/restart', async (c) => {
  const inst = await instanceParam(c);
  if (!settings().eulaAccepted) throw new HttpError(409, 'EULA_REQUIRED', 'Indítás előtt el kell fogadni a Minecraft EULA-t.');
  const proc = servers.get(inst.id);
  void proc
    .stop()
    .then(async () => proc.start((await getInstance(inst.id)) ?? inst))
    .catch((err: unknown) => proc.panel(`Újraindítás sikertelen: ${err instanceof Error ? err.message : err}`));
  audit(actor(c), 'Szerver újraindítása', inst.name);
  return c.json({ state: proc.state });
});

app.post('/api/v1/servers/:id/command', async (c) => {
  const inst = await instanceParam(c);
  const { command } = await body<{ command?: unknown }>(c);
  if (typeof command !== 'string' || !command.trim() || command.length > 1000 || /[\r\n]/.test(command)) {
    throw bad('Érvénytelen parancs.');
  }
  const cmd = command.trim().replace(/^\//, '');
  servers.get(inst.id).send(cmd);
  audit(actor(c), 'Konzolparancs', `${inst.name}: ${cmd}`);
  return c.json({ ok: true });
});

app.get('/api/v1/servers/:id/logs', async (c) => {
  const inst = await instanceParam(c);
  return c.json(servers.get(inst.id).logsSince(Number(c.req.query('since') ?? 0) || 0));
});

app.get('/api/v1/servers/:id/players', async (c) => {
  const inst = await instanceParam(c);
  const ops = await readJson<{ name: string }[]>(join(serverDir(inst.id), 'ops.json'), []);
  return c.json({ players: await listPlayers(inst.id, [...(servers.peek(inst.id)?.players ?? [])]), ops: ops.map((o) => o.name) });
});

app.post('/api/v1/servers/:id/players/:uuid/reset', async (c) => {
  const inst = await instanceParam(c);
  const uuid = c.req.param('uuid') ?? '';
  if (!isUuid(uuid)) throw bad('Érvénytelen játékos azonosító.');
  // Mods (FTB Quests, Teams…) keep player data in memory and would write it back on the next save.
  if (servers.peek(inst.id)?.isActive()) throw new HttpError(409, 'SERVER_RUNNING', 'A játékos visszaállításához előbb állítsd le a szervert.');
  const deleted = await resetPlayer(inst.id, uuid);
  servers.get(inst.id).panel(`Játékos visszaállítva (${uuid}): ${deleted.length} fájl törölve.`);
  audit(actor(c), 'Játékos visszaállítva', `${inst.name}: ${uuid}`);
  return c.json({ deleted });
});

app.get('/api/v1/servers/:id/properties', async (c) => {
  const inst = await instanceParam(c);
  return c.json({ properties: await serverProps(inst.id) });
});

app.put('/api/v1/servers/:id/properties', async (c) => {
  const inst = await instanceParam(c);
  const { properties } = await body<{ properties?: Record<string, unknown> }>(c);
  if (!properties || typeof properties !== 'object') throw bad('Hiányzik a properties objektum.');
  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!/^[a-z0-9][a-z0-9.\-_]{0,63}$/i.test(key)) throw bad(`Érvénytelen kulcs: ${key}`);
    const v = String(value);
    if (/[\r\n]/.test(v) || v.length > 500) throw bad(`Érvénytelen érték: ${key}`);
    updates[key] = v;
  }
  const file = join(serverDir(inst.id), 'server.properties');
  await writeProperties(file, updates);
  audit(actor(c), 'server.properties módosítva', `${inst.name}: ${Object.keys(updates).join(', ')}`);
  return c.json({ properties: await readProperties(file), restartRequired: servers.peek(inst.id)?.isActive() ?? false });
});

// ---- modpacks ----

const SOURCES = ['curseforge', 'modrinth', 'vanilla'] as const;
function sourceParam(c: Context) {
  const source = c.req.query('source');
  if (!SOURCES.includes(source as (typeof SOURCES)[number])) throw bad('Ismeretlen forrás.');
  return source as (typeof SOURCES)[number];
}

app.get('/api/v1/packs/search', async (c) => {
  const source = sourceParam(c);
  const q = (c.req.query('q') ?? '').slice(0, 200);
  const page = Math.max(0, Math.min(50, Number(c.req.query('page') ?? 0) || 0));
  if (source === 'vanilla') return c.json({ results: [], via: 'official' });
  if (source === 'curseforge') return c.json(await curseforge.search(q, page));
  return c.json({ results: await modrinth.search(q, page), via: 'official' });
});

app.get('/api/v1/packs/versions', async (c) => {
  const source = sourceParam(c);
  const id = c.req.query('id') ?? '';
  if (source !== 'vanilla' && !/^[\w-]{1,40}$/.test(id)) throw bad('Érvénytelen azonosító.');
  const versions =
    source === 'vanilla' ? await vanilla.versions() : source === 'curseforge' ? await curseforge.versions(id) : await modrinth.versions(id);
  return c.json({ versions });
});

app.post('/api/v1/packs/install', async (c) => {
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
  audit(actor(c), 'Telepítés indítása', `${input.source}: ${job.title} (${input.versionId})`);
  return c.json({ job });
});

app.get('/api/v1/jobs/latest/:kind', (c) => c.json({ job: latestJob(c.req.param('kind')) }));

app.get('/api/v1/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) throw new HttpError(404, 'NOT_FOUND', 'Nincs ilyen feladat.');
  return c.json({ job });
});
