import { Check, Copy, KeyRound, LogOut, Save, Ticket, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, type Tokens } from '../hub/client';
import { groupFingerprint } from '../hub/crypto';
import { useHub, useNode } from '../hub/HubProvider';
import { joinLink } from '../hub/links';
import { formatDateTime, formatMemory, relativeTime } from '../format';
import { usePoll } from '../hooks';
import { tr, tx, useLang, useT, type Text } from '../i18n';
import type { AuditEntry, InviteInfo, NodeOverview, SessionInfo, Via } from '../types';
import { Button, Chip, Field, inputClass, Notice, Panel, PanelTitle, Skeleton, Toggle } from './ui';

/** Requests that never left the machine have no client address. */
const localIp = (ip: string) => (ip === 'local' || ip === 'helyi' ? tr('local', 'helyi') : ip);
const viaText = (via: Via) => (via.kind === 'password' ? tr('Password', 'Jelszó') : tr(`Invite: ${via.label}`, `Meghívó: ${via.label}`));

function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'signal' | 'danger'; text: ReactNode } | null>(null);
  const run = async (key: string, fn: () => Promise<ReactNode | void>) => {
    setBusy(key);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ tone: 'signal', text });
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof ApiError ? err.message : tr('Unknown error.', 'Ismeretlen hiba.') });
    } finally {
      setBusy(null);
    }
  };
  return { busy, message, run };
}

/** This machine: its settings, password, who can get in (invites, sessions) and what they did (audit). */
export function MachineTab({ overview, refresh }: { overview: NodeOverview; refresh: () => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-5">
        <MachineSettings key={overview.settings.panelName} overview={overview} refresh={refresh} />
        <PasswordPanel />
        <NetworkPanel overview={overview} />
      </div>
      <div className="space-y-5 lg:col-span-7">
        <InvitesPanel overview={overview} />
        <SessionsPanel overview={overview} />
        <AuditPanel />
      </div>
    </div>
  );
}

