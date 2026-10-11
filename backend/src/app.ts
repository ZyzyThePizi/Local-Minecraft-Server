import { join } from 'node:path';
import { cpus, totalmem } from 'node:os';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { audit, readAudit } from './audit.ts';
import { API_VERSION, config, HttpError, MIN_PASSWORD_LENGTH, reloadEnv, VERSION, writeEnvValue } from './config.ts';
import { errorText, langOf, pick, tx, type Text } from './i18n.ts';
import { recommendedMemory, startInstall, type InstallRequest } from './install.ts';
import { getJob, jobView, latestJob, runningJob } from './jobs.ts';
import { helloMessage, nodeId, publicKey, shortId, signBytes } from './node.ts';
import { isUuid, listPlayers, resetPlayer } from './players.ts';
import { readProperties, writeProperties } from './properties.ts';
import * as curseforge from './providers/curseforge.ts';
import * as modrinth from './providers/modrinth.ts';
import * as vanilla from './providers/vanilla.ts';
import { REGISTRY_URL, registryState } from './registry.ts';
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
import { WIPE_SCOPES, wipeServer, type WipeScope } from './wipe.ts';
import { deleteInstance, getInstance, isValidInstanceId, listInstances, readJson, saveInstance, serverDir, settings, updateSettings, type Instance, type Settings } from './store.ts';

/** Filled in by index.ts once the server listens. */
export const runtime = { publicUrl: null as string | null, funnelNote: null as Text | null };

type Env = { Variables: { session: Session } };

const bad = (en: string, hu: string) => new HttpError(400, 'BAD_REQUEST', tx(en, hu));
/** The language the hub asked for; the panel's texts go out in that one. */
const lang = (c: Context) => langOf(c.req.header('accept-language'));
const totalMemoryMb = () => Math.floor(totalmem() / 1048576);

async function body<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw bad('Malformed JSON body.', 'Hibás JSON törzs.');
  }
}

// Behind Tailscale Funnel every request arrives from loopback; the proxy appends the real client to
// X-Forwarded-For. Take the last entry: earlier ones are whatever the client chose to send.
const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'local';
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
app.use('/api/*', bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: { code: 'TOO_LARGE', message: pick(tx('The request is too large.', 'Túl nagy kérés.'), lang(c)) } }, 413) }));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.text[lang(c)] } }, err.status as ContentfulStatusCode);
  console.error(err);
  return c.json({ error: { code: 'INTERNAL', message: errorText(err)[lang(c)] || pick(tx('Internal error.', 'Belső hiba.'), lang(c)) } }, 500);
});

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: pick(tx('No such endpoint.', 'Nincs ilyen végpont.'), lang(c)) } }, 404));

// ---------- public ----------

app.get('/api/health', (c) => c.json({ ok: true, name: settings().panelName, version: VERSION, apiVersion: API_VERSION, nodeId }));

// The hub pins the public key on first contact and checks this signature on every connect.
app.get('/api/v1/hello', (c) => {
  const nonce = c.req.query('nonce') ?? '';
  if (!/^[\w-]{16,128}$/.test(nonce)) throw bad('Missing or malformed nonce.', 'Hiányzó vagy hibás nonce.');
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
  if (!settings().publicStatus) throw new HttpError(403, 'PRIVATE', tx('The status of this machine is only visible after signing in.', 'Ennek a gépnek az állapota csak belépés után látható.'));
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
      audit({ sessionId: tokens.sessionId, via: via ? viaLabel(via) : tx('invite', 'meghívó'), device, ip }, tx('Signed in with an invite', 'Belépés meghívóval'));
      return c.json(tokens);
    } catch (err) {
      audit(actorOf(null, ip), tx('Failed sign-in (invite)', 'Sikertelen belépés (meghívó)'), device);
      throw err;
    }
  }
  if (typeof input.password !== 'string' || !input.password) throw bad('Enter the password or the invite.', 'Add meg a jelszót vagy a meghívót.');
  reloadEnv(); // a password just edited in .env works right away
  try {
    const tokens = await loginWithPassword(input.password.trim(), device, ip);
    audit({ sessionId: tokens.sessionId, via: tx('password', 'jelszó'), device, ip }, tx('Signed in with the password', 'Belépés jelszóval'));
    return c.json(tokens);
  } catch (err) {
    audit(actorOf(null, ip), tx('Failed sign-in (wrong password)', 'Sikertelen belépés (hibás jelszó)'), device);
    throw err;
  }
});

