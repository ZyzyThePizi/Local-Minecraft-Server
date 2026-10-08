import { Download, ExternalLink, KeyRound, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, get, post } from '../api';
import { compactNumber, formatDate } from '../format';
import { useDebounced } from '../hooks';
import type { Job, PackSummary, PackVersion, Source } from '../types';
import { JobProgress } from './JobProgress';
import { Button, Card, Chip, inputClass, Modal, Notice, PackIcon, Segmented } from './ui';

export function PacksTab({
  curseforgeConfigured,
  onInstalled,
  onStartServer,
}: {
  curseforgeConfigured: boolean;
  onInstalled: () => void;
  onStartServer: () => void;
}) {
  const [source, setSource] = useState<Source>(curseforgeConfigured ? 'curseforge' : 'modrinth');
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 400);
  const [results, setResults] = useState<PackSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PackSummary | null>(null);
  const [job, setJob] = useState<Job | null>(null);

  // Pick up an install that is still running (e.g. after a page reload).
  useEffect(() => {
    get<{ job: Job | null }>('/api/admin/jobs/latest/install')
      .then(({ job: j }) => j?.state === 'running' && setJob(j))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (source === 'vanilla') return;
    let alive = true;
    setLoading(true);
    setError(null);
    get<{ results: PackSummary[] }>(`/api/admin/packs/search?source=${source}&q=${encodeURIComponent(q)}`)
      .then((r) => alive && setResults(r.results))
      .catch((err: ApiError) => {
        if (!alive) return;
        setError(err);
        setResults(null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, q]);

  const install = async (pack: { source: Source; projectId?: string; versionId: string; name: string }) => {
    const res = await post<{ job: Job }>('/api/admin/packs/install', pack);
    setSelected(null);
    setJob(res.job);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onFinished = useCallback(
    (j: Job) => {
      if (j.state === 'done') onInstalled();
    },
    [onInstalled],
  );

  const installing = job?.state === 'running';
  return (
    <div className="space-y-5">
      {job && <JobProgress key={job.id} initial={job} onFinished={onFinished} onStart={onStartServer} onDismiss={() => setJob(null)} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented
          value={source}
          onChange={(v) => {
            setSource(v);
            setResults(null);
          }}
          options={[
            { value: 'curseforge', label: 'CurseForge' },
            { value: 'modrinth', label: 'Modrinth' },
            { value: 'vanilla', label: 'Vanilla' },
          ]}
        />
        {source !== 'vanilla' && (
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Keresés a ${source === 'curseforge' ? 'CurseForge' : 'Modrinth'} modpackek között…`}
              className={`${inputClass} h-11 pl-9`}
              aria-label="Modpack keresése"
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
          {!q && <p className="text-sm text-muted">Legnépszerűbb modpackek. Kattints egyre a telepítéshez.</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loading && !results
              ? Array.from({ length: 6 }, (_, i) => <div key={i} className="h-36 animate-pulse rounded-2xl border border-line bg-surface" />)
              : results?.map((p) => <PackCard key={p.id} pack={p} onClick={() => setSelected(p)} />)}
          </div>
          {results?.length === 0 && <p className="py-8 text-center text-muted">Nincs találat erre: „{q}”.</p>}
        </>
      )}

      <VersionPicker pack={selected} onClose={() => setSelected(null)} disabled={installing} onInstall={install} />
    </div>
  );
}

function PackCard({ pack, onClick }: { pack: PackSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-2"
    >
      <div className="flex items-start gap-3">
        <PackIcon src={pack.iconUrl} className="size-14 shrink-0" />
        <div className="min-w-0">
          <p className="line-clamp-2 font-semibold group-hover:text-accent">{pack.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {pack.author && `${pack.author} · `}
            <Download className="inline size-3 align-[-1px]" aria-hidden /> {compactNumber(pack.downloads)}
          </p>
        </div>
      </div>
      <p className="line-clamp-2 text-sm text-muted">{pack.summary}</p>
      <div className="mt-auto flex flex-wrap gap-1.5">
        {pack.loaders.slice(0, 2).map((l) => (
          <Chip key={l} tone="info">
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
    get<{ versions: PackVersion[] }>(`/api/admin/packs/versions?source=${pack.source}&id=${encodeURIComponent(pack.id)}`)
      .then(({ versions: v }) => {
        setVersions(v);
        setVersionId((v.find((x) => x.type === 'release') ?? v[0])?.id ?? '');
      })
      .catch((err: ApiError) => setError(err.message));
  }, [pack]);

  const visible = versions?.filter((v) => showAll || v.type === 'release') ?? [];
  const current = versions?.find((v) => v.id === versionId);

  const go = async () => {
    if (!pack || !versionId) return;
    setBusy(true);
    setError(null);
    try {
      await onInstall({ source: pack.source, projectId: pack.id, versionId, name: pack.name });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ismeretlen hiba.');
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
              <p className="text-muted">{pack.summary}</p>
              {pack.websiteUrl && (
                <a href={pack.websiteUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-accent hover:underline">
                  Megnyitás a {pack.source === 'curseforge' ? 'CurseForge' : 'Modrinth'} oldalon <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>

          {!versions && !error && <div className="h-10 animate-pulse rounded-lg bg-surface-2" />}
          {versions && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="pack-version" className="text-sm font-medium">
                  Verzió
                </label>
                {versions.some((v) => v.type !== 'release') && (
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-[var(--color-accent)]" />
                    Béta verziók is
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
                    <Chip key={l} tone="info">
                      {l}
                    </Chip>
                  ))}
                  <Chip>{formatDate(current.date)}</Chip>
                  {current.hasServerPack && <Chip tone="accent">Hivatalos szervercsomag</Chip>}
                </div>
              )}
            </div>
          )}

          <p className="text-xs leading-relaxed text-muted">
            A telepítés egy új szervert hoz létre, a mostani megmarad, és a Szerverek fülön bármikor visszaválthatsz rá. A
            kliens-oldali modokat (shaderek, minimapek, stb.) automatikusan kihagyom, a megfelelő Java verziót is letöltöm.
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
          {disabled && <Notice tone="warn">Már fut egy telepítés, várd meg, amíg befejeződik.</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Mégse
            </Button>
            <Button variant="primary" busy={busy} disabled={!versionId || disabled} onClick={go} icon={<Download className="size-4" />}>
              Telepítés a szerverre
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function VanillaPicker({ onInstall, disabled }: { onInstall: (version: string) => Promise<void>; disabled: boolean }) {
  const [versions, setVersions] = useState<PackVersion[] | null>(null);
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ versions: PackVersion[] }>('/api/admin/packs/versions?source=vanilla')
      .then(({ versions: v }) => {
        setVersions(v);
        setVersion(v[0]?.id ?? '');
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onInstall(version);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ismeretlen hiba.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <h2 className="font-semibold">Vanilla szerver</h2>
      <p className="mt-1 mb-4 text-sm text-muted">Mod nélküli, hivatalos Minecraft szerver a Mojangtól.</p>
      <div className="flex gap-2">
        <select value={version} onChange={(e) => setVersion(e.target.value)} className={inputClass} disabled={!versions} aria-label="Minecraft verzió">
          {versions?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.id}
            </option>
          ))}
        </select>
        <Button variant="primary" busy={busy} disabled={!version || disabled} onClick={go} icon={<Download className="size-4" />}>
          Telepítés
        </Button>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </Card>
  );
}

function CurseForgeKeyHelp({ invalid }: { invalid: boolean }) {
  return (
    <Card className="max-w-2xl">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div className="space-y-3 text-sm">
          <p className="font-semibold">{invalid ? 'A CurseForge API kulcs érvénytelen' : 'CurseForge API kulcs szükséges'}</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-muted">
            <li>
              Lépj be a{' '}
              <a href="https://console.curseforge.com/" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                console.curseforge.com
              </a>{' '}
              oldalon (ingyenes).
            </li>
            <li>Az „API Keys” menüben másold ki a kulcsot.</li>
            <li>
              Írd be a backend gépen a <code className="rounded bg-bg px-1 font-mono">backend/.env</code> fájlba:{' '}
              <code className="rounded bg-bg px-1 font-mono">CURSEFORGE_API_KEY='…'</code>
            </li>
            <li>Indítsd újra a backendet.</li>
          </ol>
          <p className="text-muted">Addig a Modrinth fülön ugyanígy kereshetsz és telepíthetsz modpackeket.</p>
        </div>
      </div>
    </Card>
  );
}
