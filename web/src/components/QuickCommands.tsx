import { Check, ChevronDown, Info, Search, Send, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../api';
import { buildCommand, GROUPS, isTarget, needsPlayer, previewCommand, QUICK, type Action, type Arg, type Entry } from '../commands';
import { versionAtLeast } from '../format';
import { useApi } from '../hub/HubProvider';
import { useT } from '../i18n';
import type { KnownPlayer, ServerSummary } from '../types';
import { inputClass, Notice, Panel, PanelTitle } from './ui';

/** The game-style hint that follows the pointer: what a button sends and what that does. */
interface Tip {
  x: number;
  y: number;
  below: boolean;
  title: string;
  cmd: string;
  desc: string;
  note: string | null;
}

const TIP_WIDTH = 320;

const available = (e: Entry, server: ServerSummary) =>
  (!e.min || versionAtLeast(server.mcVersion, e.min)) && (!e.max || versionAtLeast(e.max, server.mcVersion)) && (!e.loaders || e.loaders.includes(server.loader));

const fieldClass = 'h-8 border border-line-strong bg-bg/70 px-2 text-sm text-fg placeholder:text-fg-faint/70 transition-colors focus:border-signal focus:outline-none';
const chipClass = 'inline-flex h-8 items-center gap-1.5 border px-3 text-sm transition-colors';

/**
 * Console commands as buttons: the everyday ones up front, and the whole catalogue (per player,
 * access, messages, world, game rules…) one click away, each with a description. The reply shows
 * up in the console above.
 */
export function QuickCommands({
  server,
  known,
  canSend,
  target,
  onTarget,
}: {
  server: ServerSummary;
  /** Everyone who ever joined this server, for the player picker. */
  known: KnownPlayer[];
  canSend: boolean;
  target: string;
  onTarget: (v: string) => void;
}) {
  const api = useApi();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState('all');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ tone: 'signal' | 'danger'; text: string } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  // Only what this server understands: the syntax of some commands depends on the game version and the loader.
  const groups = useMemo(
    () => GROUPS.map((g) => ({ ...g, entries: g.entries.filter((e) => available(e, server)) })).filter((g) => g.entries.length > 0),
    [server.mcVersion, server.loader],
  );
  const byId = useMemo(() => new Map(groups.flatMap((g) => g.entries).map((e) => [e.id, e])), [groups]);
  const total = groups.reduce((n, g) => n + g.entries.reduce((m, e) => m + e.actions.length, 0), 0);

  const names = [...new Set([...server.players, ...known.map((p) => p.name)])];
  const validTarget = isTarget(target);

  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    addEventListener('scroll', hide, true);
    return () => removeEventListener('scroll', hide, true);
  }, [tip]);

  const send = async (command: string, key: string) => {
    setBusy(key);
    setResult(null);
    try {
      await api.post(`/api/v1/servers/${server.id}/command`, { command });
      setSent(key);
      setTimeout(() => setSent((k) => (k === key ? null : k)), 1600);
      setResult({ tone: 'signal', text: t(`Sent: ${command}. The reply is in the console.`, `Elküldve: ${command}. A választ a konzolban látod.`) });
      return true;
    } catch (err) {
      setResult({ tone: 'danger', text: err instanceof ApiError ? err.message : t('Could not send it.', 'Nem sikerült elküldeni.') });
      return false;
    } finally {
      setBusy(null);
    }
  };

  /** Why a button cannot run right now, or null when it can. */
  const blocked = (entry: Entry, action: Action) => {
    if (!canSend) return t('The server has to be running.', 'A szervernek futnia kell.');
    if (needsPlayer(action) && !validTarget) return t('Pick a player first.', 'Előbb válassz játékost.');
    if (!buildCommand(action, entry, target, values)) return t('Fill in the fields of this command.', 'Töltsd ki a parancs mezőit.');
    return null;
  };

  const run = (entry: Entry, action: Action) => {
    const command = buildCommand(action, entry, target, values);
    if (!command || !canSend || busy !== null) return;
    if (action.danger && !window.confirm(t(`Run this command?\n\n${command}`, `Biztosan futtatod ezt a parancsot?\n\n${command}`))) return;
    void send(command, `${entry.id}/${action.cmd}`);
  };

  const preview = (entry: Entry, action: Action) => previewCommand(action, entry, target, values, t('player', 'játékos'), t);

  const showTip = (el: HTMLElement, entry: Entry, action: Action) => {
    const r = el.getBoundingClientRect();
    const below = r.top < 190;
    setTip({
      x: Math.max(8, Math.min(r.left, innerWidth - TIP_WIDTH - 12)),
      y: below ? r.bottom + 8 : r.top - 8,
      below,
      title: `${t(entry.title)} · ${t(action.label)}`,
      cmd: preview(entry, action),
      desc: t(entry.desc),
      note: blocked(entry, action),
    });
  };

  const actionButton = (entry: Entry, action: Action) => {
    const key = `${entry.id}/${action.cmd}`;
    const off = blocked(entry, action) !== null;
    return (
      <button
        key={key}
        type="button"
        onClick={() => run(entry, action)}
        // Not `disabled`: the hint has to stay reachable to say why the button is off.
        aria-disabled={off || busy !== null}
        onPointerEnter={(e) => e.pointerType === 'mouse' && showTip(e.currentTarget, entry, action)}
        onPointerLeave={() => setTip(null)}
        onFocus={(e) => e.currentTarget.matches(':focus-visible') && showTip(e.currentTarget, entry, action)}
        onBlur={() => setTip(null)}
        className={`${chipClass} border-line-strong bg-bg/50 ${
          off ? 'cursor-not-allowed opacity-35' : action.danger ? 'hover:border-danger/60 hover:text-danger' : 'hover:border-signal/60 hover:text-signal'
        }`}
      >
        {sent === key && <Check className="size-3.5 text-signal" aria-hidden />}
        {t(action.label)}
      </button>
    );
  };

  const argField = (entry: Entry, arg: Arg) => {
    const key = `${entry.id}.${arg.key}`;
    const value = values[key] ?? arg.def ?? '';
    const set = (v: string) => setValues((prev) => ({ ...prev, [key]: v }));
    const listId = arg.suggest ? `qc-${entry.id}-${arg.key}` : arg.kind === 'player' ? 'qc-players' : undefined;
    const width = arg.kind === 'number' ? 'w-20' : arg.kind === 'coord' ? 'w-16' : arg.kind === 'player' ? 'w-36' : 'w-44';
    return (
      <label key={key} className="flex flex-col gap-0.5">
        <span className="label !text-[10px]">{t(arg.label)}</span>
        {arg.kind === 'select' ? (
          <select value={value} onChange={(e) => set(e.target.value)} className={`${fieldClass} max-w-44`}>
            {arg.options!.map(([v, label]) => (
              <option key={v} value={v}>
                {t(label)}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={value}
            onChange={(e) => set(e.target.value)}
            placeholder={arg.placeholder}
            list={listId}
            inputMode={arg.kind === 'number' ? 'decimal' : undefined}
            className={`${fieldClass} readout ${width}`}
            autoComplete="off"
            spellCheck={false}
          />
        )}
        {arg.suggest && (
          <datalist id={listId}>
            {arg.suggest.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </label>
    );
  };

  const say = (e: FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text || !canSend) return;
    void send(`say ${text}`, 'say').then((ok) => ok && setMessage(''));
  };

  const q = query.trim().toLowerCase();
  const matches = (e: Entry) =>
    !q || [e.title.en, e.title.hu, e.desc.en, e.desc.hu, ...e.actions.flatMap((x) => [x.label.en, x.label.hu, x.cmd])].some((s) => s.toLowerCase().includes(q));
  const shown = groups
    .filter((g) => q || groupId === 'all' || g.id === groupId)
    .map((g) => ({ ...g, entries: g.entries.filter(matches) }))
    .filter((g) => g.entries.length > 0);

  const targetChip = (value: string, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => onTarget(target === value ? '' : value)}
      aria-pressed={target === value}
      className={`${chipClass} ${target === value ? 'border-signal/60 bg-signal-dim text-signal' : 'border-line-strong bg-bg/50 text-fg-muted hover:text-fg'}`}
    >
      {label}
    </button>
  );

  return (
    <Panel>
      <PanelTitle
        aside={
          <span className="label inline-flex items-center gap-1.5">
            {canSend ? (
              <>
                <Info className="size-3.5" aria-hidden /> <span className="hidden sm:inline">{t('Point at a button to see what it does', 'Vidd az egeret egy gombra a leírásért')}</span>
              </>
            ) : (
              t('The server has to be running', 'A szervernek futnia kell')
            )}
          </span>
        }
      >
        {t('Commands', 'Parancsok')}
      </PanelTitle>

      {/* The player picker stays in view while the long catalogue scrolls. */}
      <div className={`space-y-3 ${open ? 'sticky top-[calc(var(--nav-h)+48px)] z-10 -mx-5 mb-5 border-y border-line bg-surface/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:px-6' : 'mb-5'}`}>
        <div>
          <label className="label mb-2 block" htmlFor="qc-player">
            {t('Selected player', 'Kiválasztott játékos')}
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <input
                id="qc-player"
                list="qc-players"
                value={target}
                onChange={(e) => onTarget(e.target.value)}
                placeholder={t('Name, or pick one', 'Név, vagy válassz')}
                className={`${fieldClass} readout w-48 pr-7 ${target && !validTarget ? '!border-warn/60' : ''}`}
                autoComplete="off"
                spellCheck={false}
              />
              {target && (
                <button type="button" onClick={() => onTarget('')} className="absolute top-1/2 right-1 -translate-y-1/2 p-1 text-fg-faint hover:text-fg" aria-label={t('Clear the player', 'Játékos törlése')}>
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {server.players.slice(0, 8).map((p) => targetChip(p, p))}
            {targetChip('@a', t('@a everyone', '@a mindenki'))}
            {targetChip('@r', t('@r random', '@r véletlen'))}
          </div>
          <datalist id="qc-players">
            {names.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        {result && (
          <div role="status">
            <Notice tone={result.tone}>
              <span className="break-all">{result.text}</span>
            </Notice>
          </div>
        )}
      </div>

      <div className="space-y-5">
        {QUICK.map((group) => {
          const entries = group.ids.map((id) => byId.get(id)).filter((e): e is Entry => Boolean(e));
          if (!entries.length) return null;
          return (
            <div key={group.title.en}>
              <p className="label mb-2">{t(group.title)}</p>
              <div className="flex flex-wrap gap-1.5">{entries.flatMap((e) => e.actions.map((action) => actionButton(e, action)))}</div>
            </div>
          );
        })}

        <form onSubmit={say}>
          <label className="label mb-2 block" htmlFor="qc-say">
            {t('Message to everyone', 'Üzenet mindenkinek')}
          </label>
          <div className="flex">
            <input
              id="qc-say"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={200}
              placeholder={t('Hi all, the server restarts in a minute!', 'Sziasztok, mindjárt újraindítom a szervert!')}
              className={`${inputClass} border-r-0`}
            />
            <button
              type="submit"
              disabled={!canSend || !message.trim() || busy !== null}
              className="inline-flex h-10 shrink-0 items-center gap-2 bg-signal px-4 font-mono text-xs font-semibold tracking-[0.08em] text-signal-ink uppercase hover:bg-signal-hover disabled:opacity-40"
            >
              <Send className="size-4" /> {t('Send', 'Küldés')}
            </button>
          </div>
        </form>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-11 w-full items-center justify-between gap-3 border border-line-strong bg-bg/50 px-4 font-mono text-xs tracking-[0.08em] uppercase transition-colors hover:border-signal/60 hover:text-signal"
        >
          <span>{open ? t('Fewer commands', 'Kevesebb parancs') : t('More commands', 'Több parancs')}</span>
          <span className="flex items-center gap-2 text-fg-faint">
            {t(`${total} commands`, `${total} parancs`)}
            <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </button>

        {open && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search: teleport, keepInventory, whitelist…', 'Keresés: teleport, keepInventory, whitelist…')}
                  className={`${inputClass} pl-9`}
                  aria-label={t('Search commands', 'Parancs keresése')}
                />
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Categories', 'Kategóriák')}>
                {[{ id: 'all', title: null, count: groups.reduce((n, g) => n + g.entries.length, 0) }, ...groups.map((g) => ({ id: g.id, title: g.title, count: g.entries.length }))].map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroupId(g.id)}
                    aria-pressed={!q && groupId === g.id}
                    className={`inline-flex h-8 items-center gap-1.5 border px-2.5 font-mono text-[11px] tracking-[0.06em] uppercase transition-colors ${
                      !q && groupId === g.id ? 'border-signal bg-signal text-signal-ink' : 'border-line-strong text-fg-muted hover:text-fg'
                    }`}
                  >
                    {g.title ? t(g.title) : t('All', 'Mind')}
                    <span className={!q && groupId === g.id ? '' : 'text-fg-faint'}>{g.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {shown.length === 0 && <p className="py-6 text-center text-sm text-fg-muted">{t(`No command matches “${query.trim()}”.`, `Nincs ilyen parancs: „${query.trim()}”.`)}</p>}

            {shown.map((g) => (
              <section key={g.id} aria-label={t(g.title)}>
                <h3 className="label mb-2 !text-fg-muted">
                  <span className="text-signal">▸</span> {t(g.title)}
                </h3>
                <ul className="divide-y divide-line border border-line">
                  {g.entries.map((entry) => (
                    <li key={entry.id} className="grid gap-x-5 gap-y-2.5 bg-bg/40 px-3 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:items-center">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t(entry.title)}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{t(entry.desc)}</p>
                        {(entry.actions.length === 1 || entry.args) && <code className="readout mt-1 block truncate text-[11px] text-fg-faint">{preview(entry, entry.actions[0]!)}</code>}
                      </div>
                      <div className="flex flex-wrap items-end gap-1.5 xl:justify-end">
                        {entry.args?.map((arg) => argField(entry, arg))}
                        {entry.actions.map((action) => actionButton(entry, action))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {tip &&
        createPortal(
          <div
            role="tooltip"
            className="mc-tip pointer-events-none fixed z-[60] px-3 py-2 text-xs leading-relaxed"
            style={{ left: tip.x, top: tip.y, width: TIP_WIDTH, maxWidth: 'calc(100vw - 16px)', transform: tip.below ? undefined : 'translateY(-100%)' }}
          >
            <p className="font-semibold text-white">{tip.title}</p>
            <p className="mt-1 break-all text-[#55ffff]">/{tip.cmd}</p>
            <p className="mt-1 text-[#aaaaaa]">{tip.desc}</p>
            {tip.note && <p className="mt-1 text-[#ff5555]">{tip.note}</p>}
          </div>,
          document.body,
        )}
    </Panel>
  );
}