app.post('/api/v1/session/refresh', async (c) => {
  const { refreshToken } = await body<{ refreshToken?: unknown }>(c);
  if (typeof refreshToken !== 'string') throw bad('The refreshToken is missing.', 'Hiányzik a refreshToken.');
  return c.json(await refresh(refreshToken, clientIp(c)));
});

// ---------- signed in ----------

const OPEN = new Set(['/api/v1/hello', '/api/v1/status', '/api/v1/session', '/api/v1/session/refresh']);
app.use('/api/v1/*', async (c, next) => {
  if (OPEN.has(c.req.path) && !(c.req.path === '/api/v1/session' && c.req.method === 'DELETE')) return next();
  const header = c.req.header('authorization') ?? '';
  const session = verifyAccess(header.startsWith('Bearer ') ? header.slice(7) : undefined);
  if (!session) throw new HttpError(401, 'UNAUTHORIZED', tx('The sign-in has expired or is invalid.', 'Lejárt vagy érvénytelen belépés.'));
  c.set('session', session);
  await next();
});

app.delete('/api/v1/session', async (c) => {
  await revokeSession(c.get('session').id);
  audit(actor(c), tx('Signed out', 'Kilépés'));
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
    funnelNote: runtime.funnelNote && runtime.funnelNote[lang(c)],
    settings: settings(),
    system: { totalMemoryMb: totalMemoryMb(), recommendedMemoryMb: recommendedMemory(true), platform: process.platform, cpus: cpus().length },
    ram: { budgetMb: ramBudgetMb(), reservedMb: servers.reservedMb() },
    curseforgeConfigured: Boolean(config.curseforgeApiKey),
    installing: runningJob('install') !== null,
    registry: { ...registryState, url: REGISTRY_URL },
    session: { id: s.id, via: s.via, device: s.device },
  });
});

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

app.patch('/api/v1/node', async (c) => {
  const input = await body<Partial<Record<keyof Settings, unknown>>>(c);
  const patch: Partial<Settings> = {};
  const changed: Text[] = [];
  if (input.panelName !== undefined) {
    const name = str(input.panelName, 40);
    if (!name) throw bad('The machine name cannot be empty.', 'A gép neve nem lehet üres.');
    patch.panelName = name;
    changed.push(tx(`name: ${name}`, `név: ${name}`));
  }
  if (input.eulaAccepted !== undefined) {
    if (typeof input.eulaAccepted !== 'boolean') throw bad('Invalid EULA value.', 'Érvénytelen EULA érték.');
    patch.eulaAccepted = input.eulaAccepted;
    changed.push(input.eulaAccepted ? tx('EULA: accepted', 'EULA: elfogadva') : tx('EULA: withdrawn', 'EULA: visszavonva'));
  }
  if (input.maxRamMb !== undefined) {
    const v = input.maxRamMb;
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1024 || v > totalMemoryMb())) {
      throw bad(`The memory budget must be between 1024 and ${totalMemoryMb()} MB (or automatic).`, `A memóriakeret 1024 és ${totalMemoryMb()} MB között lehet (vagy automatikus).`);
    }
    patch.maxRamMb = v as number | null;
    changed.push(v === null ? tx('RAM budget: automatic', 'RAM-keret: automatikus') : tx(`RAM budget: ${v} MB`, `RAM-keret: ${v} MB`));
  }
  if (input.publicStatus !== undefined) {
    if (typeof input.publicStatus !== 'boolean') throw bad('Invalid value.', 'Érvénytelen érték.');
    patch.publicStatus = input.publicStatus;
    changed.push(input.publicStatus ? tx('public status: on', 'nyilvános állapot: be') : tx('public status: off', 'nyilvános állapot: ki'));
  }
  if (input.publicUrl !== undefined) {
    const url = str(input.publicUrl, 200).replace(/\/$/, '');
    if (url && !/^https:\/\/[^\s]+$/.test(url)) throw bad('The public address must start with https://.', 'A nyilvános cím https:// címmel kezdődjön.');
    patch.publicUrl = url;
    changed.push(tx(`public address: ${url || 'automatic'}`, `nyilvános cím: ${url || 'automatikus'}`));
  }
  if (input.allowedOrigins !== undefined) {
    const list = Array.isArray(input.allowedOrigins) ? input.allowedOrigins.map((o) => str(o, 120).replace(/\/$/, '')).filter(Boolean) : null;
    if (!list || !list.length || list.length > 12 || list.some((o) => !ORIGIN.test(o))) {
      throw bad('The list of allowed pages is malformed (e.g. https://zyzythepizi.github.io).', 'Az engedélyezett oldalak listája hibás (pl. https://zyzythepizi.github.io).');
    }
    patch.allowedOrigins = [...new Set(list)];
    changed.push(tx('allowed pages', 'engedélyezett oldalak'));
  }
  const next = await updateSettings(patch);
  if (changed.length) audit(actor(c), tx('Machine settings changed', 'Gépbeállítás módosítva'), tx(changed.map((t) => t.en).join(', '), changed.map((t) => t.hu).join(', ')));
  return c.json({ settings: next });
});