function MachineSettings({ overview, refresh }: { overview: NodeOverview; refresh: () => void }) {
  const { client } = useNode();
  const t = useT();
  const s = overview.settings;
  const [name, setName] = useState(s.panelName);
  const [autoRam, setAutoRam] = useState(s.maxRamMb === null);
  const [ram, setRam] = useState(s.maxRamMb ?? overview.ram.budgetMb);
  const [publicUrl, setPublicUrl] = useState(s.publicUrl);
  const [origins, setOrigins] = useState(s.allowedOrigins.join('\n'));
  const action = useAction();
  const total = overview.system.totalMemoryMb;

  const patch = (body: Record<string, unknown>, done: ReactNode = t('Saved.', 'Elmentve.')) =>
    action.run('save', async () => {
      await client.patch('/api/v1/node', body);
      refresh();
      return done;
    });

  const dirty =
    name.trim() !== s.panelName ||
    (autoRam ? s.maxRamMb !== null : ram !== s.maxRamMb) ||
    publicUrl.trim() !== s.publicUrl ||
    origins.split(/\s+/).filter(Boolean).join('\n') !== s.allowedOrigins.join('\n');

  return (
    <Panel>
      <PanelTitle aside={<span className="readout text-xs text-fg-faint">v{overview.version}</span>}>{t('Machine', 'Gép')}</PanelTitle>
      <div className="mb-5 border border-line bg-bg/50 px-4 py-3">
        <p className="label">{t('Fingerprint', 'Ujjlenyomat')}</p>
        <p className="readout mt-1 text-sm">{groupFingerprint(overview.nodeId)}</p>
        <p className="mt-2 text-xs text-fg-faint">
          {t('The hub recognises the machine by this. If it ever changes (a reinstall), the panel warns you.', 'A hub ezzel ismeri fel a gépet. Ha egyszer megváltozik (új telepítés), a panel figyelmeztet.')}
        </p>
      </div>
      <div className="space-y-5">
        <Field label={t('Name', 'Név')} hint={t('This is how the island appears in the hub.', 'Így jelenik meg a sziget a hubban.')}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={inputClass} />
        </Field>

        <div>
          <Toggle
            checked={autoRam}
            onChange={setAutoRam}
            label={t('Automatic memory budget', 'Automatikus memóriakeret')}
            hint={t('The most the running servers may use together. Automatic: the machine’s memory minus 2 GB.', 'A futó szerverek együtt legfeljebb ennyit kaphatnak. Automatikusan: a gép memóriája mínusz 2 GB.')}
          />
          {!autoRam && (
            <>
              <input type="range" min={1024} max={total} step={512} value={ram} onChange={(e) => setRam(Number(e.target.value))} className="mt-3 w-full" aria-label={t('Memory budget (MB)', 'Memóriakeret (MB)')} />
              <p className="label mt-1 flex justify-between !text-[11px]">
                <span>{formatMemory(ram)}</span>
                <span>
                  {t('Machine', 'Gép')}: {formatMemory(total)}
                </span>
              </p>
            </>
          )}
        </div>

        <Toggle
          checked={s.publicStatus}
          onChange={(v) => patch({ publicStatus: v })}
          label={t('Public status', 'Nyilvános állapot')}
          hint={t('Anyone can see which servers run and their join addresses, without a password. Switched off: only after signing in.', 'Jelszó nélkül is látszik, mely szerverek futnak és mi a csatlakozási címük. Kikapcsolva csak belépés után.')}
        />
        <Toggle
          checked={s.eulaAccepted}
          onChange={(v) => patch({ eulaAccepted: v })}
          label={t('Minecraft EULA accepted', 'Minecraft EULA elfogadva')}
          hint={
            <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="text-signal hover:underline">
              {t('Read the EULA', 'EULA elolvasása')}
            </a>
          }
        />

        <Field
          label={t('Public address', 'Nyilvános cím')}
          hint={
            overview.funnelNote
              ? overview.funnelNote
              : s.publicUrl
                ? t('Set by hand. Leave it empty to use the Tailscale Funnel address.', 'Kézzel megadva. Üresen hagyva a Tailscale Funnel címe lesz.')
                : t(
                    `Automatic (Tailscale Funnel)${overview.publicUrl ? `: ${overview.publicUrl}` : ''}. With another tunnel (e.g. Cloudflare), enter its address here.`,
                    `Automatikus (Tailscale Funnel)${overview.publicUrl ? `: ${overview.publicUrl}` : ''}. Más tunnelnél (pl. Cloudflare) itt add meg.`,
                  )
          }
        >
          <input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder={overview.publicUrl ?? 'https://…'} className={`${inputClass} font-mono`} spellCheck={false} />
        </Field>

        <details className="group">
          <summary className="label cursor-pointer list-none hover:text-fg">{t('Advanced: allowed pages', 'Haladó: engedélyezett oldalak')}</summary>
          <p className="mt-2 text-xs text-fg-faint">
            {t(
              'The pages that may call this machine’s API from a browser, one per line. Do not remove the hub’s address, or the panel can no longer reach the machine.',
              'Ezekről az oldalakról hívható a gép API-ja böngészőből. Soronként egy. A hub címét ne töröld, különben a panel nem éri el a gépet.',
            )}
          </p>
          <textarea value={origins} onChange={(e) => setOrigins(e.target.value)} rows={4} className={`${inputClass} mt-2 h-auto py-2 font-mono text-xs`} spellCheck={false} />
        </details>
      </div>
      <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-4">
        {action.message && <span className={`text-sm ${action.message.tone === 'danger' ? 'text-danger' : 'text-signal'}`}>{action.message.text}</span>}
        <Button
          variant="primary"
          busy={action.busy === 'save'}
          disabled={!dirty}
          icon={<Save className="size-4" />}
          onClick={() =>
            patch({
              panelName: name,
              maxRamMb: autoRam ? null : ram,
              publicUrl,
              allowedOrigins: origins.split(/\s+/).filter(Boolean),
            })
          }
        >
          {t('Save', 'Mentés')}
        </Button>
      </div>
    </Panel>
  );
}

function PasswordPanel() {
  const hub = useHub();
  const t = useT();
  const node = useNode();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const action = useAction();
  const mismatch = again.length > 0 && next !== again;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    action.run('pw', async () => {
      const device = node.rec.auth?.device ?? t('Browser', 'Böngésző');
      const tokens = await node.client.post<Tokens>('/api/v1/node/password', { current, next, device });
      await hub.signIn(node.rec.nodeId, tokens, device);
      setCurrent('');
      setNext('');
      setAgain('');
      return t('The password was changed (and written to .env). Every other device was signed out.', 'A jelszó megváltozott (a .env-be is beírtam). Minden más eszköz kijelentkezett.');
    });
  };

  return (
    <Panel>
      <PanelTitle>{t('Password', 'Jelszó')}</PanelTitle>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('Current password', 'Jelenlegi jelszó')}>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t('New password', 'Új jelszó')} hint={t('At least 10 characters. Everyone who knows it has full access.', 'Legalább 10 karakter. Mindenki, aki tudja, teljes hozzáférést kap.')}>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t('New password again', 'Új jelszó még egyszer')}>
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} />
        </Field>
        {mismatch && <Notice tone="warn">{t('The two new passwords do not match.', 'A két új jelszó nem egyezik.')}</Notice>}
        {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
        <Button type="submit" variant="secondary" busy={action.busy === 'pw'} disabled={!current || next.length < 10 || next !== again} icon={<KeyRound className="size-4" />}>
          {t('Change password', 'Jelszó cseréje')}
        </Button>
      </form>
    </Panel>
  );
}

