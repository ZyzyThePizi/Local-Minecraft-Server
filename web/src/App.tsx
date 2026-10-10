import { ChevronRight, LogIn, LogOut, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectModal } from './components/ConnectModal';
import { HubHome } from './components/HubHome';
import { IslandView, TABS, type FocusInfo, type Tab } from './components/IslandView';
import { KeyringModal } from './components/KeyringModal';
import { LoginModal } from './components/LoginModal';
import { LoadingHero } from './components/StatusHero';
import { Toasts } from './components/Toasts';
import { Button, GrassBlock } from './components/ui';
import { WorldCanvas } from './components/WorldCanvas';
import { seedOf } from './hub/crypto';
import { HubProvider, useHub } from './hub/HubProvider';
import type { IslandInfo, StationId, WorldState } from './world';

type Route = { view: 'hub' } | { view: 'island'; nodeId: string; tab: Tab; serverId: string | null };

const STATION: Record<Tab, StationId | null> = { control: 'control', packs: 'packs', servers: 'instances', settings: 'settings', machine: null };

function parseRoute(hash: string): Route {
  const m = /^#\/n\/([0-9A-Z]{16})(?:\/([a-z]+))?(?:\/([a-z0-9-]{1,60}))?$/.exec(hash);
  if (!m) return { view: 'hub' };
  const tab = TABS.some((t) => t.id === m[2]) ? (m[2] as Tab) : 'control';
  return { view: 'island', nodeId: m[1]!, tab, serverId: m[3] ?? null };
}

const routeHash = (r: Route) => (r.view === 'hub' ? '#/' : `#/n/${r.nodeId}/${r.tab}${r.serverId ? `/${r.serverId}` : ''}`);

export default function App() {
  return (
    <HubProvider>
      <Hub />
    </HubProvider>
  );
}

