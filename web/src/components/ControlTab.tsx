import { Package, Play, RotateCw, Skull, Square } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api';
import { useApi } from '../hub/HubProvider';
import { formatMemory, LOADER_LABEL, uptime } from '../format';
import { useT } from '../i18n';
import type { KnownPlayer, ServerSummary } from '../types';
import { Console } from './Console';
import { PlayersPanel } from './PlayersPanel';
import { QuickCommands } from './QuickCommands';
import { Button, Notice, PackIcon, Panel, PanelTitle, StateLabel } from './ui';

export function ControlTab({
  server,
  refresh,
  onNeedEula,
  goToPacks,
}: {
  server: ServerSummary | null;
  refresh: () => void;
  onNeedEula: (retry: () => Promise<void>) => void;
  goToPacks: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The player the quick commands act on; clicking a name in the players list fills it.
  const [target, setTarget] = useState('');
  const [known, setKnown] = useState<KnownPlayer[]>([]);
  const api = useApi();
  const t = useT();

  const act = async (action: 'start' | 'stop' | 'restart' | 'kill') => {
    setBusy(action);
    setError(null);
    const run = async () => {
      if (!server) return;
      if (action === 'kill') await api.post(`/api/v1/servers/${server.id}/stop`, { force: true });
      else await api.post(`/api/v1/servers/${server.id}/${action}`);
      refresh();
    };
    try {
      await run();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EULA_REQUIRED') onNeedEula(run);
      else setError(err instanceof ApiError ? err.message : t('Unknown error.', 'Ismeretlen hiba.'));
    } finally {
      setBusy(null);
    }
  };

  if (!server) {
    return (
      <Panel className="mx-auto max-w-xl py-12 text-center">
        <Package className="mx-auto mb-4 size-9 text-fg-faint" aria-hidden />
        <h2 className="text-2xl font-semibold tracking-tight">{t('No server yet', 'Még nincs szerver')}</h2>
        <p className="mx-auto mt-2 mb-6 max-w-sm text-fg-muted">
          {t('Find a modpack on CurseForge or Modrinth, or start a plain vanilla server.', 'Keress egy modpacket a CurseForge-on vagy a Modrinth-en, vagy indíts egy sima vanilla szervert.')}
        </p>
        <Button variant="primary" onClick={goToPacks}>
          {t('Choose a modpack', 'Modpack választása')}
        </Button>
      </Panel>
    );
  }

  const instance = server;
  const state = server.state;
  const canStart = state === 'stopped' || state === 'crashed';
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="min-w-0 space-y-5 lg:col-span-4">
        <Panel signal={state === 'running'}>
          <PanelTitle aside={<StateLabel state={state} />}>{t('Server', 'Szerver')}</PanelTitle>
          <div className="flex items-center gap-4">
            <PackIcon src={instance.iconUrl} className="size-14 shrink-0" />
            <div className="min-w-0">
              <p className="line-clamp-2 font-semibold leading-snug">{instance.name}</p>
              <p className="label mt-1">
                MC {instance.mcVersion} · {LOADER_LABEL[instance.loader]} {instance.loaderVersion ?? ''}
              </p>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-3 border border-line">
            <div className="border-r border-line px-4 py-3">
              <dt className="label">{t('Memory', 'Memória')}</dt>
              <dd className="readout mt-1">{formatMemory(instance.memoryMb)}</dd>
            </div>
            <div className="border-r border-line px-4 py-3">
              <dt className="label">Port</dt>
              <dd className="readout mt-1">{instance.port}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="label">{t('Uptime', 'Üzemidő')}</dt>
              <dd className="readout mt-1">{server.startedAt && state === 'running' ? uptime(server.startedAt) : '–'}</dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap gap-2">
            {canStart ? (
              <Button variant="primary" busy={busy === 'start'} onClick={() => act('start')} icon={<Play className="size-4" />} className="flex-1">
                {t('Start', 'Indítás')}
              </Button>
            ) : (
              <>
                <Button variant="danger" busy={busy === 'stop'} disabled={state === 'stopping'} onClick={() => act('stop')} icon={<Square className="size-4" />} className="flex-1">
                  {t('Stop', 'Leállítás')}
                </Button>
                <Button busy={busy === 'restart'} disabled={state !== 'running'} onClick={() => act('restart')} icon={<RotateCw className="size-4" />} className="flex-1">
                  {t('Restart', 'Újraindítás')}
                </Button>
              </>
            )}
          </div>
          {state === 'stopping' && (
            <Button variant="ghost" busy={busy === 'kill'} onClick={() => act('kill')} icon={<Skull className="size-4" />} className="mt-2 w-full">
              {t('Force stop', 'Kényszerített leállítás')}
            </Button>
          )}
          {error && (
            <div className="mt-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          {state === 'starting' && instance.loader !== 'vanilla' && <p className="mt-4 text-sm text-fg-faint">{t('With modpacks the first start can take several minutes.', 'Modpackeknél az első indítás akár több percig is tarthat.')}</p>}
        </Panel>

        <PlayersPanel key={server.id} serverId={server.id} state={state} target={target} onTarget={setTarget} onPlayers={setKnown} />
      </div>

      <div className="min-w-0 space-y-5 lg:col-span-8">
        <Panel className="!p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3 sm:px-6">
            <h2 className="label !text-fg-muted">{t('Console', 'Konzol')}</h2>
            <span className="label hidden sm:inline">↑ ↓ {t('command history', 'parancselőzmények')}</span>
          </div>
          <Console key={server.id} serverId={server.id} canSend={state === 'running' || state === 'starting'} />
        </Panel>
        <QuickCommands key={server.id} server={server} known={known} canSend={state === 'running'} target={target} onTarget={setTarget} />
      </div>
    </div>
  );
}
