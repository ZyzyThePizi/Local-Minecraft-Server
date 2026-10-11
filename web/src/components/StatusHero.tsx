import { Check, Copy, ExternalLink, LogIn, Power, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { LOADER_LABEL } from '../format';
import type { HubNode, HubServer } from '../hub/HubProvider';
import { relativeTime } from '../format';
import { useT } from '../i18n';
import { Button, PackIcon, Skeleton, StateDot, StateLabel } from './ui';

/** The public card of an island: its servers and the selected one's join address. */
export function IslandHero({
  node,
  servers,
  selectedId,
  onSelect,
  onLogin,
}: {
  node: HubNode;
  servers: HubServer[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLogin: () => void;
}) {
  const t = useT();
  const { live } = node;
  if (live.reach === 'checking' && !servers) return <LoadingHero />;
  if (live.reach !== 'online') return <OfflineHero node={node} />;
  const selected = servers?.find((s) => s.id === selectedId) ?? servers?.[0] ?? null;

  return (
    <div className="brackets glass animate-rise border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-7">
        <span className="label truncate">
          <span className="text-signal">[01]</span> {node.rec.name}
        </span>
        {selected ? <StateLabel state={selected.state} /> : <span className="label">Online</span>}
      </div>

      {servers && servers.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-line px-5 py-3 sm:px-7" role="tablist" aria-label={t('Servers on this machine', 'Szerverek ezen a gépen')}>
          {servers.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === selected?.id}
              onClick={() => onSelect(s.id)}
              className={`inline-flex h-8 shrink-0 items-center gap-2 border px-3 text-sm transition-colors ${
                s.id === selected?.id ? 'border-signal/60 text-fg' : 'border-line-strong text-fg-muted hover:text-fg'
              }`}
            >
              <StateDot state={s.state} />
              <span className="max-w-40 truncate">{s.name}</span>
            </button>
          ))}
        </div>
      )}

      {servers === null ? (
        <div className="px-5 py-7 sm:px-7">
          <h1 className="text-display">{node.rec.name}</h1>
          <p className="mt-4 max-w-md text-fg-muted">{t('The status of this machine is only visible after signing in.', 'A gép állapota csak belépés után látható.')}</p>
          <Button variant="primary" className="mt-6" onClick={onLogin} icon={<LogIn className="size-4" />}>
            {t('Sign in', 'Belépés')}
          </Button>
        </div>
      ) : (
        <ServerCard server={selected} />
      )}
    </div>
  );
}

function ServerCard({ server }: { server: HubServer | null }) {
  const t = useT();
  return (
    <>
      <div className="px-5 pt-6 pb-7 sm:px-7">
        <div className="flex items-start gap-4">
          {server?.iconUrl && <PackIcon src={server.iconUrl} eager className="mt-1 size-14 shrink-0 sm:size-16" />}
          <h1 className="text-display line-clamp-3 break-words">{server?.name ?? t('No server yet', 'Még nincs szerver')}</h1>
        </div>
        {server?.motd && server.motd !== server.name && <p className="mt-4 max-w-md text-fg-muted">{server.motd}</p>}
        {!server && (
          <p className="mt-4 max-w-md text-fg-muted">{t('The owner of the machine can pick a modpack or a vanilla version in the panel.', 'A gép tulajdonosa a panelen választhat modpacket vagy vanilla verziót.')}</p>
        )}
        {server?.websiteUrl && (
          <a href={server.websiteUrl} target="_blank" rel="noreferrer" className="label mt-4 inline-flex items-center gap-1.5 hover:text-fg">
            {t('Modpack page', 'Modpack oldala')} <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      <dl className="grid grid-cols-3 border-y border-line">
        <Readout label={t('Players', 'Játékosok')} value={server?.state === 'running' ? `${server.players}/${server.maxPlayers}` : '–'} signal={(server?.players ?? 0) > 0} />
        <Readout label={t('Version', 'Verzió')} value={server?.mcVersion ?? '–'} />
        <Readout label="Loader" value={server ? LOADER_LABEL[server.loader] : '–'} />
      </dl>

      <AddressBar address={server?.gameAddress ?? null} />
    </>
  );
}

function Readout({ label, value, signal = false }: { label: string; value: string; signal?: boolean }) {
  return (
    <div className="border-r border-line px-5 py-4 last:border-r-0 sm:px-7">
      <dt className="label">{label}</dt>
      <dd className={`readout mt-1.5 truncate text-lg ${signal ? 'text-signal' : ''}`}>{value}</dd>
    </div>
  );
}

function AddressBar({ address }: { address: string | null }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the address stays selectable */
    }
  };
  return (
    <div className="px-5 py-5 sm:px-7">
      <span className="label">{t('Join address', 'Csatlakozás')}</span>
      {address ? (
        <div className="mt-2 flex items-stretch">
          <code className="readout flex min-w-0 flex-1 items-center truncate border border-r-0 border-line-strong bg-bg/70 px-3 text-sm select-all sm:text-base">{address}</code>
          <button onClick={copy} className="inline-flex h-11 shrink-0 items-center gap-2 bg-signal px-4 font-mono text-xs font-semibold tracking-[0.08em] text-signal-ink uppercase hover:bg-signal-hover">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? t('Copied', 'Másolva') : t('Copy', 'Másolás')}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-fg-faint">{t('The address is not set yet.', 'A cím még nincs beállítva.')}</p>
      )}
    </div>
  );
}

