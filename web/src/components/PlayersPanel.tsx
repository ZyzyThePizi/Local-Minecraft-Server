import { Eraser } from 'lucide-react';
import { useState } from 'react';
import { ApiError, get, post } from '../api';
import { usePoll } from '../hooks';
import type { KnownPlayer, ServerState } from '../types';
import { Notice, Panel, PanelTitle } from './ui';

const chipButton = 'h-7 border px-2 font-mono text-[11px] tracking-[0.06em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-35';

/** Everyone who has joined this server: online status, one-click OP, and a fresh-start reset. */
export function PlayersPanel({
  state,
  target,
  onTarget,
}: {
  state: ServerState;
  target: string;
  onTarget: (name: string) => void;
}) {
  const list = usePoll(() => get<{ players: KnownPlayer[] }>('/api/admin/players'), 5000, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'signal' | 'danger'; text: string } | null>(null);
  const running = state === 'running';
  const stopped = state === 'stopped' || state === 'crashed';
  const players = list.data?.players ?? [];
  const online = players.filter((p) => p.online).length;

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ tone: 'signal', text: await fn() });
      setTimeout(list.refresh, 800);
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Ismeretlen hiba.' });
    } finally {
      setBusy(null);
    }
  };

  // Some modpacks wait for an operator to set up the world, so OP is one click away.
  const toggleOp = (p: KnownPlayer) =>
    run(`op:${p.uuid}`, async () => {
      await post('/api/admin/server/command', { command: `${p.op ? 'deop' : 'op'} ${p.name}` });
      return p.op ? `${p.name} már nem operátor.` : `${p.name} operátor lett.`;
    });

  const reset = (p: KnownPlayer) => {
    const ok = window.confirm(
      `${p.name} karakterének visszaállítása\n\n` +
        'Törlődik: inventory, pozíció, XP, statisztikák, achievementek, küldetés-előrehaladás, FTB csapat és lefoglalt chunkok, home-ok.\n' +
        'Megmarad: a világ, az épületek, az OP és a whitelist.\n\n' +
        'Következő belépéskor a spawnon kezd, üres kézzel. Folytatod?',
    );
    if (!ok) return;
    run(`reset:${p.uuid}`, async () => {
      const { deleted } = await post<{ deleted: string[] }>(`/api/admin/players/${p.uuid}/reset`);
      return `${p.name} visszaállítva: ${deleted.length} fájl törölve. Következő belépéskor tiszta lappal indul.`;
    });
  };

  return (
    <Panel>
      <PanelTitle aside={<span className="readout text-sm text-fg-muted">{running ? `${online} online` : players.length}</span>}>Játékosok</PanelTitle>
      {players.length === 0 ? (
        <p className="text-sm text-fg-faint">Még senki nem lépett be erre a szerverre.</p>
      ) : (
        <ul className="space-y-2">
          {players.map((p) => (
            <li
              key={p.uuid}
              className={`flex items-center gap-2 border bg-bg/50 py-1.5 pr-1.5 pl-2 ${target.toLowerCase() === p.name.toLowerCase() ? 'border-signal/50' : 'border-line'}`}
            >
              <button onClick={() => onTarget(p.name)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Kiválasztás a gyors parancsokhoz">
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
                title={running ? (p.op ? 'Operátori jog elvétele (deop)' : 'Operátori jog adása (op)') : 'A szervernek futnia kell'}
                className={`${chipButton} ${p.op ? 'border-signal/40 bg-signal-dim text-signal' : 'border-line-strong text-fg-faint hover:text-fg'}`}
              >
                {p.op ? 'OP ✓' : 'OP'}
              </button>
              <button
                onClick={() => reset(p)}
                disabled={!stopped || p.dataFiles === 0 || busy !== null}
                title={!stopped ? 'A visszaállításhoz állítsd le a szervert' : p.dataFiles === 0 ? 'Nincs mentett adata' : 'Karakter visszaállítása (tiszta lap)'}
                aria-label={`${p.name} karakterének visszaállítása`}
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
          Karakter visszaállítása (radír) csak leállított szerveren megy: a modok a memóriában tartják a játékosadatokat, és mentéskor visszaírnák.
        </p>
      )}
    </Panel>
  );
}
