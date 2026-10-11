import { ArrowUpRight, Download, KeyRound, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api';
import { useApi } from '../hub/HubProvider';
import { compactNumber, formatDate } from '../format';
import { useDebounced } from '../hooks';
import { useLang, useT } from '../i18n';
import type { Job, PackSummary, PackVersion, Source } from '../types';
import { JobProgress } from './JobProgress';
import { Button, Chip, inputClass, Modal, Notice, PackIcon, Panel, PanelTitle, Skeleton, Tabs } from './ui';

const SOURCE_LABEL: Record<Source, string> = { curseforge: 'CurseForge', modrinth: 'Modrinth', vanilla: 'Vanilla' };

export function PacksTab({
  curseforgeConfigured,
  onInstalled,
  onStartServer,
}: {
  curseforgeConfigured: boolean;
  onInstalled: () => void;
  /** Opens the freshly installed server on the control tab. */
  onStartServer: (serverId: string) => void;
}) {
  const [source, setSource] = useState<Source>(curseforgeConfigured ? 'curseforge' : 'modrinth');
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 400);
  const [results, setResults] = useState<PackSummary[] | null>(null);
  const [via, setVia] = useState<'official' | 'mirror' | 'direct'>('official');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PackSummary | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const api = useApi();
  const t = useT();
  const lang = useLang();

  // Pick up an install that is still running (e.g. after a page reload).
  useEffect(() => {
    api
      .get<{ job: Job | null }>('/api/v1/jobs/latest/install')
      .then(({ job: j }) => j?.state === 'running' && setJob(j))
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    if (source === 'vanilla') return;
    let alive = true;
    setLoading(true);
    setError(null);
    api.get<{ results: PackSummary[]; via: 'official' | 'mirror' | 'direct' }>(`/api/v1/packs/search?source=${source}&q=${encodeURIComponent(q)}`)
      .then((r) => {
        if (!alive) return;
        setResults(r.results);
        setVia(r.via);
      })
      .catch((err: ApiError) => {
        if (!alive) return;
        setError(err);
        setResults(null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [api, source, q, lang]);

  const install = async (pack: { source: Source; projectId?: string; versionId: string; name: string }) => {
    const res = await api.post<{ job: Job }>('/api/v1/packs/install', pack);
    setSelected(null);
    setJob(res.job);
    onInstalled();
  };

  const onFinished = useCallback(
    (j: Job) => {
      if (j.state === 'done') onInstalled();
    },
    [onInstalled],
  );

  const installing = job?.state === 'running';
  return (
    <div className="space-y-6">
      {job && <JobProgress key={job.id} initial={job} onFinished={onFinished} onStart={(id) => onStartServer(id)} onDismiss={() => setJob(null)} />}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs
          label={t('Source', 'Forrás')}
          value={source}
          onChange={(v) => {
            setSource(v);
            setResults(null);
          }}
          options={(['curseforge', 'modrinth', 'vanilla'] as const).map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
        />
        {source !== 'vanilla' && (
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                source === 'curseforge'
                  ? t('Search by name, or paste a CurseForge link / project ID…', 'Keresés név alapján, vagy illeszd be a CurseForge linket / projekt ID-t…')
                  : t('Search the Modrinth modpacks…', 'Keresés a Modrinth modpackek között…')
              }
              className={`${inputClass} pl-9`}
              aria-label={t('Search modpacks', 'Modpack keresése')}
            />
          </div>
        )}
      </div>

      {source === 'vanilla' ? (
        <VanillaPicker disabled={installing} onInstall={(v) => install({ source: 'vanilla', versionId: v, name: `Vanilla ${v}` })} />
      ) : error?.code === 'CURSEFORGE_KEY_MISSING' || error?.code === 'CURSEFORGE_KEY_INVALID' ? (
        <CurseForgeKeyHelp invalid={error.code === 'CURSEFORGE_KEY_INVALID'} />
      ) : error ? (
        <Notice tone="danger">{error.message}</Notice>
      ) : (
        <>
          <p className="label">
            {via === 'direct'
              ? t('The pasted modpack', 'A beillesztett modpack')
              : q
                ? t(`Results for “${q}”`, `Találatok: „${q}”`)
                : t('Most popular modpacks · click one to install it', 'Legnépszerűbb modpackek · kattints egyre a telepítéshez')}
          </p>
          {source === 'curseforge' && via === 'mirror' && (
            <Notice>
              {t(
                'CurseForge does not let your key search, so the search runs on a public mirror (api.curse.tools). The modpack details and the download still go through the official API with your own key. A new key generated in the CurseForge console can search officially again.',
                'A CurseForge a kulcsodnak nem ad jogot a keresésre, ezért a keresés egy nyilvános tükrön (api.curse.tools) fut. A modpack adatai és a letöltés továbbra is a hivatalos API-n, a saját kulcsoddal mennek. Ha a CurseForge konzolon új kulcsot generálsz, a kulcs újra kereshet hivatalosan.',
              )}
            </Notice>
          )}
          <div className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
            {loading && !results
              ? Array.from({ length: 6 }, (_, i) => <div key={i} className="h-44 animate-pulse bg-surface/80" />)
              : results?.map((p) => <PackCard key={p.id} pack={p} onClick={() => setSelected(p)} />)}
          </div>
          {results?.length === 0 && <p className="py-8 text-center text-fg-muted">{t(`No results for “${q}”.`, `Nincs találat erre: „${q}”.`)}</p>}
        </>
      )}

      <VersionPicker pack={selected} onClose={() => setSelected(null)} disabled={installing} onInstall={install} />
    </div>
  );
}

function PackCard({ pack, onClick }: { pack: PackSummary; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex flex-col gap-3 bg-surface/90 p-5 text-left transition-colors hover:bg-surface-2">
      <div className="flex items-start gap-3">
        <PackIcon src={pack.iconUrl} className="size-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 leading-snug font-semibold transition-colors group-hover:text-signal">{pack.name}</p>
          <p className="label mt-1 truncate">
            {pack.author && `${pack.author} · `}↓ {compactNumber(pack.downloads)}
          </p>
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-fg-faint transition-colors group-hover:text-signal" aria-hidden />
      </div>
      <p className="line-clamp-2 text-sm text-fg-muted">{pack.summary}</p>
      <div className="mt-auto flex flex-wrap gap-1.5">
        {pack.loaders.slice(0, 2).map((l) => (
          <Chip key={l} tone="signal">
            {l}
          </Chip>
        ))}
        {pack.mcVersions.slice(0, 3).map((v) => (
          <Chip key={v}>{v}</Chip>
        ))}
      </div>
    </button>
  );
}

function VersionPicker({
  pack,
  onClose,
  onInstall,
  disabled,
}: {
  pack: PackSummary | null;
  onClose: () => void;
  onInstall: (p: { source: Source; projectId: string; versionId: string; name: string }) => Promise<void>;
  disabled: boolean;
}) {
  const api = useApi();
  const t = useT();
  const [versions, setVersions] = useState<PackVersion[] | null>(null);
  const [versionId, setVersionId] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pack) return;
    setVersions(null);
    setError(null);
    setShowAll(false);
    api.get<{ versions: PackVersion[] }>(`/api/v1/packs/versions?source=${pack.source}&id=${encodeURIComponent(pack.id)}`)
      .then(({ versions: v }) => {
        setVersions(v);
        setVersionId((v.find((x) => x.type === 'release') ?? v[0])?.id ?? '');
      })
      .catch((err: ApiError) => setError(err.message));
  }, [api, pack]);

  const visible = versions?.filter((v) => showAll || v.type === 'release' || v.id === versionId) ?? [];
  const current = versions?.find((v) => v.id === versionId);

  const go = async () => {
    if (!pack || !versionId) return;
    setBusy(true);
    setError(null);
    try {
      await onInstall({ source: pack.source, projectId: pack.id, versionId, name: pack.name });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Unknown error.', 'Ismeretlen hiba.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={pack !== null} onClose={onClose} title={pack?.name ?? ''} wide>
      {pack && (
        <div className="space-y-5">
          <div className="flex gap-4">
            <PackIcon src={pack.iconUrl} className="size-16 shrink-0" />
            <div className="min-w-0 text-sm">
              <p className="text-fg-muted">{pack.summary}</p>
              {pack.websiteUrl && (
                <a href={pack.websiteUrl} target="_blank" rel="noreferrer" className="label mt-2 inline-flex items-center gap-1 !text-signal hover:underline">
                  {t(`${SOURCE_LABEL[pack.source]} page`, `${SOURCE_LABEL[pack.source]} oldal`)} <ArrowUpRight className="size-3.5" />
                </a>
              )}
            </div>
          </div>

          {!versions && !error && <Skeleton className="h-10" />}
          {versions && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="pack-version" className="label">
                  {t('Version', 'Verzió')}
                </label>
                {versions.some((v) => v.type !== 'release') && (
                  <label className="label flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-signal" />
                    {t('Include beta versions', 'Béta verziók is')}
                  </label>
                )}
              </div>
              <select id="pack-version" value={versionId} onChange={(e) => setVersionId(e.target.value)} className={inputClass}>
                {visible.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · MC {v.mcVersions[0] ?? '?'}
                    {v.type !== 'release' ? ` (${v.type})` : ''}
                  </option>
                ))}
              </select>
              {current && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {current.mcVersions.slice(0, 2).map((v) => (
                    <Chip key={v}>MC {v}</Chip>
                  ))}
                  {current.loaders.map((l) => (
                    <Chip key={l} tone="signal">
                      {l}
                    </Chip>
                  ))}
                  <Chip>{formatDate(current.date)}</Chip>
                  {current.hasServerPack && <Chip tone="signal">{t('Official server pack', 'Hivatalos szervercsomag')}</Chip>}
                </div>
              )}
            </div>
          )}

          <p className="border-t border-line pt-4 text-xs leading-relaxed text-fg-faint">
            {t(
              'The install creates a new server; your current ones stay, and you can switch between them on the Servers tab. Client-side mods (shaders, minimaps and the like) are left out, and the right Java version is downloaded.',
              'A telepítés egy új szervert hoz létre, a mostani megmarad, és a Szerverek fülön bármikor visszaválthatsz rá. A kliens-oldali modokat (shaderek, minimapek stb.) kihagyom, a megfelelő Java verziót letöltöm.',
            )}
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
          {disabled && <Notice tone="warn">{t('An install is already running, wait until it finishes.', 'Már fut egy telepítés, várd meg, amíg befejeződik.')}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('Cancel', 'Mégse')}
            </Button>
            <Button variant="primary" busy={busy} disabled={!versionId || disabled} onClick={go} icon={<Download className="size-4" />}>
              {t('Install on the machine', 'Telepítés a szerverre')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function VanillaPicker({ onInstall, disabled }: { onInstall: (version: string) => Promise<void>; disabled: boolean }) {
  const api = useApi();
  const t = useT();
  const [versions, setVersions] = useState<PackVersion[] | null>(null);
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ versions: PackVersion[] }>('/api/v1/packs/versions?source=vanilla')
      .then(({ versions: v }) => {
        setVersions(v);
        setVersion(v[0]?.id ?? '');
      })
      .catch((err: ApiError) => setError(err.message));
  }, [api]);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onInstall(version);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Unknown error.', 'Ismeretlen hiba.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="max-w-xl">
      <PanelTitle>{t('Vanilla server', 'Vanilla szerver')}</PanelTitle>
      <p className="mb-5 text-fg-muted">{t('The official Minecraft server from Mojang, without mods.', 'Mod nélküli, hivatalos Minecraft szerver a Mojangtól.')}</p>
      <div className="flex">
        <select value={version} onChange={(e) => setVersion(e.target.value)} className={`${inputClass} border-r-0`} disabled={!versions} aria-label={t('Minecraft version', 'Minecraft verzió')}>
          {versions?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.id}
            </option>
          ))}
        </select>
        <Button variant="primary" busy={busy} disabled={!version || disabled} onClick={go} icon={<Download className="size-4" />}>
          {t('Install', 'Telepítés')}
        </Button>
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </Panel>
  );
}

