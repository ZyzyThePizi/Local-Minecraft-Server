import { ArrowDown, LogIn, LogOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, configureApi, discoverBackend, get, loadToken, post, saveToken } from './api';
import { ControlTab } from './components/ControlTab';
import { InstancesTab } from './components/InstancesTab';
import { LoginModal } from './components/LoginModal';
import { BackendModal, EulaModal } from './components/Modals';
import { PacksTab } from './components/PacksTab';
import { SettingsTab } from './components/SettingsTab';
import { LoadingHero, OfflineHero, StatusHero } from './components/StatusHero';
import { Button, GrassBlock, Notice, Skeleton, StateLabel } from './components/ui';
import { WorldCanvas } from './components/WorldCanvas';
import { usePoll } from './hooks';
import type { Overview, PublicStatus } from './types';
import type { WorldState } from './world';

type Phase = { kind: 'discovering' } | { kind: 'offline' } | { kind: 'ready'; url: string; name: string };
type Tab = 'control' | 'packs' | 'settings' | 'instances';

// Each admin tab has a station on the island; the camera flies there.
const TABS: { id: Tab; label: string; station: string; caption: string }[] = [
  { id: 'control', label: 'Vezérlés', station: 'Beacon', caption: 'Indítás, leállítás, konzol. Amíg a szerver fut, a beacon fénye az égig ér.' },
  { id: 'packs', label: 'Modpack', station: 'Láda', caption: 'Keresés és telepítés egy kattintással. Telepítés közben a láda nyitva van.' },
  { id: 'settings', label: 'Beállítások', station: 'Barkácsasztal', caption: 'server.properties, memória, csatlakozási cím.' },
  { id: 'instances', label: 'Szerverek', station: 'Nether-portál', caption: 'Minden modpack külön világ. Itt válthatsz közöttük.' },
];

const initialTab = (): Tab => {
  const h = location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as Tab) : 'control';
};

function applyToken(url: string, token: string | null, setToken: (t: string | null) => void) {
  configureApi({
    base: url,
    token,
    onUnauthorized: () => {
      saveToken(url, null);
      applyToken(url, null, setToken);
    },
  });
  setToken(token);
}