function Hub() {
  const hub = useHub();
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [connect, setConnect] = useState<{ open: boolean; initial: string }>({ open: false, initial: '' });
  const [keyringOpen, setKeyringOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [focusInfo, setFocusInfo] = useState<FocusInfo | null>(null);
  const pickRef = useRef<((x: number, y: number) => string | null) | null>(null);
  const [hovering, setHovering] = useState(false);

  // Invite links (#join=…) and "add this machine" links (#add=…) open the connect dialog once.
  useEffect(() => {
    const onHash = () => {
      const h = location.hash;
      if (h.startsWith('#join=')) {
        setConnect({ open: true, initial: location.href });
        history.replaceState(null, '', '#/');
        setRoute({ view: 'hub' });
      } else if (h.startsWith('#add=')) {
        setConnect({ open: true, initial: decodeURIComponent(h.slice(5)) });
        history.replaceState(null, '', '#/');
        setRoute({ view: 'hub' });
      } else setRoute(parseRoute(h));
    };
    onHash();
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((r: Route) => {
    const hash = routeHash(r);
    if (location.hash !== hash) history.pushState(null, '', hash);
    setRoute(r);
  }, []);

  const node = route.view === 'island' ? hub.node(route.nodeId) : null;
  const unknownIsland = route.view === 'island' && hub.ready && !node;
  useEffect(() => {
    if (unknownIsland) go({ view: 'hub' });
  }, [unknownIsland, go]);
  useEffect(() => {
    if (route.view === 'hub') setFocusInfo(null);
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [route.view, route.view === 'island' ? route.nodeId : null]);
  useEffect(() => {
    document.title = node ? `${node.rec.name} · Local Minecraft Server` : 'Szigetvilág · Local Minecraft Server';
  }, [node?.rec.name]);

  const worldState = useMemo<WorldState>(() => {
    const islands: IslandInfo[] = hub.nodes.map((n) => {
      const isFocus = node?.rec.nodeId === n.rec.nodeId && focusInfo;
      const servers = (isFocus ? focusInfo.servers : n.live.servers) ?? [];
      const selectedId = isFocus ? focusInfo.selectedId : (servers.find((s) => s.state === 'running')?.id ?? servers[0]?.id);
      const running = servers.filter((s) => s.state === 'running');
      return {
        key: n.rec.nodeId,
        name: n.rec.name,
        seed: seedOf(n.rec.nodeId),
        // Until the first check answers, an island is drawn as reachable (no fog rolling in and out on every load).
        online: n.live.reach === 'online' || n.live.reach === 'checking',
        servers: servers.map((s) => ({ id: s.id, state: s.state })),
        selectedState: servers.find((s) => s.id === selectedId)?.state ?? 'stopped',
        playerCount: running.reduce((sum, s) => sum + s.players, 0),
        playerNames: running.flatMap((s) => s.playerNames),
        installing: Boolean(isFocus && focusInfo.installing),
      };
    });
    // Dev-only preview of live states: http://localhost:5173/Local-Minecraft-Server/?demo
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
      const demo: IslandInfo['servers'][number]['state'][] = ['running', 'crashed', 'starting', 'stopped', 'running'];
      islands.forEach((i, n) => {
        i.servers = demo.slice(0, 3 + (n % 3)).map((state, k) => ({ id: `demo-${k}`, state }));
        i.selectedState = 'running';
        i.playerCount = 4;
        i.playerNames = ['ZyzyThePizi', 'Alex', 'Notch', 'Steve'];
      });
    }
    return {
      islands,
      focus: node?.rec.nodeId ?? null,
      station: node?.signedIn && route.view === 'island' ? STATION[route.tab] : null,
      addSlot: hub.ready,
    };
  }, [hub.nodes, hub.ready, node, focusInfo, route]);

  // Clicks on the open sky/sea of the overview fly to the island under the pointer.
  const pickAt = (x: number, y: number) => pickRef.current?.(x, y) ?? null;
  const onWorldClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const key = pickAt(e.clientX, e.clientY);
    if (key === 'add') setConnect({ open: true, initial: '' });
    else if (key) go({ view: 'island', nodeId: key, tab: 'control', serverId: null });
  };
  const onWorldMove = (e: React.MouseEvent) => setHovering(e.target === e.currentTarget && pickAt(e.clientX, e.clientY) !== null);

  const navigateIsland = (tab: Tab, serverId: string | null) => {
    if (route.view === 'island') go({ ...route, tab, serverId });
  };

  return (
    <>
      <WorldCanvas state={worldState} pickRef={pickRef} />

      <header className="fixed inset-x-0 top-0 z-30 h-[var(--nav-h)] border-b border-line bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-4 px-[var(--shell-pad)]">
          <nav className="flex min-w-0 items-center gap-2" aria-label="Morzsamenü">
            <a href="#/" onClick={(e) => (e.preventDefault(), go({ view: 'hub' }))} className="flex shrink-0 items-center gap-3">
              <GrassBlock className="size-7" />
              <span className="font-semibold tracking-tight">Szigetvilág</span>
            </a>
            {node && (
              <>
                <ChevronRight className="size-4 shrink-0 text-fg-faint" aria-hidden />
                <span className="label truncate !text-fg-muted">{node.rec.name}</span>
              </>
            )}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            {node ? (
              node.signedIn ? (
                <Button variant="ghost" aria-label="Kilépés" onClick={() => void hub.signOut(node.rec.nodeId)} icon={<LogOut className="size-4" />}>
                  <span className="hidden sm:inline">Kilépés</span>
                </Button>
              ) : (
                node.live.reach === 'online' && (
                  <Button onClick={() => setLoginOpen(true)} icon={<LogIn className="size-4" />}>
                    Belépés
                  </Button>
                )
              )
            ) : (
              <Button aria-label="Sziget hozzáadása" onClick={() => setConnect({ open: true, initial: '' })} icon={<Plus className="size-4" />}>
                <span className="hidden sm:inline">Sziget</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main id="top">
        {route.view === 'hub' || !node ? (
          <section
            onClick={onWorldClick}
            onMouseMove={onWorldMove}
            className={`relative mx-auto flex min-h-svh max-w-[1440px] flex-col justify-end px-[var(--shell-pad)] pt-[calc(var(--nav-h)+32px)] pb-10 lg:justify-center lg:pb-24 ${hovering ? 'cursor-pointer' : ''}`}
          >
            <div className="w-full max-w-[580px]">
              {route.view === 'island' && !hub.ready ? (
                <LoadingHero />
              ) : (
                <HubHome
                  onOpen={(nodeId) => go({ view: 'island', nodeId, tab: 'control', serverId: null })}
                  onAdd={() => setConnect({ open: true, initial: '' })}
                  onKeyring={() => setKeyringOpen(true)}
                />
              )}
            </div>
            <p className="label pointer-events-none absolute right-[var(--shell-pad)] bottom-10 hidden max-w-xs text-right lg:block">
              <span className="text-signal">●</span> Élő szigetvilág · kattints egy szigetre
            </p>
          </section>
        ) : (
          <IslandView
            key={node.rec.nodeId}
            node={node}
            tab={route.view === 'island' ? route.tab : 'control'}
            serverId={route.view === 'island' ? route.serverId : null}
            navigate={navigateIsland}
            onLogin={() => setLoginOpen(true)}
            onFocusInfo={setFocusInfo}
          />
        )}
      </main>

      <footer className={`relative ${node?.signedIn ? 'bg-bg' : 'glass'} border-t border-line`}>
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-[var(--shell-pad)] py-4">
          <span className="label">Local Minecraft Server · saját gépen futó szerverek</span>
          <a href="https://github.com/ZyzyThePizi/Local-Minecraft-Server" target="_blank" rel="noreferrer" className="label hover:text-fg">
            GitHub
          </a>
        </div>
      </footer>

      <ConnectModal
        open={connect.open}
        initial={connect.initial}
        onClose={() => setConnect({ open: false, initial: '' })}
        onConnected={(nodeId) => {
          setConnect({ open: false, initial: '' });
          go({ view: 'island', nodeId, tab: 'control', serverId: null });
        }}
      />
      <KeyringModal open={keyringOpen} onClose={() => setKeyringOpen(false)} />
      {node && <LoginModal node={node} open={loginOpen} onClose={() => setLoginOpen(false)} />}
      <Toasts />
    </>
  );
}
