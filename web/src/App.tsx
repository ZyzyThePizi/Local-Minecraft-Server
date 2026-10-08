import { Gauge, LogIn, LogOut, Package, Power, RefreshCw, Server, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, configureApi, discoverBackend, get, loadToken, post, saveToken } from './api';
import { ControlTab } from './components/ControlTab';
import { InstancesTab } from './components/InstancesTab';
import { BackendModal, EulaModal } from './components/Modals';
import { LoginModal } from './components/LoginModal';
import { PacksTab } from './components/PacksTab';
import { SettingsTab } from './components/SettingsTab';
import { StatusHero } from './components/StatusHero';
import { Button, Card, GrassBlock, Notice } from './components/ui';
import { usePoll } from './hooks';
import type { Overview, PublicStatus } from './types';

type Phase = { kind: 'discovering' } | { kind: 'offline' } | { kind: 'ready'; url: string; name: string };
type Tab = 'control' | 'packs' | 'settings' | 'instances';

const TABS: { id: Tab; label: string; icon: typeof Gauge }[] = [
  { id: 'control', label: 'Vezérlés', icon: Gauge },
  { id: 'packs', label: 'Modpack', icon: Package },
  { id: 'settings', label: 'Beállítások', icon: SlidersHorizontal },
  { id: 'instances', label: 'Szerverek', icon: Server },
];

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

const initialTab = (): Tab => {
  const h = location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as Tab) : 'control';
};

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

  const login = (value: { token: string; expiresAt: number }) => {
    if (phase.kind !== 'ready') return;
    saveToken(phase.url, value);
    applyToken(phase.url, value.token, setToken);
    setLoginOpen(false);
  };

  const logout = () => {
    if (phase.kind !== 'ready') return;
    saveToken(phase.url, null);
    applyToken(phase.url, null, setToken);
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

  const lostConnection = status.error?.code === 'NETWORK';

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between gap-4 py-5">
        <div className="flex items-center gap-3">
          <GrassBlock className="size-9" />
          <div className="leading-tight">
            <p className="font-bold tracking-tight">Minecraft szerver</p>
            <p className="text-xs text-muted">ZyzyThePizi</p>
          </div>
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
      </header>

      <main className="flex-1 space-y-6 pb-12">
        {phase.kind === 'discovering' && <div className="h-52 animate-pulse rounded-3xl border border-line bg-surface" />}

        {phase.kind === 'offline' && (
          <Card className="py-12 text-center">
            <Power className="mx-auto mb-4 size-10 text-muted" aria-hidden />
            <h1 className="text-xl font-bold">A szervergép most ki van kapcsolva</h1>
            <p className="mx-auto mt-2 mb-6 max-w-md text-sm text-muted">
              Amint bekapcsolom, itt meg fog jelenni a szerver állapota és a csatlakozási cím. Az oldal magától újrapróbálja.
            </p>
            <Button onClick={() => connect()} icon={<RefreshCw className="size-4" />}>
              Újrapróbálás
            </Button>
          </Card>
        )}

        {phase.kind === 'ready' && (
          <>
            {lostConnection && (
              <Notice tone="warn">
                Megszakadt a kapcsolat a szervergéppel.{' '}
                <button className="underline" onClick={() => connect()}>
                  Újrakapcsolódás
                </button>
              </Notice>
            )}
            {status.data ? <StatusHero status={status.data} /> : <div className="h-52 animate-pulse rounded-3xl border border-line bg-surface" />}

            {token && overview.data && (
              <>
                <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Admin fülek">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      aria-current={tab === t.id ? 'page' : undefined}
                      className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors ${
                        tab === t.id ? 'bg-surface-2 font-semibold text-ink ring-1 ring-line' : 'text-muted hover:text-ink'
                      }`}
                    >
                      <t.icon className="size-4" aria-hidden />
                      {t.label}
                    </button>
                  ))}
                </nav>

                {tab === 'control' && (
                  <ControlTab
                    overview={overview.data}
                    refresh={refreshAll}
                    onNeedEula={(retry) => setEulaRetry(() => retry)}
                    goToPacks={() => setTab('packs')}
                  />
                )}
                {tab === 'packs' && (
                  <PacksTab curseforgeConfigured={overview.data.curseforgeConfigured} onInstalled={refreshAll} onStartServer={startServer} />
                )}
                {tab === 'settings' && <SettingsTab overview={overview.data} refresh={refreshAll} />}
                {tab === 'instances' && <InstancesTab overview={overview.data} refresh={refreshAll} />}
              </>
            )}
            {token && !overview.data && !overview.error && <div className="h-80 animate-pulse rounded-2xl border border-line bg-surface" />}
          </>
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-4 text-xs text-muted">
        <span>
          {phase.kind === 'ready' ? (
            <>
              <span className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" aria-hidden />
              Szervergép: {phase.name}
            </>
          ) : (
            'Nincs kapcsolat'
          )}
        </span>
        <button onClick={() => setBackendOpen(true)} className="hover:text-ink">
          Backend cím
        </button>
      </footer>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onLogin={login} />
      <BackendModal open={backendOpen} onClose={() => setBackendOpen(false)} onChanged={() => connect()} />
      <EulaModal retry={eulaRetry} onClose={() => setEulaRetry(null)} />
    </div>
  );
}
