import { Package, Play, RotateCw, Skull, Square } from 'lucide-react';
import { useState } from 'react';
import { ApiError, post } from '../api';
import { formatMemory, LOADER_LABEL, uptime } from '../format';
import type { Overview } from '../types';
import { Console } from './Console';
import { Button, Notice, PackIcon, Panel, PanelTitle, StateLabel } from './ui';

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
  const [opBusy, setOpBusy] = useState<string | null>(null);

  // Some modpacks wait for an operator to set up the world, so OP is one click away.
  const toggleOp = async (player: string, isOp: boolean) => {
    setOpBusy(player);
    setError(null);
    try {
      await post('/api/admin/server/command', { command: `${isOp ? 'deop' : 'op'} ${player}` });
      setTimeout(refresh, 800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ismeretlen hiba.');
    } finally {
      setOpBusy(null);
    }
  };
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
      <Panel className="mx-auto max-w-xl py-12 text-center">
        <Package className="mx-auto mb-4 size-9 text-fg-faint" aria-hidden />
        <h2 className="text-2xl font-semibold tracking-tight">Még nincs szerver</h2>
        <p className="mx-auto mt-2 mb-6 max-w-sm text-fg-muted">Keress egy modpacket a CurseForge-on vagy a Modrinth-en, vagy indíts egy sima vanilla szervert.</p>
        <Button variant="primary" onClick={goToPacks}>
          Modpack választása
        </Button>
      </Panel>
    );
  }

  const canStart = state === 'stopped' || state === 'crashed';
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-4">
        <Panel signal={state === 'running'}>
          <PanelTitle aside={<StateLabel state={state} />}>
            Szerver
          </PanelTitle>
          <div className="flex items-center gap-4">
            <PackIcon src={instance.iconUrl} className="size-14 shrink-0" />
            <div className="min-w-0">
              <p className="line-clamp-2 font-semibold leading-snug">{instance.name}</p>
              <p className="label mt-1">
                MC {instance.mcVersion} · {LOADER_LABEL[instance.loader]} {instance.loaderVersion ?? ''}
              </p>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 border border-line">
            <div className="border-r border-line px-4 py-3">
              <dt className="label">Memória</dt>
              <dd className="readout mt-1">{formatMemory(instance.memoryMb)}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="label">Üzemidő</dt>
              <dd className="readout mt-1">{server.startedAt && state === 'running' ? uptime(server.startedAt) : '–'}</dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap gap-2">
            {canStart ? (
              <Button variant="primary" busy={busy === 'start'} onClick={() => act('start')} icon={<Play className="size-4" />} className="flex-1">
                Indítás
              </Button>
            ) : (
              <>
                <Button variant="danger" busy={busy === 'stop'} disabled={state === 'stopping'} onClick={() => act('stop')} icon={<Square className="size-4" />} className="flex-1">
                  Leállítás
                </Button>
                <Button busy={busy === 'restart'} disabled={state !== 'running'} onClick={() => act('restart')} icon={<RotateCw className="size-4" />} className="flex-1">
                  Újraindítás
                </Button>
              </>
            )}
          </div>
          {state === 'stopping' && (
            <Button variant="ghost" busy={busy === 'kill'} onClick={() => act('kill')} icon={<Skull className="size-4" />} className="mt-2 w-full">
              Kényszerített leállítás
            </Button>
          )}
          {error && (
            <div className="mt-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          {state === 'starting' && instance.loader !== 'vanilla' && <p className="mt-4 text-sm text-fg-faint">Modpackeknél az első indítás akár több percig is tarthat.</p>}
        </Panel>

        <Panel>
          <PanelTitle aside={<span className="readout text-sm text-fg-muted">{server.players.length}</span>}>
            Online játékosok
          </PanelTitle>
          {state === 'running' && server.players.length ? (
            <ul className="space-y-2">
              {server.players.map((p) => {
                const isOp = (server.ops ?? []).some((o) => o.toLowerCase() === p.toLowerCase());
                return (
                  <li key={p} className="flex items-center gap-3 border border-line bg-bg/50 py-1.5 pr-1.5 pl-2">
                    <img src={`https://mc-heads.net/avatar/${encodeURIComponent(p)}/28`} alt="" className="pixel size-7" />
                    <span className="readout min-w-0 flex-1 truncate text-sm">{p}</span>
                    <button
                      onClick={() => toggleOp(p, isOp)}
                      disabled={opBusy === p}
                      title={isOp ? 'Operátori jog elvétele (deop)' : 'Operátori jog adása (op)'}
                      aria-pressed={isOp}
                      className={`h-7 border px-2 font-mono text-[11px] tracking-[0.06em] uppercase transition-colors disabled:opacity-40 ${
                        isOp ? 'border-signal/40 bg-signal-dim text-signal' : 'border-line-strong text-fg-faint hover:text-fg'
                      }`}
                    >
                      {isOp ? 'OP ✓' : 'OP'}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-fg-faint">{state === 'running' ? 'Most senki sincs fent.' : 'A szerver nem fut.'}</p>
          )}
        </Panel>
      </div>

      <div className="lg:col-span-8">
        <Panel className="!p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3 sm:px-6">
            <h2 className="label !text-fg-muted">
              Konzol
            </h2>
            <span className="label hidden sm:inline">↑ ↓ parancselőzmények</span>
          </div>
          <Console canSend={state === 'running' || state === 'starting'} />
        </Panel>
      </div>
    </div>
  );
}
