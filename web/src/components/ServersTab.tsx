import { ArrowUpRight, Play, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api';
import { formatDate, formatMemory, LOADER_LABEL } from '../format';
import { useApi } from '../hub/HubProvider';
import type { NodeOverview, ServerSummary } from '../types';
import { Button, Chip, Notice, PackIcon, Panel, StateLabel } from './ui';

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { budgetMb, reservedMb } = overview.ram;

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EULA_REQUIRED') onNeedEula(async () => void (await fn(), refresh()));
      else setError(err instanceof ApiError ? err.message : 'Ismeretlen hiba.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-2xl text-fg-muted">
          Minden telepített modpack külön szerver, saját világgal, porttal és csatlakozási címmel. Egyszerre több is futhat, amíg belefér a gép memóriakeretébe.
        </p>
        <div className="shrink-0 sm:w-64">
          <p className="label flex justify-between">
            <span>Memóriakeret</span>
            <span className="readout">
              {formatMemory(reservedMb)} / {formatMemory(budgetMb)}
            </span>
          </p>
          <div className="mt-2 h-1.5 bg-line" role="meter" aria-valuemin={0} aria-valuemax={budgetMb} aria-valuenow={reservedMb} aria-label="Lefoglalt memória">
            <div className="h-full origin-left bg-signal" style={{ transform: `scaleX(${Math.min(1, reservedMb / Math.max(1, budgetMb))})` }} />
          </div>
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {servers.length === 0 && (
        <Panel>
          <p className="text-sm text-fg-muted">Még nincs telepített szerver ezen a gépen.</p>
        </Panel>
      )}
      <ol className="space-y-3">
        {servers.map((s, n) => {
          const selected = s.id === selectedId;
          const active = s.state === 'running' || s.state === 'starting' || s.state === 'stopping';
          return (
            <li key={s.id}>
              <Panel signal={selected} className="!py-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span className="readout hidden w-8 text-sm text-fg-faint sm:block">{String(n + 1).padStart(2, '0')}</span>
                  <button onClick={() => onSelect(s.id)} className="flex min-w-0 flex-1 items-center gap-4 text-left" title="Kiválasztás">
                    <PackIcon src={s.iconUrl} className="size-12 shrink-0" />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{s.name}</span>
                        {selected && <Chip tone="signal">Kiválasztva</Chip>}
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
                        aria-label="Modpack oldala"
                      >
                        <ArrowUpRight className="size-4" />
                      </a>
                    )}
                    {active ? (
                      <Button
                        variant="danger"
                        busy={busy === s.id}
                        disabled={s.state === 'stopping'}
                        onClick={() => act(s.id, () => api.post(`/api/v1/servers/${s.id}/stop`))}
                        icon={<Square className="size-4" />}
                      >
                        Leállítás
                      </Button>
                    ) : (
                      <Button busy={busy === s.id} onClick={() => act(s.id, () => api.post(`/api/v1/servers/${s.id}/start`))} icon={<Play className="size-4" />}>
                        Indítás
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      disabled={active || busy === s.id}
                      onClick={() => {
                        if (window.confirm(`Biztosan törlöd: ${s.name}?\nA világ és minden fájl véglegesen elveszik.`)) {
                          act(s.id, () => api.del(`/api/v1/servers/${s.id}`));
                        }
                      }}
                      aria-label={`${s.name} törlése`}
                      icon={<Trash2 className="size-4" />}
                      className="!px-3"
                    />
                  </div>
                </div>
              </Panel>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
