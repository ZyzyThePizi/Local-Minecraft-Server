import { ArrowUpRight, CheckCircle2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, del, get, post } from '../api';
import { formatDate, formatMemory, LOADER_LABEL } from '../format';
import { usePoll } from '../hooks';
import type { InstanceSummary, Overview } from '../types';
import { Button, Chip, Notice, PackIcon, Panel, Skeleton } from './ui';

export function InstancesTab({ overview, refresh }: { overview: Overview; refresh: () => void }) {
  const list = usePoll(() => get<{ instances: InstanceSummary[]; activeInstanceId: string | null }>('/api/admin/instances'), 10_000, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningId = overview.server.state === 'stopped' || overview.server.state === 'crashed' ? null : overview.server.instanceId;

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      list.refresh();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ismeretlen hiba.');
    } finally {
      setBusy(null);
    }
  };

  if (!list.data) return <Skeleton className="h-40" />;
  const { instances, activeInstanceId } = list.data;

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-fg-muted">Minden telepített modpack külön szerver, saját világgal. Egyszerre egy lehet aktív, a nyilvános oldal mindig azt mutatja.</p>
      {error && <Notice tone="danger">{error}</Notice>}
      {instances.length === 0 && (
        <Panel>
          <p className="text-sm text-fg-muted">Még nincs telepített szerver.</p>
        </Panel>
      )}
      <ol className="space-y-3">
        {instances.map((i, n) => {
          const active = i.id === activeInstanceId;
          const running = i.id === runningId;
          return (
            <li key={i.id}>
              <Panel signal={active} className="!py-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span className="readout hidden w-8 text-sm text-fg-faint sm:block">{String(n + 1).padStart(2, '0')}</span>
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <PackIcon src={i.iconUrl} className="size-12 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{i.name}</p>
                        {active && <Chip tone="signal">Aktív</Chip>}
                        {running && <Chip tone="warn">Fut</Chip>}
                      </div>
                      <p className="label mt-1 !normal-case !tracking-normal">
                        {[i.versionName !== i.mcVersion ? i.versionName : null, `MC ${i.mcVersion}`, LOADER_LABEL[i.loader], formatMemory(i.memoryMb), formatDate(i.createdAt)]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {i.websiteUrl && (
                      <a
                        href={i.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex size-10 items-center justify-center border border-line text-fg-muted hover:border-line-strong hover:text-fg"
                        aria-label="Modpack oldala"
                      >
                        <ArrowUpRight className="size-4" />
                      </a>
                    )}
                    {!active && (
                      <Button
                        busy={busy === i.id}
                        disabled={runningId !== null}
                        title={runningId ? 'Előbb állítsd le a futó szervert' : undefined}
                        onClick={() => act(i.id, () => post(`/api/admin/instances/${i.id}/activate`))}
                        icon={<CheckCircle2 className="size-4" />}
                      >
                        Aktiválás
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      disabled={running || busy === i.id}
                      onClick={() => {
                        if (window.confirm(`Biztosan törlöd: ${i.name}?\nA világ és minden fájl véglegesen elveszik.`)) {
                          act(i.id, () => del(`/api/admin/instances/${i.id}`));
                        }
                      }}
                      aria-label={`${i.name} törlése`}
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
