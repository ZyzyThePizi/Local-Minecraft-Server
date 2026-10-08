import { CheckCircle2, ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, del, get, post } from '../api';
import { formatDate, formatMemory, LOADER_LABEL } from '../format';
import { usePoll } from '../hooks';
import type { InstanceSummary, Overview } from '../types';
import { Button, Card, Chip, Notice, PackIcon } from './ui';

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

  if (!list.data) return <div className="h-40 animate-pulse rounded-2xl border border-line bg-surface" />;
  const { instances, activeInstanceId } = list.data;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Minden telepített modpack külön szerver, saját világgal. Egyszerre egy lehet aktív, a nyilvános oldal mindig azt mutatja.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      {instances.length === 0 && (
        <Card>
          <p className="text-sm text-muted">Még nincs telepített szerver.</p>
        </Card>
      )}
      {instances.map((i) => {
        const active = i.id === activeInstanceId;
        const running = i.id === runningId;
        return (
          <Card key={i.id} className={active ? 'border-accent/40' : ''}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <PackIcon src={i.iconUrl} className="size-12 shrink-0" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold">{i.name}</p>
                    {active && <Chip tone="accent">Aktív</Chip>}
                    {running && <Chip tone="warn">Fut</Chip>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {[i.versionName !== i.mcVersion ? i.versionName : null, `MC ${i.mcVersion}`, LOADER_LABEL[i.loader], formatMemory(i.memoryMb), `telepítve: ${formatDate(i.createdAt)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {i.websiteUrl && (
                  <a href={i.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Modpack oldala">
                    <ExternalLink className="size-4" />
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
                />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
