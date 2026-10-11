import { ArrowUpRight, Bomb, Globe, Play, RotateCw, Square, Trash2, UserX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { formatDate, formatMemory, LOADER_LABEL, versionAtLeast } from '../format';
import { useApi } from '../hub/HubProvider';
import { tx, useT, type Text } from '../i18n';
import type { NodeOverview, ServerSummary } from '../types';
import { Button, Chip, Modal, Notice, PackIcon, Panel, StateLabel } from './ui';

type WipeScope = 'players' | 'world' | 'all';

/** The wipe endpoint arrived with this backend version; older machines get a hint to update instead. */
const WIPE_SINCE = '2.2.0';

// A fresh start, in three sizes. What each one deletes and keeps is spelled out before anything happens.
const WIPES: { scope: WipeScope; icon: ReactNode; label: Text; title: Text; deleted: Text; kept: Text }[] = [
  {
    scope: 'players',
    icon: <UserX className="size-3.5" />,
    label: tx('Player data', 'Játékosadatok'),
    title: tx('Wipe all player data', 'Minden játékosadat törlése'),
    deleted: tx(
      'Every player’s inventory, position, XP, statistics and advancements; quest progress, teams, claimed chunks and other per-player mod data; the list of players who ever joined.',
      'Minden játékos inventoryja, pozíciója, XP-je, statisztikái és achievementjei; a küldetés-előrehaladás, a csapatok, a lefoglalt chunkok és a modok egyéb játékosonkénti adatai; a valaha belépett játékosok listája.',
    ),
    kept: tx(
      'The world and everything built in it, the mods and settings, the operators, the whitelist and the bans.',
      'A világ és minden, ami benne épült, a modok és a beállítások, az operátorok, a whitelist és a kitiltások.',
    ),
  },
  {
    scope: 'world',
    icon: <Globe className="size-3.5" />,
    label: tx('World', 'Világ'),
    title: tx('Wipe the world', 'Világ törlése'),
    deleted: tx(
      'The whole world in every dimension with everything built in it, and the character data stored inside it (inventories, quest progress, teams). The next start generates a new world from the seed in the settings.',
      'A teljes világ minden dimenzióval és mindennel, ami benne épült, valamint a benne tárolt karakteradatok (inventory, küldetések, csapatok). A következő indítás új világot generál a beállításokban megadott seedből.',
    ),
    kept: tx(
      'The mods and settings, the datapacks and server configs inside the world folder, the list of known players, the operators, the whitelist, the bans, and the backups made by backup mods.',
      'A modok és a beállítások, a világ mappájában lévő datapackek és szerverkonfigok, az ismert játékosok listája, az operátorok, a whitelist, a kitiltások és a mentő modok biztonsági mentései.',
    ),
  },
  {
    scope: 'all',
    icon: <Bomb className="size-3.5" />,
    label: tx('Everything', 'Minden'),
    title: tx('Wipe everything', 'Minden törlése'),
    deleted: tx(
      'The world, all player data, the list of known players, and the backups made by backup mods (the simplebackups and backups folders).',
      'A világ, minden játékosadat, az ismert játékosok listája és a mentő modok biztonsági mentései (a simplebackups és a backups mappa).',
    ),
    kept: tx(
      'The server itself: mods, configs, server.properties, datapacks, the operators, the whitelist and the bans.',
      'Maga a szerver: modok, konfigok, server.properties, datapackek, az operátorok, a whitelist és a kitiltások.',
    ),
  },
];

const wipeButton =
  'inline-flex h-8 items-center gap-1.5 border border-line-strong bg-bg/50 px-3 text-sm transition-colors hover:border-danger/60 hover:text-danger disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:text-fg';

/** Every installed server on this machine. Several can run at once, within the machine's RAM budget. */
export function ServersTab({
  servers,
  overview,
  selectedId,
  onSelect,
  refresh,
  onNeedEula,
}: {
  servers: ServerSummary[];
  overview: NodeOverview;
  selectedId: string | null;
  onSelect: (id: string) => void;
  refresh: () => void;
  onNeedEula: (retry: () => Promise<void>) => void;
}) {
  const api = useApi();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wipe, setWipe] = useState<{ server: ServerSummary; scope: WipeScope } | null>(null);
  const [wiped, setWiped] = useState<{ id: string; text: string } | null>(null);
  const { budgetMb, reservedMb } = overview.ram;
  const canWipe = versionAtLeast(overview.version, WIPE_SINCE);

  const act = async (id: string, fn: () => Promise<unknown>, key = id) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EULA_REQUIRED') onNeedEula(async () => void (await fn(), refresh()));
      else setError(err instanceof ApiError ? err.message : t('Unknown error.', 'Ismeretlen hiba.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-2xl text-fg-muted">
          {t(
            'Every installed modpack is a separate server, with its own world, port and join address. Several can run at once, as long as they fit in the machine’s memory budget.',
            'Minden telepített modpack külön szerver, saját világgal, porttal és csatlakozási címmel. Egyszerre több is futhat, amíg belefér a gép memóriakeretébe.',
          )}
        </p>
        <div className="shrink-0 sm:w-64">
          <p className="label flex justify-between">
            <span>{t('Memory budget', 'Memóriakeret')}</span>
            <span className="readout">
              {formatMemory(reservedMb)} / {formatMemory(budgetMb)}
            </span>
          </p>
          <div className="mt-2 h-1.5 bg-line" role="meter" aria-valuemin={0} aria-valuemax={budgetMb} aria-valuenow={reservedMb} aria-label={t('Reserved memory', 'Lefoglalt memória')}>
            <div className="h-full origin-left bg-signal" style={{ transform: `scaleX(${Math.min(1, reservedMb / Math.max(1, budgetMb))})` }} />
          </div>
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {servers.length === 0 && (
        <Panel>
          <p className="text-sm text-fg-muted">{t('No server is installed on this machine yet.', 'Még nincs telepített szerver ezen a gépen.')}</p>
        </Panel>
      )}
      <ol className="space-y-3">
        {servers.map((s, n) => {
          const selected = s.id === selectedId;
          const active = s.state === 'running' || s.state === 'starting' || s.state === 'stopping';
          const wipeHint = !canWipe
            ? t(`Needs backend v${WIPE_SINCE} or newer on this machine (it runs v${overview.version}): git pull, then restart it.`, `Ehhez a gépen legalább v${WIPE_SINCE} backend kell (most v${overview.version} fut): git pull, majd indítsd újra.`)
            : active
              ? t('Stop the server first.', 'Előbb állítsd le a szervert.')
              : null;
          return (
            <li key={s.id}>
              <Panel signal={selected} className="!py-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span className="readout hidden w-8 text-sm text-fg-faint sm:block">{String(n + 1).padStart(2, '0')}</span>
                  <button onClick={() => onSelect(s.id)} className="flex min-w-0 flex-1 items-center gap-4 text-left" title={t('Select', 'Kiválasztás')}>
                    <PackIcon src={s.iconUrl} className="size-12 shrink-0" />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{s.name}</span>
                        {selected && <Chip tone="signal">{t('Selected', 'Kiválasztva')}</Chip>}
                        {s.autoStart && <Chip>Autostart</Chip>}
                      </span>
                      <span className="label mt-1 block !normal-case !tracking-normal">
                        {[s.versionName !== s.mcVersion ? s.versionName : null, `MC ${s.mcVersion}`, LOADER_LABEL[s.loader], formatMemory(s.memoryMb), `port ${s.port}`, formatDate(s.createdAt)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="mr-2 hidden md:inline">
                      <StateLabel state={s.state} />
                    </span>
                    {s.websiteUrl && (
                      <a
                        href={s.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex size-10 items-center justify-center border border-line text-fg-muted hover:border-line-strong hover:text-fg"
                        aria-label={t('Modpack page', 'Modpack oldala')}
                      >
                        <ArrowUpRight className="size-4" />
                      </a>
                    )}
                    {active ? (
                      <>
                        <Button
                          busy={busy === `${s.id}/restart`}
                          disabled={s.state !== 'running' || busy === s.id}
                          onClick={() => act(s.id, () => api.post(`/api/v1/servers/${s.id}/restart`), `${s.id}/restart`)}
                          title={t('Stop the server and start it again', 'Leállítja, majd újra elindítja a szervert')}
                          aria-label={t(`Restart ${s.name}`, `${s.name} újraindítása`)}
                          icon={<RotateCw className="size-4" />}
                        >
                          <span className="hidden lg:inline">{t('Restart', 'Újraindítás')}</span>
                        </Button>
                        <Button
                          variant="danger"
                          busy={busy === s.id}
                          disabled={s.state === 'stopping' || busy === `${s.id}/restart`}
                          onClick={() => act(s.id, () => api.post(`/api/v1/servers/${s.id}/stop`))}
                          icon={<Square className="size-4" />}
                        >
                          {t('Stop', 'Leállítás')}
                        </Button>
                      </>
                    ) : (
                      <Button busy={busy === s.id} onClick={() => act(s.id, () => api.post(`/api/v1/servers/${s.id}/start`))} icon={<Play className="size-4" />}>
                        {t('Start', 'Indítás')}
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      disabled={active || busy !== null}
                      onClick={() => {
                        const ok = window.confirm(
                          t(`Delete ${s.name} for good?\nIts world and every file are lost permanently.`, `Biztosan törlöd: ${s.name}?\nA világ és minden fájl véglegesen elveszik.`),
                        );
                        if (ok) act(s.id, () => api.del(`/api/v1/servers/${s.id}`));
                      }}
                      title={t('Delete the whole server', 'A teljes szerver törlése')}
                      aria-label={t(`Delete ${s.name}`, `${s.name} törlése`)}
                      icon={<Trash2 className="size-4" />}
                      className="!px-3"
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
                  <span className="label">{t('Fresh start', 'Újrakezdés')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {WIPES.map((w) => (
                      <button key={w.scope} onClick={() => setWipe({ server: s, scope: w.scope })} disabled={Boolean(wipeHint) || busy !== null} title={wipeHint ?? t(w.title)} className={wipeButton}>
                        {w.icon}
                        {t(w.label)}
                      </button>
                    ))}
                  </div>
                  {wipeHint && <span className="text-xs text-fg-faint">{wipeHint}</span>}
                </div>
                {wiped?.id === s.id && (
                  <div className="mt-3">
                    <Notice tone="signal">{wiped.text}</Notice>
                  </div>
                )}
              </Panel>
            </li>
          );
        })}
      </ol>

      <WipeModal
        target={wipe}
        onClose={() => setWipe(null)}
        onDone={(id, text) => {
          setWipe(null);
          setWiped({ id, text });
          refresh();
        }}
      />
    </div>
  );
}

/** The last stop before data is deleted: what goes, what stays, and that there is no way back. */
function WipeModal({
  target,
  onClose,
  onDone,
}: {
  target: { server: ServerSummary; scope: WipeScope } | null;
  onClose: () => void;
  onDone: (serverId: string, text: string) => void;
}) {
  const api = useApi();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wipe = WIPES.find((w) => w.scope === target?.scope);

  const close = () => {
    setError(null);
    onClose();
  };

  const run = async () => {
    if (!target || !wipe) return;
    setBusy(true);
    setError(null);
    try {
      const { removed } = await api.post<{ removed: string[] }>(`/api/v1/servers/${target.server.id}/wipe`, { scope: target.scope });
      onDone(
        target.server.id,
        removed.length
          ? t(`${t(wipe.title)}: done. Deleted: ${removed.join(', ')}.`, `${t(wipe.title)}: kész. Törölve: ${removed.join(', ')}.`)
          : t('There was nothing to delete: this server is already clean.', 'Nem volt mit törölni: ez a szerver már tiszta.'),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Unknown error.', 'Ismeretlen hiba.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={target !== null} onClose={close} title={wipe ? t(wipe.title) : ''}>
      {target && wipe && (
        <div className="space-y-4 text-sm">
          <p className="readout truncate text-fg-muted">{target.server.name}</p>
          <dl className="space-y-3">
            <div className="border-l-2 border-danger/60 pl-3">
              <dt className="label !text-danger">{t('Deleted', 'Törlődik')}</dt>
              <dd className="mt-1 text-fg-muted">{t(wipe.deleted)}</dd>
            </div>
            <div className="border-l-2 border-signal/50 pl-3">
              <dt className="label !text-signal">{t('Kept', 'Megmarad')}</dt>
              <dd className="mt-1 text-fg-muted">{t(wipe.kept)}</dd>
            </div>
          </dl>
          <p className="text-fg">{t('This cannot be undone.', 'Ezt nem lehet visszavonni.')}</p>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {t('Cancel', 'Mégse')}
            </Button>
            <Button variant="danger" busy={busy} onClick={run} icon={<Trash2 className="size-4" />}>
              {t('Delete', 'Törlés')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
