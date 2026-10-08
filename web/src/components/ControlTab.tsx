import { Clock, MemoryStick, Package, Play, RotateCw, Skull, Square } from 'lucide-react';
import { useState } from 'react';
import { ApiError, post } from '../api';
import { formatMemory, LOADER_LABEL, uptime } from '../format';
import type { Overview } from '../types';
import { Console } from './Console';
import { Button, Card, CardTitle, Chip, Notice, PackIcon } from './ui';

export function ControlTab({
  overview,
  refresh,
  onNeedEula,
  goToPacks,
}: {
  overview: Overview;
  refresh: () => void;
  onNeedEula: (retry: () => Promise<void>) => void;
  goToPacks: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { server, instance } = overview;
  const state = server.state;

  const act = async (action: 'start' | 'stop' | 'restart' | 'kill') => {
    setBusy(action);
    setError(null);
    const run = async () => {
      if (action === 'kill') await post('/api/admin/server/stop', { force: true });
      else await post(`/api/admin/server/${action}`);
      refresh();
    };
    try {
      await run();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EULA_REQUIRED') onNeedEula(run);
      else setError(err instanceof ApiError ? err.message : 'Ismeretlen hiba.');
    } finally {
      setBusy(null);
    }
  };

  if (!instance) {
    return (
      <Card className="py-10 text-center">
        <Package className="mx-auto mb-3 size-10 text-muted" aria-hidden />
        <h2 className="text-lg font-semibold">Még nincs szerver</h2>
        <p className="mx-auto mt-1 mb-5 max-w-sm text-sm text-muted">Keress egy modpacket a CurseForge-on vagy a Modrinth-en, vagy indíts egy sima vanilla szervert.</p>
        <Button variant="primary" onClick={goToPacks}>
          Modpack választása
        </Button>
      </Card>
    );
  }

  const canStart = state === 'stopped' || state === 'crashed';
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <PackIcon src={instance.iconUrl} className="size-14 shrink-0" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{instance.name}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Chip>MC {instance.mcVersion}</Chip>
                <Chip tone="info">
                  {LOADER_LABEL[instance.loader]} {instance.loaderVersion ?? ''}
                </Chip>
                <Chip>
                  <MemoryStick className="mr-1 size-3" aria-hidden />
                  {formatMemory(instance.memoryMb)}
                </Chip>
                {server.startedAt && state === 'running' && (
                  <Chip tone="accent">
                    <Clock className="mr-1 size-3" aria-hidden />
                    {uptime(server.startedAt)}
                  </Chip>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canStart ? (
              <Button variant="primary" busy={busy === 'start'} onClick={() => act('start')} icon={<Play className="size-4" />} className="min-w-32">
                Indítás
              </Button>
            ) : (
              <>
                <Button
                  variant="danger"
                  busy={busy === 'stop'}
                  disabled={state === 'stopping'}
                  onClick={() => act('stop')}
                  icon={<Square className="size-4" />}
                >
                  Leállítás
                </Button>
                <Button busy={busy === 'restart'} disabled={state !== 'running'} onClick={() => act('restart')} icon={<RotateCw className="size-4" />}>
                  Újraindítás
                </Button>
                {state === 'stopping' && (
                  <Button variant="ghost" busy={busy === 'kill'} onClick={() => act('kill')} icon={<Skull className="size-4" />}>
                    Kényszerített leállítás
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        {error && (
          <div className="mt-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        {state === 'starting' && instance.loader !== 'vanilla' && (
          <p className="mt-4 text-sm text-muted">Modpackeknél az első indítás akár több percig is tarthat.</p>
        )}
      </Card>

      {state === 'running' && (
        <Card>
          <CardTitle>Online játékosok ({server.players.length})</CardTitle>
          {server.players.length ? (
            <div className="flex flex-wrap gap-2">
              {server.players.map((p) => (
                <span key={p} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 py-1 pr-3 pl-1 text-sm">
                  <img src={`https://mc-heads.net/avatar/${encodeURIComponent(p)}/24`} alt="" className="pixel size-6 rounded" />
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Most senki sincs fent.</p>
          )}
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-base font-semibold">Konzol</h2>
        <Console canSend={state === 'running' || state === 'starting'} />
      </div>
    </div>
  );
}