function worldCaption(state: WorldState['server'], players: number) {
  switch (state) {
    case 'running':
      return ['Nappal', players ? `A szerver fut, ${players} játékos sétál a szigeten.` : 'A szerver fut, a beacon világít.'];
    case 'starting':
      return ['Hajnal', 'A szerver indul…'];
    case 'stopping':
      return ['Alkony', 'A szerver leáll…'];
    case 'crashed':
      return ['Vihar', 'A szerver összeomlott.'];
    case 'stopped':
      return ['Éjszaka', 'A szerver pihen. Creeperek járnak a szigeten.'];
    case 'offline':
      return ['Éjszaka', 'A szervergép ki van kapcsolva.'];
    default:
      return ['Betöltés', 'Kapcsolódás a szervergéphez…'];
  }
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'discovering' });
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [loginOpen, setLoginOpen] = useState(false);
  const [backendOpen, setBackendOpen] = useState(false);
  const [eulaRetry, setEulaRetry] = useState<(() => Promise<void>) | null>(null);
  const backendUrl = phase.kind === 'ready' ? phase.url : '';

  const setTab = (t: Tab) => {
    setTabState(t);
    history.replaceState(null, '', `#${t}`);
  };

  const connect = useCallback(async (quiet = false) => {
    if (!quiet) setPhase({ kind: 'discovering' });
    const found = await discoverBackend();
    if (!found) {
      setPhase({ kind: 'offline' });
      return;
    }
    applyToken(found.url, loadToken(found.url), setToken);
    setPhase({ kind: 'ready', ...found });
  }, []);

  useEffect(() => {
    connect();
  }, [connect]);

  // While no machine is up, keep looking so the page comes alive as soon as one starts.
  useEffect(() => {
    if (phase.kind !== 'offline') return;
    const t = setInterval(() => connect(true), 15_000);
    return () => clearInterval(t);
  }, [phase.kind, connect]);

  const status = usePoll(() => get<PublicStatus>('/api/status'), 5000, [backendUrl], phase.kind === 'ready');
  const overview = usePoll(() => get<Overview>('/api/admin/overview'), 3000, [backendUrl, token], phase.kind === 'ready' && Boolean(token));
  const refreshAll = useCallback(() => {
    status.refresh();
    overview.refresh();
  }, [status.refresh, overview.refresh]);

  const isAdmin = Boolean(token && overview.data);

  const login = (value: { token: string; expiresAt: number }) => {
    if (phase.kind !== 'ready') return;
    saveToken(phase.url, value);
    applyToken(phase.url, value.token, setToken);
    setLoginOpen(false);
    // Fly down to the console once it has rendered.
    setTimeout(() => document.getElementById('admin')?.scrollIntoView({ behavior: 'smooth' }), 600);
  };

  const logout = () => {
    if (phase.kind !== 'ready') return;
    saveToken(phase.url, null);
    applyToken(phase.url, null, setToken);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startServer = async () => {
    const run = async () => {
      await post('/api/admin/server/start');
      refreshAll();
    };
    setTab('control');
    try {
      await run();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EULA_REQUIRED') setEulaRetry(() => run);
    }
  };

  const serverState: WorldState['server'] =
    phase.kind === 'offline' ? 'offline' : phase.kind === 'discovering' || !status.data ? 'loading' : status.data.state;
  // Dev-only preview of the player avatars: http://localhost:5173/minecraft/?demo
  const demo = import.meta.env.DEV && new URLSearchParams(location.search).has('demo');
  const playerCount = serverState === 'running' ? (demo ? 4 : (status.data?.players ?? 0)) : 0;
  const playerNamesKey = demo ? 'ZyzyThePizi|Alex|Notch|Steve' : (overview.data?.server.players.join('|') ?? '');
  const installing = overview.data?.installing ?? false;
  const worldState = useMemo<WorldState>(
    () => ({
      server: serverState,
      playerCount,
      playerNames: playerNamesKey ? playerNamesKey.split('|') : [],
      station: isAdmin ? tab : null,
      installing,
    }),
    [serverState, playerCount, playerNamesKey, isAdmin, tab, installing],
  );
  const [captionTitle, captionText] = worldCaption(serverState, playerCount);
  const current = TABS.find((t) => t.id === tab)!;
  const lostConnection = status.error?.code === 'NETWORK';

  return (
    <>
      <WorldCanvas state={worldState} />

      <header className="fixed inset-x-0 top-0 z-30 bg-bg/90 backdrop-blur-xl h-[var(--nav-h)] border-b border-line">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-4 px-[var(--shell-pad)]">
          <a href="#top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-3">
            <GrassBlock className="size-7" />
            <span className="font-semibold tracking-tight">Zyzy</span>
            <span className="label hidden sm:inline">/ Minecraft szerver</span>
          </a>
          <div className="hidden items-center gap-6 md:flex">
            {status.data && phase.kind === 'ready' && <StateLabel state={status.data.state} />}
            {phase.kind === 'ready' && <span className="label">Gép: {phase.name}</span>}
          </div>
          {phase.kind === 'ready' &&
            (token ? (
              <Button variant="ghost" onClick={logout} icon={<LogOut className="size-4" />}>
                <span className="hidden sm:inline">Kilépés</span>
              </Button>
            ) : (
              <Button onClick={() => setLoginOpen(true)} icon={<LogIn className="size-4" />}>
                Admin
              </Button>
            ))}
        </div>
      </header>

      <main id="top">
        <section className="relative mx-auto flex min-h-svh max-w-[1440px] flex-col justify-end px-[var(--shell-pad)] pt-[calc(var(--nav-h)+32px)] pb-10 lg:justify-center lg:pb-24">
          <div className="w-full max-w-[580px] space-y-4">
            {lostConnection && (
              <Notice tone="warn">
                Megszakadt a kapcsolat a szervergéppel.{' '}
                <button className="underline" onClick={() => connect()}>
                  Újrakapcsolódás
                </button>
              </Notice>
            )}
            {phase.kind === 'discovering' && <LoadingHero />}
            {phase.kind === 'offline' && <OfflineHero onRetry={() => connect()} />}
            {phase.kind === 'ready' && (status.data ? <StatusHero status={status.data} /> : <LoadingHero />)}
          </div>

          <div className="pointer-events-none absolute right-[var(--shell-pad)] bottom-10 hidden max-w-xs text-right lg:block">
            <p className="label">
              <span className="text-signal">●</span> Élő világ · {captionTitle}
            </p>
            <p className="mt-1.5 text-sm text-fg-muted">{captionText}</p>
          </div>

          {isAdmin && (
            <a href="#admin" className="label absolute bottom-6 left-1/2 hidden -translate-x-1/2 items-center gap-2 hover:text-fg lg:inline-flex">
              Admin konzol <ArrowDown className="size-3.5 animate-bounce" />
            </a>
          )}
        </section>

        {token && (
          <section id="admin" className="relative scroll-mt-[var(--nav-h)]">
            {/* Station window: the camera frames the tab's station in this gap. */}
            <div className="mx-auto flex h-[44svh] min-h-72 max-w-[1440px] items-end px-[var(--shell-pad)] pb-8">
              <div key={tab} className="brackets glass animate-rise max-w-md border border-line px-5 py-4">
                <p className="label">
                  <span className="text-signal">[02]</span> Admin konzol · Állomás: {current.station}
                </p>
                <p className="text-display-sm mt-2">{current.label}</p>
                <p className="mt-2 text-sm text-fg-muted">{current.caption}</p>
              </div>
            </div>

            <nav className="sticky top-[var(--nav-h)] z-20 bg-bg/90 backdrop-blur-xl border-y border-line" aria-label="Admin fülek">
              <div className="mx-auto flex max-w-[1440px] overflow-x-auto px-[var(--shell-pad)]">
                {TABS.map((t, i) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    aria-current={tab === t.id ? 'page' : undefined}
                    className={`relative flex h-12 shrink-0 items-center gap-2 px-4 font-mono text-xs tracking-[0.08em] uppercase transition-colors first:pl-0 ${
                      tab === t.id ? 'text-fg' : 'text-fg-faint hover:text-fg-muted'
                    }`}
                  >
                    <span className={tab === t.id ? 'text-signal' : ''}>{String(i + 1).padStart(2, '0')}</span>
                    {t.label}
                    {tab === t.id && <span className={`absolute bottom-0 h-0.5 bg-signal ${i === 0 ? 'right-4 left-0' : 'inset-x-4'}`} />}
                  </button>
                ))}
              </div>
            </nav>

            <div className="min-h-svh border-b border-line bg-bg/[0.86] backdrop-blur-xl">
              <div className="mx-auto max-w-[1440px] px-[var(--shell-pad)] py-8 lg:py-10">
                {overview.data ? (
                  <>
                    {tab === 'control' && (
                      <ControlTab overview={overview.data} refresh={refreshAll} onNeedEula={(retry) => setEulaRetry(() => retry)} goToPacks={() => setTab('packs')} />
                    )}
                    {tab === 'packs' && <PacksTab curseforgeConfigured={overview.data.curseforgeConfigured} onInstalled={refreshAll} onStartServer={startServer} />}
                    {tab === 'settings' && <SettingsTab overview={overview.data} refresh={refreshAll} />}
                    {tab === 'instances' && <InstancesTab overview={overview.data} refresh={refreshAll} />}
                  </>
                ) : overview.error ? (
                  <Notice tone="danger">{overview.error.message}</Notice>
                ) : (
                  <Skeleton className="h-96" />
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className={`relative ${token ? 'bg-bg' : 'glass'} border-t border-line`}>
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-[var(--shell-pad)] py-4">
          <span className="label">
            {phase.kind === 'ready' ? (
              <>
                <span className="text-signal">●</span> Szervergép: {phase.name}
              </>
            ) : (
              'Nincs kapcsolat'
            )}
          </span>
          <button onClick={() => setBackendOpen(true)} className="label hover:text-fg">
            Backend cím
          </button>
        </div>
      </footer>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onLogin={login} />
      <BackendModal open={backendOpen} onClose={() => setBackendOpen(false)} onChanged={() => connect()} />
      <EulaModal retry={eulaRetry} onClose={() => setEulaRetry(null)} />
    </>
  );
}
