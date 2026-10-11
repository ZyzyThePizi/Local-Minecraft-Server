import { Eraser } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../api';
import { useApi } from '../hub/HubProvider';
import { usePoll } from '../hooks';
import { useT } from '../i18n';
import type { KnownPlayer, ServerState } from '../types';
import { Notice, Panel, PanelTitle } from './ui';

const chipButton = 'h-7 border px-2 font-mono text-[11px] tracking-[0.06em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-35';

/** Everyone who has joined this server: online status, one-click OP, and a fresh-start reset. */
export function PlayersPanel({
  serverId,
  state,
  target,
  onTarget,
  onPlayers,
}: {
  serverId: string;
  state: ServerState;
  target: string;
  onTarget: (name: string) => void;
  /** Everyone who ever joined, for the command panel's player picker. */
  onPlayers?: (players: KnownPlayer[]) => void;
}) {
  const api = useApi();
  const t = useT();
  const list = usePoll(() => api.get<{ players: KnownPlayer[] }>(`/api/v1/servers/${serverId}/players`), 5000, [api, serverId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'signal' | 'danger'; text: string } | null>(null);
  const running = state === 'running';
  const stopped = state === 'stopped' || state === 'crashed';
  const players = list.data?.players ?? [];
  const online = players.filter((p) => p.online).length;
  useEffect(() => {
    if (list.data) onPlayers?.(list.data.players);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ tone: 'signal', text: await fn() });
      setTimeout(list.refresh, 800);
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof ApiError ? err.message : t('Unknown error.', 'Ismeretlen hiba.') });
    } finally {
      setBusy(null);
    }
  };

  // Some modpacks wait for an operator to set up the world, so OP is one click away.
  const toggleOp = (p: KnownPlayer) =>
    run(`op:${p.uuid}`, async () => {
      await api.post(`/api/v1/servers/${serverId}/command`, { command: `${p.op ? 'deop' : 'op'} ${p.name}` });
      return p.op ? t(`${p.name} is no longer an operator.`, `${p.name} már nem operátor.`) : t(`${p.name} is now an operator.`, `${p.name} operátor lett.`);
    });

  const reset = (p: KnownPlayer) => {
    const ok = window.confirm(
      t(
        `Reset ${p.name}’s character\n\n` +
          'Deleted: inventory, position, XP, statistics, advancements, quest progress, FTB team and claimed chunks, homes.\n' +
          'Kept: the world, the buildings, OP and the whitelist.\n\n' +
          'On the next join they start at the spawn, empty-handed. Continue?',
        `${p.name} karakterének visszaállítása\n\n` +
          'Törlődik: inventory, pozíció, XP, statisztikák, achievementek, küldetés-előrehaladás, FTB csapat és lefoglalt chunkok, home-ok.\n' +
          'Megmarad: a világ, az épületek, az OP és a whitelist.\n\n' +
          'Következő belépéskor a spawnon kezd, üres kézzel. Folytatod?',
      ),
    );
    if (!ok) return;
    run(`reset:${p.uuid}`, async () => {
      const { deleted } = await api.post<{ deleted: string[] }>(`/api/v1/servers/${serverId}/players/${p.uuid}/reset`);
      return t(`${p.name} was reset: ${deleted.length} files deleted. They start with a clean slate on the next join.`, `${p.name} visszaállítva: ${deleted.length} fájl törölve. Következő belépéskor tiszta lappal indul.`);
    });
  };

  return (
    <Panel>
      <PanelTitle aside={<span className="readout text-sm text-fg-muted">{running ? `${online} online` : players.length}</span>}>{t('Players', 'Játékosok')}</PanelTitle>
      {players.length === 0 ? (
        <p className="text-sm text-fg-faint">{t('Nobody has joined this server yet.', 'Még senki nem lépett be erre a szerverre.')}</p>
      ) : (
        <ul className="space-y-2">
          {players.map((p) => (
            <li
              key={p.uuid}
              className={`flex items-center gap-2 border bg-bg/50 py-1.5 pr-1.5 pl-2 ${target.toLowerCase() === p.name.toLowerCase() ? 'border-signal/50' : 'border-line'}`}
            >
              <button onClick={() => onTarget(p.name)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title={t('Select for the commands', 'Kiválasztás a parancsokhoz')}>
                <img src={`https://mc-heads.net/avatar/${p.uuid}/28`} alt="" className={`pixel size-7 ${p.online ? '' : 'opacity-50 grayscale'}`} />
                <span className="min-w-0">
                  <span className="readout block truncate text-sm">{p.name}</span>
                  <span className={`label block !text-[10px] ${p.online ? '!text-signal' : ''}`}>{p.online ? '● Online' : 'Offline'}</span>
                </span>
              </button>
              <button
                onClick={() => toggleOp(p)}
                disabled={!running || busy !== null}
                aria-pressed={p.op}
                title={running ? (p.op ? t('Take away operator rights (deop)', 'Operátori jog elvétele (deop)') : t('Give operator rights (op)', 'Operátori jog adása (op)')) : t('The server has to be running', 'A szervernek futnia kell')}
                className={`${chipButton} ${p.op ? 'border-signal/40 bg-signal-dim text-signal' : 'border-line-strong text-fg-faint hover:text-fg'}`}
              >
                {p.op ? 'OP ✓' : 'OP'}
              </button>
              <button
                onClick={() => reset(p)}
                disabled={!stopped || p.dataFiles === 0 || busy !== null}
                title={
                  !stopped
                    ? t('Stop the server to reset a player', 'A visszaállításhoz állítsd le a szervert')
                    : p.dataFiles === 0
                      ? t('No saved data', 'Nincs mentett adata')
                      : t('Reset the character (clean slate)', 'Karakter visszaállítása (tiszta lap)')
                }
                aria-label={t(`Reset ${p.name}’s character`, `${p.name} karakterének visszaállítása`)}
                className={`${chipButton} inline-flex items-center border-line-strong text-fg-faint hover:border-danger/50 hover:text-danger`}
              >
                <Eraser className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <div className="mt-4">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      {players.length > 0 && !stopped && (
        <p className="mt-4 text-xs text-fg-faint">
          {t(
            'Resetting a character (the eraser) only works on a stopped server: mods keep player data in memory and would write it back on the next save.',
            'Karakter visszaállítása (radír) csak leállított szerveren megy: a modok a memóriában tartják a játékosadatokat, és mentéskor visszaírnák.',
          )}
        </p>
      )}
    </Panel>
  );
}
