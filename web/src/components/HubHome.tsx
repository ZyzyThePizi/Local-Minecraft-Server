import { ArrowRight, BookOpen, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { shortFingerprint } from '../hub/crypto';
import { useHub, type HubNode, type Reach } from '../hub/HubProvider';
import { relativeTime } from '../format';
import type { Announcement } from '../types';
import { Button, Chip, Notice, Skeleton, StateDot } from './ui';

const REACH: Record<Reach, { text: string; tone: string }> = {
  checking: { text: 'Kapcsolódás…', tone: 'text-fg-faint' },
  online: { text: 'Online', tone: 'text-signal' },
  offline: { text: 'Alszik', tone: 'text-fg-muted' },
  outdated: { text: 'Régi verzió', tone: 'text-warn' },
  'key-changed': { text: 'Kulcs megváltozott', tone: 'text-danger' },
  error: { text: 'Hiba', tone: 'text-danger' },
};

const README = 'https://github.com/ZyzyThePizi/Local-Minecraft-Server#readme';

/** Network notices from the registry, when the page was built with one (VITE_REGISTRY_URL). */
function useAnnouncements() {
  const [items, setItems] = useState<Announcement[]>([]);
  useEffect(() => {
    const url = (import.meta.env.VITE_REGISTRY_URL as string | undefined)?.replace(/\/$/, '');
    if (!url) return;
    fetch(`${url}/v1/announcements`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { announcements?: Announcement[] } | null) => setItems(Array.isArray(j?.announcements) ? j.announcements.slice(0, 3) : []))
      .catch(() => {});
  }, []);
  return items;
}

/** The archipelago overview: every machine this browser knows, as a list next to the 3D islands. */
export function HubHome({ onOpen, onAdd, onKeyring }: { onOpen: (nodeId: string) => void; onAdd: () => void; onKeyring: () => void }) {
  const hub = useHub();
  const announcements = useAnnouncements();
  const servers = hub.nodes.flatMap((n) => n.live.servers ?? []);
  const running = servers.filter((s) => s.state === 'running').length;
  const players = servers.reduce((sum, s) => sum + (s.state === 'running' ? s.players : 0), 0);

  return (
    <div className="brackets glass animate-rise border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-7">
        <span className="label">
          <span className="text-signal">[01]</span> Szigetvilág
        </span>
        <span className="label readout hidden sm:inline">
          {hub.nodes.length} gép · {running} fut · {players} játékos
        </span>
      </div>

      <div className="px-5 pt-6 pb-5 sm:px-7">
        <h1 className="text-display">Minden gép egy sziget</h1>
        <p className="mt-4 max-w-md text-fg-muted">
          Minden saját gépen futó backend egy sziget, saját szerverekkel, modpackekkel és tunnelekkel. A gépeket csak ez a böngésző jegyzi meg; felhasználói fiók nincs.
        </p>
      </div>

      {announcements.length > 0 && (
        <div className="space-y-2 px-5 pb-5 sm:px-7">
          {announcements.map((a) => (
            <Notice key={a.id} tone={a.level === 'critical' ? 'danger' : a.level === 'warn' ? 'warn' : 'info'}>
              <strong className="font-semibold">{a.title}</strong> {a.body}
            </Notice>
          ))}
        </div>
      )}

      {!hub.ready ? (
        <div className="space-y-2 px-5 pb-6 sm:px-7">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : hub.nodes.length === 0 ? (
        <div className="border-t border-line px-5 py-6 sm:px-7">
          <p className="text-sm text-fg-muted">Még nincs sziget. Adj hozzá egy gépet a címével vagy egy meghívólinkkel, vagy indíts sajátot.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {hub.nodes.map((n) => (
            <IslandRow key={n.rec.nodeId} node={n} onOpen={() => onOpen(n.rec.nodeId)} />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4 sm:px-7">
        <Button variant="primary" onClick={onAdd} icon={<Plus className="size-4" />}>
          Sziget hozzáadása
        </Button>
        <a href={README} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 border border-line-strong bg-bg/40 px-4 font-mono text-xs tracking-[0.08em] text-fg uppercase hover:border-fg-muted">
          <BookOpen className="size-4" /> Saját szerver
        </a>
        <Button variant="ghost" onClick={onKeyring} icon={<KeyRound className="size-4" />}>
          Kulcskarika
        </Button>
      </div>
    </div>
  );
}

function IslandRow({ node, onOpen }: { node: HubNode; onOpen: () => void }) {
  const hub = useHub();
  const { rec, live, signedIn } = node;
  const servers = live.servers ?? [];
  const running = servers.filter((s) => s.state === 'running');
  const players = running.reduce((sum, s) => sum + s.players, 0);
  const reach = REACH[live.reach];

  return (
    <li className="group flex items-center gap-3 px-5 py-3.5 sm:px-7">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold group-hover:text-signal">{rec.name}</span>
            {signedIn && <Chip tone="signal">Belépve</Chip>}
            {rec.featured && <Chip>Kiemelt</Chip>}
          </span>
          <span className="label mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 !normal-case !tracking-normal">
            <span className={reach.tone}>{reach.text}</span>
            {live.reach === 'online' && live.servers && (
              <span>
                {servers.length} szerver · {running.length} fut · {players} játékos
              </span>
            )}
            {live.reach === 'offline' && rec.lastSeenAt && <span>utoljára {relativeTime(rec.lastSeenAt)}</span>}
            <span className="readout text-fg-faint">{shortFingerprint(rec.nodeId)}</span>
          </span>
        </span>
        <span className="hidden items-center gap-1 sm:flex" aria-hidden>
          {servers.slice(0, 6).map((s) => (
            <StateDot key={s.id} state={s.state} />
          ))}
        </span>
        <ArrowRight className="size-4 shrink-0 text-fg-faint group-hover:text-signal" aria-hidden />
      </button>
      {!rec.featured && (
        <button
          onClick={() => {
            if (window.confirm(`Eltávolítod a(z) „${rec.name}” szigetet a listádból? A gépen semmi nem változik; ${signedIn ? 'ez az eszköz kijelentkezik róla.' : ''}`)) {
              void hub.removeNode(rec.nodeId);
            }
          }}
          className="p-2 text-fg-faint hover:text-danger"
          aria-label={`${rec.name} eltávolítása a listából`}
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}