function OfflineHero({ node }: { node: HubNode }) {
  const t = useT();
  const { live, rec } = node;
  const outdated = live.reach === 'outdated';
  const broken = live.reach === 'key-changed' || live.reach === 'error';
  return (
    <div className="brackets glass animate-rise border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-7">
        <span className="label truncate">
          <span className="text-signal">[01]</span> {rec.name}
        </span>
        <span className={`inline-flex items-center gap-2 font-mono text-xs tracking-[0.08em] uppercase ${broken ? 'text-danger' : 'text-fg-muted'}`}>
          <span className={`size-2 ${broken ? 'bg-danger' : 'bg-fg-faint'}`} aria-hidden /> {outdated ? t('Old version', 'Régi verzió') : broken ? t('Error', 'Hiba') : t('Unreachable', 'Nem elérhető')}
        </span>
      </div>
      <div className="px-5 py-7 sm:px-7">
        {broken ? <ShieldAlert className="mb-5 size-7 text-danger" aria-hidden /> : <Power className="mb-5 size-7 text-fg-faint" aria-hidden />}
        <h1 className="text-display">{outdated ? t('Needs an update', 'Frissítésre vár') : broken ? t('Cannot be verified', 'Nem ellenőrizhető') : t('The machine is asleep', 'A gép alszik')}</h1>
        <p className="mt-4 max-w-md text-fg-muted">
          {live.message ?? t('Once the backend starts on the machine, its servers show up here. The page retries by itself.', 'Amint a gépen elindul a backend, itt megjelennek a szerverei. Az oldal magától újrapróbálja.')}
          {live.reach === 'offline' && rec.lastSeenAt && <> {t(`Last seen ${relativeTime(rec.lastSeenAt)}.`, `Utoljára ${relativeTime(rec.lastSeenAt)} láttuk.`)}</>}
        </p>
        <p className="mt-6 max-w-md border-t border-line pt-4 text-xs text-fg-faint">
          {t(
            'On a machine that runs Tailscale the browser may ask for permission to access “devices on the local network”. Allow it, otherwise the page cannot reach the machine.',
            'Tailscale-t futtató gépen a böngésző engedélyt kérhet a „helyi hálózati eszközök” eléréséhez. Ezt engedélyezd, különben az oldal nem éri el a gépet.',
          )}
        </p>
      </div>
    </div>
  );
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <Button onClick={onRetry} icon={<RefreshCw className="size-4" />}>
      {t('Retry', 'Újrapróbálás')}
    </Button>
  );
}

export function LoadingHero() {
  const t = useT();
  return (
    <div className="brackets glass border border-line p-7">
      <span className="label">
        <span className="text-signal">[01]</span> {t('Connecting', 'Kapcsolódás')}<span className="animate-blink">_</span>
      </span>
      <Skeleton className="mt-6 h-16 w-4/5" />
      <Skeleton className="mt-3 h-16 w-3/5" />
      <Skeleton className="mt-8 h-12 w-full" />
    </div>
  );
}
