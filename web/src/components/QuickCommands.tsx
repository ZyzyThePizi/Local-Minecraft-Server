import { Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { useApi } from '../hub/HubProvider';
import { inputClass, Notice, Panel, PanelTitle } from './ui';

interface QuickCommand {
  label: string;
  /** `{p}` is replaced with the selected player. */
  command: string;
  hint?: string;
}

const PLAYER: QuickCommand[] = [
  { label: 'OP adása', command: 'op {p}', hint: 'Teljes admin jog a játékban (pl. világbeállításhoz)' },
  { label: 'OP elvétele', command: 'deop {p}' },
  { label: 'Túlélő', command: 'gamemode survival {p}' },
  { label: 'Kreatív', command: 'gamemode creative {p}' },
  { label: 'Néző', command: 'gamemode spectator {p}' },
  { label: 'Gyógyítás', command: 'effect give {p} minecraft:instant_health 1 10', hint: 'Teljes életerő' },
  { label: 'Etetés', command: 'effect give {p} minecraft:saturation 1 10', hint: 'Teli éhségcsík' },
  { label: 'Kirúgás', command: 'kick {p}', hint: 'Lecsatlakoztatja, de vissza tud jönni' },
];

const WHITELIST: QuickCommand[] = [
  { label: 'Felvétel', command: 'whitelist add {p}' },
  { label: 'Törlés', command: 'whitelist remove {p}' },
  { label: 'Bekapcsolás', command: 'whitelist on', hint: 'Csak a listán szereplők léphetnek be' },
  { label: 'Kikapcsolás', command: 'whitelist off' },
  { label: 'Lista', command: 'whitelist list' },
];

const WORLD: QuickCommand[] = [
  { label: 'Nappal', command: 'time set day' },
  { label: 'Éjszaka', command: 'time set night' },
  { label: 'Derült idő', command: 'weather clear' },
  { label: 'Eső', command: 'weather rain' },
  { label: 'Vihar', command: 'weather thunder' },
  { label: 'Világmentés', command: 'save-all', hint: 'Azonnal lementi a világot' },
  { label: 'Ki van fent?', command: 'list' },
];

const DIFFICULTY: QuickCommand[] = [
  { label: 'Békés', command: 'difficulty peaceful' },
  { label: 'Könnyű', command: 'difficulty easy' },
  { label: 'Normál', command: 'difficulty normal' },
  { label: 'Nehéz', command: 'difficulty hard' },
];

const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/;

/** One-click versions of the console commands an admin needs most; the output shows up in the console. */
export function QuickCommands({
  serverId,
  canSend,
  target,
  onTarget,
  players,
}: {
  serverId: string;
  canSend: boolean;
  target: string;
  onTarget: (v: string) => void;
  players: string[];
}) {
  const api = useApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ tone: 'signal' | 'danger'; text: string } | null>(null);
  const validTarget = PLAYER_NAME.test(target.trim());

  const send = async (command: string) => {
    setBusy(command);
    setResult(null);
    try {
      await api.post(`/api/v1/servers/${serverId}/command`, { command });
      setResult({ tone: 'signal', text: `Elküldve: ${command}. A választ a konzolban látod.` });
    } catch (err) {
      setResult({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Nem sikerült elküldeni.' });
    } finally {
      setBusy(null);
    }
  };

  const run = (c: QuickCommand) => send(c.command.replaceAll('{p}', target.trim()));
  const needsPlayer = (c: QuickCommand) => c.command.includes('{p}');

  const say = (e: FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    send(`say ${text}`).then(() => setMessage(''));
  };

  const group = (title: string, commands: QuickCommand[]) => (
    <div>
      <p className="label mb-2">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {commands.map((c) => {
          const missing = needsPlayer(c) && !validTarget;
          const preview = c.command.replaceAll('{p}', validTarget ? target.trim() : '<játékos>');
          return (
            <button
              key={c.command}
              onClick={() => run(c)}
              disabled={!canSend || missing || busy !== null}
              title={`${preview}${c.hint ? ` – ${c.hint}` : ''}${missing ? ' (előbb válassz játékost)' : ''}`}
              className="h-8 border border-line-strong bg-bg/50 px-3 text-sm transition-colors hover:border-signal/60 hover:text-signal disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:text-fg"
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <Panel>
      <PanelTitle aside={!canSend && <span className="label">A szervernek futnia kell</span>}>Gyors parancsok</PanelTitle>
      <div className="space-y-5">
        <div>
          <label className="label mb-2 block" htmlFor="qc-player">
            Kiválasztott játékos
          </label>
          <input
            id="qc-player"
            list="qc-players"
            value={target}
            onChange={(e) => onTarget(e.target.value)}
            placeholder="Név, vagy kattints egy játékosra a listában"
            className={`${inputClass} readout max-w-xs`}
            autoComplete="off"
          />
          <datalist id="qc-players">
            {players.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        {group('Játékos', PLAYER)}
        {group('Whitelist', WHITELIST)}
        {group('Világ', WORLD)}
        {group('Nehézség', DIFFICULTY)}
        <form onSubmit={say}>
          <label className="label mb-2 block" htmlFor="qc-say">
            Üzenet mindenkinek
          </label>
          <div className="flex">
            <input id="qc-say" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} placeholder="Sziasztok, mindjárt újraindítom a szervert!" className={`${inputClass} border-r-0`} />
            <button
              type="submit"
              disabled={!canSend || !message.trim() || busy !== null}
              className="inline-flex h-10 shrink-0 items-center gap-2 bg-signal px-4 font-mono text-xs font-semibold tracking-[0.08em] text-signal-ink uppercase hover:bg-signal-hover disabled:opacity-40"
            >
              <Send className="size-4" /> Küldés
            </button>
          </div>
        </form>
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
      </div>
    </Panel>
  );
}