app.post('/api/v1/node/password', async (c) => {
  const input = await body<{ current?: unknown; next?: unknown; device?: unknown }>(c);
  if (typeof input.current !== 'string' || !checkPassword(input.current.trim())) {
    audit(actor(c), tx('Failed password change (wrong current password)', 'Sikertelen jelszócsere (hibás jelenlegi jelszó)'));
    throw new HttpError(403, 'BAD_PASSWORD', tx('The current password is wrong.', 'A jelenlegi jelszó hibás.'));
  }
  const next = typeof input.next === 'string' ? input.next.trim() : '';
  if (next.length < MIN_PASSWORD_LENGTH) throw bad(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters long.`, `Az új jelszó legalább ${MIN_PASSWORD_LENGTH} karakter legyen.`);
  if (/[\r\n]/.test(next)) throw bad('The password cannot contain a line break.', 'A jelszó nem tartalmazhat sortörést.');
  writeEnvValue('ADMIN_PASSWORD', next);
  config.adminPassword = next;
  const ended = await revokeAllSessions();
  audit(actor(c), tx('Password changed', 'Jelszó megváltoztatva'), tx(`${ended} sessions ended`, `${ended} munkamenet lezárva`));
  // The caller stays signed in with a fresh session.
  return c.json(await loginWithPassword(next, str(input.device, 60) || c.get('session').device, clientIp(c)));
});

app.get('/api/v1/sessions', (c) => c.json({ sessions: listSessions(), currentId: c.get('session').id }));

app.delete('/api/v1/sessions/:id', async (c) => {
  const sid = c.req.param('id') ?? '';
  const target = listSessions().find((s) => s.id === sid);
  if (!target || !(await revokeSession(sid))) throw new HttpError(404, 'NOT_FOUND', tx('No such session.', 'Nincs ilyen munkamenet.'));
  audit(actor(c), tx('Session ended', 'Munkamenet lezárva'), target.device);
  return c.json({ ok: true });
});

app.post('/api/v1/sessions/revoke-all', async (c) => {
  const { includeSelf } = await body<{ includeSelf?: unknown }>(c).catch(() => ({ includeSelf: false }));
  const count = await revokeAllSessions(includeSelf === true ? undefined : c.get('session').id);
  audit(actor(c), tx('Signed out everywhere', 'Kijelentkeztetés mindenhol'), tx(`${count} sessions`, `${count} munkamenet`));
  return c.json({ ended: count });
});

app.get('/api/v1/invites', (c) => c.json({ invites: listInvites() }));

app.post('/api/v1/invites', async (c) => {
  const input = await body<{ label?: unknown; expiresInHours?: unknown; maxUses?: unknown }>(c);
  const hours = input.expiresInHours;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 1 || hours > 24 * 90) throw bad('The expiry must be between 1 hour and 90 days.', 'A lejárat 1 óra és 90 nap között lehet.');
  const maxUses = input.maxUses === null ? null : input.maxUses;
  if (maxUses !== null && (typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100)) {
    throw bad('The number of uses must be between 1 and 100 (or unlimited).', 'A felhasználások száma 1 és 100 között lehet (vagy korlátlan).');
  }
  const label = str(input.label, 60);
  const created = await createInvite({ label, expiresInHours: hours, maxUses }, `${pick(actor(c).via, 'en')} · ${actor(c).device}`);
  audit(
    actor(c),
    tx('Invite created', 'Meghívó létrehozva'),
    tx(`${created.invite.label} (${hours} h, ${maxUses ?? 'unlimited'} uses)`, `${created.invite.label} (${hours} óra, ${maxUses ?? 'korlátlan'} használat)`),
  );
  return c.json(created);
});

app.delete('/api/v1/invites/:id', async (c) => {
  const res = await revokeInvite(c.req.param('id') ?? '');
  if (!res) throw new HttpError(404, 'NOT_FOUND', tx('No such invite.', 'Nincs ilyen meghívó.'));
  audit(actor(c), tx('Invite revoked', 'Meghívó visszavonva'), tx(`${res.endedSessions} sessions ended`, `${res.endedSessions} munkamenet lezárva`));
  return c.json(res);
});

app.get('/api/v1/audit', async (c) => {
  const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') ?? 100) || 100));
  return c.json({ entries: await readAudit(limit, lang(c)) });
});

// ---- servers (installed modpacks / vanilla versions) ----

app.get('/api/v1/servers', async (c) => c.json({ servers: await Promise.all((await listInstances()).map(serverSummary)) }));

async function instanceParam(c: Context) {
  const id = c.req.param('id') ?? '';
  const inst = isValidInstanceId(id) ? await getInstance(id) : null;
  if (!inst) throw new HttpError(404, 'NOT_FOUND', tx('No such server.', 'Nincs ilyen szerver.'));
  return inst;
}

app.patch('/api/v1/servers/:id', async (c) => {
  const inst = await instanceParam(c);
  const input = await body<{ name?: unknown; memoryMb?: unknown; jvmArgs?: unknown; autoStart?: unknown; gameAddress?: unknown }>(c);
  if (typeof input.name === 'string' && input.name.trim()) inst.name = input.name.trim().slice(0, 80);
  if (typeof input.memoryMb === 'number') {
    if (!Number.isInteger(input.memoryMb) || input.memoryMb < 512 || input.memoryMb > totalMemoryMb()) {
      throw bad(`The memory must be between 512 and ${totalMemoryMb()} MB.`, `A memória 512 és ${totalMemoryMb()} MB között lehet.`);
    }
    inst.memoryMb = input.memoryMb;
  }
  if (typeof input.jvmArgs === 'string') {
    if (input.jvmArgs.length > 1000 || /[\r\n]/.test(input.jvmArgs)) throw bad('Invalid JVM arguments.', 'Érvénytelen JVM argumentumok.');
    inst.jvmArgs = input.jvmArgs.trim();
  }
  if (typeof input.autoStart === 'boolean') inst.autoStart = input.autoStart;
  if (typeof input.gameAddress === 'string') {
    if (input.gameAddress.length > 200 || /\s/.test(input.gameAddress.trim())) throw bad('Invalid join address.', 'Érvénytelen csatlakozási cím.');
    inst.gameAddress = input.gameAddress.trim();
  }
  await saveInstance(inst);
  audit(actor(c), tx('Server changed', 'Szerver módosítva'), `${inst.name}: ${Object.keys(input).join(', ')}`);
  return c.json({ server: await serverSummary(inst), restartRequired: servers.peek(inst.id)?.isActive() ?? false });
});

app.delete('/api/v1/servers/:id', async (c) => {
  const inst = await instanceParam(c);
  if (servers.peek(inst.id)?.isActive()) throw new HttpError(409, 'SERVER_RUNNING', tx('Stop this server first.', 'Előbb állítsd le ezt a szervert.'));
  await deleteInstance(inst.id);
  servers.forget(inst.id);
  audit(actor(c), tx('Server deleted', 'Szerver törölve'), inst.name);
  return c.json({ ok: true });
});

app.post('/api/v1/servers/:id/start', async (c) => {
  const inst = await instanceParam(c);
  await servers.get(inst.id).start(inst);
  audit(actor(c), tx('Server started', 'Szerver indítása'), inst.name);
  return c.json({ state: servers.get(inst.id).state });
});

app.post('/api/v1/servers/:id/stop', async (c) => {
  const inst = await instanceParam(c);
  const { force } = await body<{ force?: boolean }>(c).catch(() => ({ force: false }));
  const proc = servers.get(inst.id);
  void proc.stop(Boolean(force));
  audit(actor(c), force ? tx('Server force-stopped', 'Szerver kényszerített leállítása') : tx('Server stopped', 'Szerver leállítása'), inst.name);
  return c.json({ state: proc.state });
});

app.post('/api/v1/servers/:id/restart', async (c) => {
  const inst = await instanceParam(c);
  if (!settings().eulaAccepted) {
    throw new HttpError(409, 'EULA_REQUIRED', tx('The Minecraft EULA must be accepted before starting.', 'Indítás előtt el kell fogadni a Minecraft EULA-t.'));
  }
  const proc = servers.get(inst.id);
  void proc
    .stop()
    .then(async () => proc.start((await getInstance(inst.id)) ?? inst))
    .catch((err: unknown) => {
      const why = errorText(err);
      proc.panel(tx(`Restart failed: ${why.en}`, `Újraindítás sikertelen: ${why.hu}`));
    });
  audit(actor(c), tx('Server restarted', 'Szerver újraindítása'), inst.name);
  return c.json({ state: proc.state });
});

app.post('/api/v1/servers/:id/command', async (c) => {
  const inst = await instanceParam(c);
  const { command } = await body<{ command?: unknown }>(c);
  if (typeof command !== 'string' || !command.trim() || command.length > 1000 || /[\r\n]/.test(command)) {
    throw bad('Invalid command.', 'Érvénytelen parancs.');
  }
  const cmd = command.trim().replace(/^\//, '');
  servers.get(inst.id).send(cmd);
  audit(actor(c), tx('Console command', 'Konzolparancs'), `${inst.name}: ${cmd}`);
  return c.json({ ok: true });
});

app.get('/api/v1/servers/:id/logs', async (c) => {
  const inst = await instanceParam(c);
  return c.json(servers.get(inst.id).logsSince(Number(c.req.query('since') ?? 0) || 0, lang(c)));
});

app.get('/api/v1/servers/:id/players', async (c) => {
  const inst = await instanceParam(c);
  const ops = await readJson<{ name: string }[]>(join(serverDir(inst.id), 'ops.json'), []);
  return c.json({ players: await listPlayers(inst.id, [...(servers.peek(inst.id)?.players ?? [])]), ops: ops.map((o) => o.name) });
});

app.post('/api/v1/servers/:id/players/:uuid/reset', async (c) => {
  const inst = await instanceParam(c);
  const uuid = c.req.param('uuid') ?? '';
  if (!isUuid(uuid)) throw bad('Invalid player id.', 'Érvénytelen játékos azonosító.');
  // Mods (FTB Quests, Teams…) keep player data in memory and would write it back on the next save.
  if (servers.peek(inst.id)?.isActive()) {
    throw new HttpError(409, 'SERVER_RUNNING', tx('Stop the server before resetting a player.', 'A játékos visszaállításához előbb állítsd le a szervert.'));
  }
  const deleted = await resetPlayer(inst.id, uuid);
  servers.get(inst.id).panel(tx(`Player reset (${uuid}): ${deleted.length} files deleted.`, `Játékos visszaállítva (${uuid}): ${deleted.length} fájl törölve.`));
  audit(actor(c), tx('Player reset', 'Játékos visszaállítva'), `${inst.name}: ${uuid}`);
  return c.json({ deleted });
});

const WIPE_LABEL: Record<WipeScope, Text> = {
  players: tx('Player data wiped', 'Játékosadatok törölve'),
  world: tx('World wiped', 'Világ törölve'),
  all: tx('World, players and backups wiped', 'Világ, játékosok és mentések törölve'),
};

// A fresh start: every player's data, the world, or both together with the backups (see wipe.ts).
app.post('/api/v1/servers/:id/wipe', async (c) => {
  const inst = await instanceParam(c);
  const { scope } = await body<{ scope?: unknown }>(c);
  if (!WIPE_SCOPES.includes(scope as WipeScope)) throw bad('Unknown scope (players, world or all).', 'Ismeretlen hatókör (players, world vagy all).');
  // A running server holds the world open and would write everything back on the next save.
  if (servers.peek(inst.id)?.isActive()) throw new HttpError(409, 'SERVER_RUNNING', tx('Stop the server before wiping its data.', 'Törlés előtt állítsd le a szervert.'));
  const removed = await wipeServer(inst.id, scope as WipeScope);
  const label = WIPE_LABEL[scope as WipeScope];
  const what = removed.join(', ');
  servers.get(inst.id).panel(tx(`${label.en}: ${what || 'there was nothing to delete'}.`, `${label.hu}: ${what || 'nem volt mit törölni'}.`));
  audit(actor(c), label, `${inst.name}${what ? `: ${what}` : ''}`);
  return c.json({ removed });
});

app.get('/api/v1/servers/:id/properties', async (c) => {
  const inst = await instanceParam(c);
  return c.json({ properties: await serverProps(inst.id) });
});

app.put('/api/v1/servers/:id/properties', async (c) => {
  const inst = await instanceParam(c);
  const { properties } = await body<{ properties?: Record<string, unknown> }>(c);
  if (!properties || typeof properties !== 'object') throw bad('The properties object is missing.', 'Hiányzik a properties objektum.');
  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!/^[a-z0-9][a-z0-9.\-_]{0,63}$/i.test(key)) throw bad(`Invalid key: ${key}`, `Érvénytelen kulcs: ${key}`);
    const v = String(value);
    if (/[\r\n]/.test(v) || v.length > 500) throw bad(`Invalid value: ${key}`, `Érvénytelen érték: ${key}`);
    updates[key] = v;
  }
  const file = join(serverDir(inst.id), 'server.properties');
  await writeProperties(file, updates);
  audit(actor(c), tx('server.properties changed', 'server.properties módosítva'), `${inst.name}: ${Object.keys(updates).join(', ')}`);
  return c.json({ properties: await readProperties(file), restartRequired: servers.peek(inst.id)?.isActive() ?? false });
});

// ---- modpacks ----

const SOURCES = ['curseforge', 'modrinth', 'vanilla'] as const;
function sourceParam(c: Context) {
  const source = c.req.query('source');
  if (!SOURCES.includes(source as (typeof SOURCES)[number])) throw bad('Unknown source.', 'Ismeretlen forrás.');
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
  if (source !== 'vanilla' && !/^[\w-]{1,40}$/.test(id)) throw bad('Invalid id.', 'Érvénytelen azonosító.');
  const versions =
    source === 'vanilla' ? await vanilla.versions() : source === 'curseforge' ? await curseforge.versions(id) : await modrinth.versions(id);
  return c.json({ versions });
});

app.post('/api/v1/packs/install', async (c) => {
  const input = await body<Partial<InstallRequest>>(c);
  if (!SOURCES.includes(input.source as (typeof SOURCES)[number])) throw bad('Unknown source.', 'Ismeretlen forrás.');
  if (typeof input.versionId !== 'string' || !/^[\w.+-]{1,60}$/.test(input.versionId)) throw bad('Invalid version.', 'Érvénytelen verzió.');
  if (input.projectId !== undefined && (typeof input.projectId !== 'string' || !/^[\w-]{1,40}$/.test(input.projectId))) {
    throw bad('Invalid modpack id.', 'Érvénytelen modpack azonosító.');
  }
  const job = startInstall({
    source: input.source!,
    projectId: input.projectId,
    versionId: input.versionId,
    name: typeof input.name === 'string' ? input.name.slice(0, 80) : undefined,
  });
  audit(actor(c), tx('Install started', 'Telepítés indítása'), `${input.source}: ${job.title} (${input.versionId})`);
  return c.json({ job: jobView(job, lang(c)) });
});

app.get('/api/v1/jobs/latest/:kind', (c) => c.json({ job: jobView(latestJob(c.req.param('kind')), lang(c)) }));

app.get('/api/v1/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) throw new HttpError(404, 'NOT_FOUND', tx('No such job.', 'Nincs ilyen feladat.'));
  return c.json({ job: jobView(job, lang(c)) });
});