/** Every machine reports to the network; this panel says so plainly and shows exactly what is shared. */
function NetworkPanel({ overview }: { overview: NodeOverview }) {
  const t = useT();
  const r = overview.registry;
  return (
    <Panel>
      <PanelTitle aside={<Chip tone={r.lastError ? 'warn' : 'signal'}>{r.lastError ? t('Unreachable', 'Nem érhető el') : r.lastOkAt ? t('Connected', 'Kapcsolódva') : t('Starting', 'Indul')}</Chip>}>
        {t('Network', 'Hálózat')}
      </PanelTitle>
      <p className="text-sm text-fg-muted">
        {t(
          'This machine is part of the network: every five minutes, and within seconds of a change (a server starts or stops, a player joins), it sends a signed beat to the network’s registry. This cannot be switched off. Announcements and update notices come from there.',
          'Ez a gép a hálózat része: ötpercenként, változáskor (szerver indul vagy leáll, játékos lép be) pedig pár másodpercen belül aláírt jelet küld a hálózat nyilvántartásának. Ez nem kapcsolható ki. Onnan kapja a bejelentéseket és a frissítési figyelmeztetéseket.',
        )}
      </p>
      <dl className="mt-4 grid gap-px border border-line bg-line text-sm sm:grid-cols-2">
        <div className="bg-surface px-4 py-3">
          <dt className="label">{t('What the network owner sees', 'Amit a hálózat tulajdonosa lát')}</dt>
          <dd className="mt-1.5 text-fg-muted">
            {t(
              'The machine’s name, id and version. For each server its name, Minecraft version, loader, state and player count.',
              'A gép neve, azonosítója és verziója. Szerverenként a név, a Minecraft verzió, a loader, az állapot és a játékosok száma.',
            )}
          </dd>
        </div>
        <div className="bg-surface px-4 py-3">
          <dt className="label">{t('What is never sent', 'Ami soha nem megy át')}</dt>
          <dd className="mt-1.5 text-fg-muted">
            {t(
              'Passwords, sign-in tokens, the machine’s or the servers’ addresses, player names, console output, files. Nobody gains access to your machine through this.',
              'Jelszó, belépési token, a gép vagy a szerverek címe, játékosnevek, konzol, fájlok. A gépedhez ettől senki nem fér hozzá.',
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-4 space-y-4">
        {r.url && (
          <p className="text-xs text-fg-faint">
            {t('Registry', 'Nyilvántartás')}: <span className="readout break-all">{r.url}</span>
          </p>
        )}
        {r.lastError && (
          <Notice tone="warn">
            {t(
              `The registry cannot be reached right now (${r.lastError}). The machine works regardless and retries later.`,
              `A nyilvántartás most nem érhető el (${r.lastError}). A gép ettől függetlenül működik, és később újrapróbálja.`,
            )}
          </Notice>
        )}
        {r.announcements.map((a) => (
          <Notice key={a.id} tone={a.level === 'critical' ? 'danger' : a.level === 'warn' ? 'warn' : 'info'}>
            <strong className="font-semibold">{a.title}</strong> {a.body}
          </Notice>
        ))}
      </div>
    </Panel>
  );
}

const EXPIRY: [number, Text][] = [
  [1, tx('1 hour', '1 óra')],
  [24, tx('1 day', '1 nap')],
  [24 * 7, tx('7 days', '7 nap')],
  [24 * 30, tx('30 days', '30 nap')],
];
const USES: [number | null, Text][] = [
  [1, tx('1 device', '1 eszköz')],
  [5, tx('5 devices', '5 eszköz')],
  [null, tx('Unlimited', 'Korlátlan')],
];
const INVITE_STATE: Record<InviteInfo['state'], Text> = {
  active: tx('Active', 'Aktív'),
  expired: tx('Expired', 'Lejárt'),
  used: tx('Used up', 'Felhasználva'),
  revoked: tx('Revoked', 'Visszavonva'),
};

function InvitesPanel({ overview }: { overview: NodeOverview }) {
  const { client, rec } = useNode();
  const t = useT();
  const list = usePoll(() => client.get<{ invites: InviteInfo[] }>('/api/v1/invites'), 15_000, [client]);
  const [label, setLabel] = useState('');
  const [hours, setHours] = useState(24);
  const [uses, setUses] = useState<number | null>(1);
  const [created, setCreated] = useState<{ link: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const action = useAction();

  const create = (e: FormEvent) => {
    e.preventDefault();
    action.run('create', async () => {
      const res = await client.post<{ invite: InviteInfo; token: string }>('/api/v1/invites', { label, expiresInHours: hours, maxUses: uses });
      setCreated({ link: joinLink({ u: overview.publicUrl || rec.url, n: rec.nodeId, i: res.token }), label: res.invite.label });
      setCopied(false);
      setLabel('');
      list.refresh();
    });
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      /* the link stays selectable */
    }
  };

  const invites = list.data?.invites ?? [];
  return (
    <Panel>
      <PanelTitle>{t('Sharing', 'Megosztás')}</PanelTitle>
      <p className="text-sm text-fg-muted">
        {t('With an invite link someone else can sign in to this machine without you handing out the password. An invite gives', 'A meghívólinkkel más is beléphet erre a gépre, a jelszó kiadása nélkül. A meghívó')}{' '}
        <strong className="text-fg">{t('full access', 'teljes hozzáférést')}</strong>{' '}
        {t(
          '(modpacks, console, settings), but it can be revoked at any time, which also ends the sign-ins made with it.',
          'ad (modpack, konzol, beállítások), de bármikor visszavonható, és akkor az általa nyitott belépések is megszűnnek.',
        )}
      </p>
      <form onSubmit={create} className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <Field label={t('For whom', 'Kinek')}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder={t('e.g. Ben', 'pl. Bence')} className={inputClass} />
        </Field>
        <Field label={t('Expires', 'Lejár')}>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={inputClass}>
            {EXPIRY.map(([v, l]) => (
              <option key={v} value={v}>
                {t(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Uses', 'Használat')}>
          <select value={uses ?? 'inf'} onChange={(e) => setUses(e.target.value === 'inf' ? null : Number(e.target.value))} className={inputClass}>
            {USES.map(([v, l]) => (
              <option key={l.en} value={v ?? 'inf'}>
                {t(l)}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" variant="primary" busy={action.busy === 'create'} icon={<Ticket className="size-4" />}>
          {t('Invite', 'Meghívó')}
        </Button>
      </form>
      {!overview.publicUrl && !rec.url.startsWith('https://') && (
        <div className="mt-4">
          <Notice tone="warn">
            {t(
              'This machine has no public address, so the invite only works on this computer. Turn on Tailscale, or enter the public address.',
              'Ennek a gépnek nincs nyilvános címe, ezért a meghívó csak ezen a számítógépen működik. Kapcsold be a Tailscale-t, vagy add meg a nyilvános címet.',
            )}
          </Notice>
        </div>
      )}
      {created && (
        <div className="mt-4 border border-signal/40 bg-signal-dim p-4">
          <p className="label !text-signal">{t(`Invite: ${created.label} · shown only now, copy it`, `Meghívó: ${created.label} · csak most látszik, másold ki`)}</p>
          <div className="mt-2 flex items-stretch">
            <code className="readout min-w-0 flex-1 truncate border border-r-0 border-line-strong bg-bg/70 px-3 py-2 text-xs select-all">{created.link}</code>
            <button onClick={copy} className="inline-flex shrink-0 items-center gap-2 bg-signal px-3 font-mono text-xs font-semibold text-signal-ink uppercase hover:bg-signal-hover">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? t('Copied', 'Másolva') : t('Copy', 'Másolás')}
            </button>
          </div>
          <p className="mt-2 text-xs text-fg-muted">{t('Send it in a private message. Whoever gets it has full access to this machine.', 'Privát üzenetben küldd el. Aki megkapja, teljes hozzáférést kap ehhez a géphez.')}</p>
        </div>
      )}
      {action.message && (
        <div className="mt-4">
          <Notice tone={action.message.tone}>{action.message.text}</Notice>
        </div>
      )}
      {invites.length > 0 && (
        <ul className="mt-5 divide-y divide-line border border-line">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{i.label}</span>
                <span className="label block !normal-case !tracking-normal">
                  {i.uses}/{i.maxUses ?? '∞'} {t('uses', 'használat')} · {i.state === 'active' ? t(`expires ${relativeTime(i.expiresAt)}`, `lejár ${relativeTime(i.expiresAt)}`) : formatDateTime(i.revokedAt ?? i.expiresAt)}
                </span>
              </span>
              <Chip tone={i.state === 'active' ? 'signal' : 'neutral'}>{t(INVITE_STATE[i.state])}</Chip>
              {i.state !== 'revoked' && (
                <Button
                  variant="ghost"
                  busy={action.busy === i.id}
                  onClick={() =>
                    action.run(i.id, async () => {
                      const res = await client.del<{ endedSessions: number }>(`/api/v1/invites/${i.id}`);
                      list.refresh();
                      return t(`Revoked${res.endedSessions ? `, ${res.endedSessions} sign-ins ended` : ''}.`, `Visszavonva${res.endedSessions ? `, ${res.endedSessions} belépés megszűnt` : ''}.`);
                    })
                  }
                  className="!h-8 !px-2"
                >
                  {t('Revoke', 'Visszavonás')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SessionsPanel({ overview }: { overview: NodeOverview }) {
  const { client } = useNode();
  const t = useT();
  const list = usePoll(() => client.get<{ sessions: SessionInfo[]; currentId: string }>('/api/v1/sessions'), 20_000, [client]);
  const action = useAction();
  const sessions = list.data?.sessions ?? [];
  const others = sessions.filter((s) => s.id !== overview.session.id).length;

  return (
    <Panel>
      <PanelTitle
        aside={
          others > 0 && (
            <Button
              variant="ghost"
              busy={action.busy === 'all'}
              icon={<LogOut className="size-4" />}
              className="!h-8 !px-2"
              onClick={() => {
                if (!window.confirm(t('Every other device is signed out of this machine. Continue?', 'Minden más eszköz kijelentkezik erről a gépről. Folytatod?'))) return;
                action.run('all', async () => {
                  const res = await client.post<{ ended: number }>('/api/v1/sessions/revoke-all', { includeSelf: false });
                  list.refresh();
                  return t(`${res.ended} devices signed out.`, `${res.ended} eszköz kijelentkeztetve.`);
                });
              }}
            >
              {t('Sign out everyone else', 'Mindenki más ki')}
            </Button>
          )
        }
      >
        {t('Signed-in devices', 'Belépett eszközök')}
      </PanelTitle>
      {!list.data ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="divide-y divide-line border border-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{s.device}</span>
                  {s.id === overview.session.id && <Chip tone="signal">{t('This device', 'Ez az eszköz')}</Chip>}
                </span>
                <span className="label block !normal-case !tracking-normal">
                  {viaText(s.via)} · {t(`last used ${relativeTime(s.lastUsedAt)}`, `utoljára ${relativeTime(s.lastUsedAt)}`)} · {localIp(s.lastIp)}
                </span>
              </span>
              {s.id !== overview.session.id && (
                <Button
                  variant="ghost"
                  busy={action.busy === s.id}
                  aria-label={t(`Sign out ${s.device}`, `${s.device} kijelentkeztetése`)}
                  icon={<Trash2 className="size-4" />}
                  className="!h-8 !px-2"
                  onClick={() =>
                    action.run(s.id, async () => {
                      await client.del(`/api/v1/sessions/${s.id}`);
                      list.refresh();
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {action.message && (
        <div className="mt-4">
          <Notice tone={action.message.tone}>{action.message.text}</Notice>
        </div>
      )}
    </Panel>
  );
}

function AuditPanel() {
  const { client } = useNode();
  const t = useT();
  const lang = useLang();
  const list = usePoll(() => client.get<{ entries: AuditEntry[] }>('/api/v1/audit?limit=150'), 15_000, [client, lang]);
  return (
    <Panel className="!p-0">
      <div className="border-b border-line px-5 py-3 sm:px-6">
        <h2 className="label !text-fg-muted">{t('Audit log', 'Audit napló')}</h2>
      </div>
      {!list.data ? (
        <Skeleton className="m-5 h-40" />
      ) : list.data.entries.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-faint sm:px-6">{t('No entries yet.', 'Még nincs bejegyzés.')}</p>
      ) : (
        <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {list.data.entries.map((e, i) => (
            <li key={`${e.t}-${i}`} className="grid gap-x-4 px-5 py-2 text-sm sm:grid-cols-[8.5rem_1fr] sm:px-6">
              <span className="readout text-xs text-fg-faint">{formatDateTime(e.t)}</span>
              <span className="min-w-0">
                <span className={/^(Failed|Sikertelen)/.test(e.action) ? 'text-warn' : 'text-fg'}>{e.action}</span>
                {e.detail && <span className="text-fg-muted"> · {e.detail}</span>}
                <span className="label block !normal-case !tracking-normal">
                  {[e.via, e.device, localIp(e.ip)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