function CurseForgeKeyHelp({ invalid }: { invalid: boolean }) {
  const t = useT();
  return (
    <Panel className="max-w-2xl">
      <PanelTitle aside={<KeyRound className="size-4 text-warn" aria-hidden />}>
        {invalid ? t('The CurseForge API key is invalid', 'A CurseForge API kulcs érvénytelen') : t('A CurseForge API key is needed', 'CurseForge API kulcs szükséges')}
      </PanelTitle>
      <ol className="space-y-3 text-sm text-fg-muted">
        {[
          <>
            {t('Sign in at', 'Lépj be a')}{' '}
            <a href="https://console.curseforge.com/" target="_blank" rel="noreferrer" className="text-signal hover:underline">
              console.curseforge.com
            </a>{' '}
            {t('(it is free).', 'oldalon (ingyenes).')}
          </>,
          <>{t('Copy the key from the “API Keys” menu.', 'Az „API Keys” menüben másold ki a kulcsot.')}</>,
          <>
            {t('On the backend machine, put it into the', 'Írd be a backend gépen a')} <code className="readout bg-bg px-1 text-fg">backend/.env</code> {t('file:', 'fájlba:')}{' '}
            <code className="readout bg-bg px-1 text-fg">CURSEFORGE_API_KEY='…'</code>
          </>,
          <>{t('Save it. The backend notices by itself; no restart is needed.', 'Mentsd el. A backend magától észreveszi, újraindítás nem kell.')}</>,
        ].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="readout text-signal">{String(i + 1).padStart(2, '0')}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t border-line pt-4 text-sm text-fg-faint">
        {t('Until then you can search and install modpacks the same way on the Modrinth tab.', 'Addig a Modrinth fülön ugyanígy kereshetsz és telepíthetsz modpackeket.')}
      </p>
    </Panel>
  );
}
