import { ArrowDown, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { groupFingerprint } from '../hub/crypto';
import { NodeProvider, useHub, type HubNode, type HubServer } from '../hub/HubProvider';
import { usePoll } from '../hooks';
import { tx, useT, type Text } from '../i18n';
import type { NodeOverview, PublicServer, ServerSummary } from '../types';
import { ControlTab } from './ControlTab';
import { MachineTab } from './MachineTab';
import { EulaModal } from './Modals';
import { PacksTab } from './PacksTab';
import { ServersTab } from './ServersTab';
import { SettingsTab } from './SettingsTab';
import { IslandHero } from './StatusHero';
import { Button, Notice, Skeleton } from './ui';

export type Tab = 'control' | 'packs' | 'servers' | 'settings' | 'machine';

// Each admin tab has a station on the island; the camera flies there ("machine" shows the whole island).
export const TABS: { id: Tab; label: Text; station: Text; caption: Text }[] = [
  {
    id: 'control',
    label: tx('Control', 'Vezérlés'),
    station: tx('Beacon', 'Beacon'),
    caption: tx('Start, stop, console and commands. While the selected server runs, the beacon’s beam reaches the sky.', 'Indítás, leállítás, konzol, parancsok. Amíg a kiválasztott szerver fut, a beacon fénye az égig ér.'),
  },
  {
    id: 'packs',
    label: tx('Modpacks', 'Modpack'),
    station: tx('Chest', 'Láda'),
    caption: tx('Search and install with one click. The chest stays open during an install.', 'Keresés és telepítés egy kattintással. Telepítés közben a láda nyitva van.'),
  },
  {
    id: 'servers',
    label: tx('Servers', 'Szerverek'),
    station: tx('Nether portal', 'Nether-portál'),
    caption: tx(
      'Every modpack is its own world with its own port. Several can run at once, each with its own beacon on the island. A fresh start (wiping the world or the player data) is here too.',
      'Minden modpack külön világ, saját porttal. Több is futhat egyszerre: mindegyiknek saját beaconja van a szigeten. Az újrakezdés (világ vagy játékosadatok törlése) is itt van.',
    ),
  },
  {
    id: 'settings',
    label: tx('Settings', 'Beállítások'),
    station: tx('Crafting table', 'Barkácsasztal'),
    caption: tx('The selected server: join address, memory, server.properties.', 'A kiválasztott szerver: csatlakozási cím, memória, server.properties.'),
  },
  {
    id: 'machine',
    label: tx('Machine', 'Gép'),
    station: tx('Island', 'Sziget'),
    caption: tx('The machine’s settings, password, invites, signed-in devices and the audit log.', 'A gép beállításai, jelszó, meghívók, belépett eszközök és az audit napló.'),
  },
];

export interface FocusInfo {
  servers: HubServer[];
  selectedId: string | null;
  installing: boolean;
}

const toHub = (s: ServerSummary): HubServer => ({
  id: s.id,
  name: s.name,
  versionName: s.versionName,
  mcVersion: s.mcVersion,
  loader: s.loader,
  iconUrl: s.iconUrl,
  websiteUrl: s.websiteUrl,
  state: s.state,
  players: s.players.length,
  playerNames: s.players,
  maxPlayers: s.maxPlayers,
  motd: s.motd,
  gameAddress: s.gameAddress || null,
});

/** One machine: its public card, and the admin console once signed in. */
export function IslandView({
  node,
  tab,
  serverId,
  navigate,
  onLogin,
  onFocusInfo,
}: {
  node: HubNode;
  tab: Tab;
  serverId: string | null;
  navigate: (tab: Tab, serverId: string | null) => void;
  onLogin: () => void;
  onFocusInfo: (info: FocusInfo) => void;
}) {
  const { client, signedIn, live } = node;
  const t = useT();
  const online = live.reach === 'online';
  const [eulaRetry, setEulaRetry] = useState<(() => Promise<void>) | null>(null);

  const overview = usePoll(() => client.get<NodeOverview>('/api/v1/node'), 5000, [client, signedIn], signedIn && online);
  const owned = usePoll(() => client.get<{ servers: ServerSummary[] }>('/api/v1/servers'), 3000, [client, signedIn], signedIn && online);
  const pub = usePoll(() => client.publicGet<{ servers: PublicServer[] }>('/api/v1/status'), 5000, [client], !signedIn && online && live.publicStatus);

  const servers: HubServer[] | null = signedIn
    ? (owned.data?.servers.map(toHub) ?? live.servers)
    : live.publicStatus
      ? (pub.data?.servers.map((s) => ({ ...s, playerNames: [] })) ?? live.servers)
      : null;
  const fallbackId = servers?.find((s) => s.state === 'running')?.id ?? servers?.[0]?.id ?? null;
  const selectedId = servers?.some((s) => s.id === serverId) ? serverId : fallbackId;
  const selected = owned.data?.servers.find((s) => s.id === selectedId) ?? null;
  const installing = overview.data?.installing ?? false;

  const serversKey = JSON.stringify(servers?.map((s) => [s.id, s.state, s.playerNames]) ?? null);
  useEffect(() => {
    onFocusInfo({ servers: servers ?? [], selectedId, installing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serversKey, selectedId, installing]);

  // A save must show up everywhere at once: in this view and in the hub (island name, server list, 3D world).
  const hub = useHub();
  const refreshHub = useRef(() => {});
  refreshHub.current = () => void hub.refreshNode(node.rec.nodeId);
  const refreshAll = useMemo(
    () => () => {
      overview.refresh();
      owned.refresh();
      refreshHub.current();
    },
    [overview.refresh, owned.refresh],
  );

  const current = TABS.find((t) => t.id === tab)!;
  const select = (id: string) => navigate(tab, id);

  return (
    <NodeProvider value={node}>
      <section className="relative mx-auto flex min-h-svh max-w-[1440px] flex-col justify-end px-[var(--shell-pad)] pt-[calc(var(--nav-h)+32px)] pb-10 lg:justify-center lg:pb-24">
        <div className="w-full max-w-[580px] space-y-4">
          {live.reach === 'key-changed' && <KeyChanged node={node} />}
          <IslandHero node={node} servers={servers} selectedId={selectedId} onSelect={select} onLogin={onLogin} />
        </div>
        {signedIn && online && (
          <a href="#admin" onClick={(e) => (e.preventDefault(), document.getElementById('admin')?.scrollIntoView({ behavior: 'smooth' }))} className="label absolute bottom-6 left-1/2 hidden -translate-x-1/2 items-center gap-2 hover:text-fg lg:inline-flex">
            {t('Admin console', 'Admin konzol')} <ArrowDown className="size-3.5 animate-bounce" />
          </a>
        )}
      </section>

      {signedIn && online && (
        <section id="admin" className="relative scroll-mt-[var(--nav-h)]">
          {/* Station window: the camera frames the tab's station in this gap. */}
          <div className="mx-auto flex h-[44svh] min-h-72 max-w-[1440px] items-end px-[var(--shell-pad)] pb-8">
            <div key={tab} className="brackets glass animate-rise max-w-md border border-line px-5 py-4">
              <p className="label">
                <span className="text-signal">[02]</span> {node.rec.name} · {t('Station', 'Állomás')}: {t(current.station)}
              </p>
              <p className="text-display-sm mt-2">{t(current.label)}</p>
              <p className="mt-2 text-sm text-fg-muted">{t(current.caption)}</p>
            </div>
          </div>

          <nav className="sticky top-[var(--nav-h)] z-20 border-y border-line bg-bg/90 backdrop-blur-xl" aria-label={t('Admin tabs', 'Admin fülek')}>
            <div className="mx-auto flex max-w-[1440px] items-center overflow-x-auto px-[var(--shell-pad)]">
              {TABS.map((tb, i) => (
                <button
                  key={tb.id}
                  onClick={() => navigate(tb.id, selectedId)}
                  aria-current={tab === tb.id ? 'page' : undefined}
                  className={`relative flex h-12 shrink-0 items-center gap-2 px-4 font-mono text-xs tracking-[0.08em] uppercase transition-colors first:pl-0 ${
                    tab === tb.id ? 'text-fg' : 'text-fg-faint hover:text-fg-muted'
                  }`}
                >
                  <span className={tab === tb.id ? 'text-signal' : ''}>{String(i + 1).padStart(2, '0')}</span>
                  {t(tb.label)}
                  {tab === tb.id && <span className={`absolute bottom-0 h-0.5 bg-signal ${i === 0 ? 'right-4 left-0' : 'inset-x-4'}`} />}
                </button>
              ))}
              {selected && tab !== 'machine' && tab !== 'packs' && (
                <span className="label ml-auto hidden shrink-0 truncate pl-4 md:block">{t('Server', 'Szerver')}: {selected.name}</span>
              )}
            </div>
          </nav>

          <div className="min-h-svh border-b border-line bg-bg/[0.86] backdrop-blur-xl">
            <div className="mx-auto max-w-[1440px] px-[var(--shell-pad)] py-8 lg:py-10">
              {overview.data && owned.data ? (
                <>
                  {tab === 'control' && <ControlTab server={selected} refresh={refreshAll} onNeedEula={(retry) => setEulaRetry(() => retry)} goToPacks={() => navigate('packs', selectedId)} />}
                  {tab === 'packs' && (
                    <PacksTab curseforgeConfigured={overview.data.curseforgeConfigured} onInstalled={refreshAll} onStartServer={(id) => navigate('control', id)} />
                  )}
                  {tab === 'servers' && (
                    <ServersTab
                      servers={owned.data.servers}
                      overview={overview.data}
                      selectedId={selectedId}
                      onSelect={(id) => navigate('control', id)}
                      refresh={refreshAll}
                      onNeedEula={(retry) => setEulaRetry(() => retry)}
                    />
                  )}
                  {tab === 'settings' && <SettingsTab server={selected} overview={overview.data} refresh={refreshAll} />}
                  {tab === 'machine' && <MachineTab overview={overview.data} refresh={refreshAll} />}
                </>
              ) : overview.error ? (
                <Notice tone="danger">{overview.error.message}</Notice>
              ) : (
                <Skeleton className="h-96" />
              )}
            </div>
          </div>
          <EulaModal retry={eulaRetry} onClose={() => setEulaRetry(null)} />
        </section>
      )}
    </NodeProvider>
  );
}

/** The machine answered with another key than the pinned one: like SSH, stop and ask. */
function KeyChanged({ node }: { node: HubNode }) {
  const hub = useHub();
  const t = useT();
  const next = node.live.newKey;
  return (
    <div className="brackets glass border border-danger/50 p-5 sm:p-6">
      <p className="flex items-center gap-2 font-semibold text-danger">
        <ShieldAlert className="size-5" aria-hidden /> {t('The machine key has changed', 'A gép kulcsa megváltozott')}
      </p>
      <p className="mt-3 text-sm text-fg-muted">
        {t(
          'A machine with a different key now answers at this address. That is fine if the owner reinstalled the backend (or deleted its data folder). If you do not know about that, do not sign in: another machine may be sitting at the address.',
          'Ezen a címen most egy másik kulcsú gép válaszol. Ez akkor rendben van, ha a tulajdonos újratelepítette a backendet (vagy törölte a data mappát). Ha nem tudsz róla, ne lépj be: lehet, hogy más gép ül a címen.',
        )}
      </p>
      <dl className="readout mt-4 grid gap-1 text-xs">
        <div>
          <dt className="inline text-fg-faint">{t('Saved', 'Elmentett')}: </dt>
          <dd className="inline">{groupFingerprint(node.rec.nodeId)}</dd>
        </div>
        <div>
          <dt className="inline text-fg-faint">{t('Now', 'Most')}: </dt>
          <dd className="inline">{next ? groupFingerprint(next.nodeId) : t('unknown', 'ismeretlen')}</dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={!next}
          onClick={async () => {
            const id = await hub.acceptNewKey(node.rec.nodeId);
            if (id) location.hash = `#/n/${id}`;
          }}
        >
          {t('Accept the new key', 'Új kulcs elfogadása')}
        </Button>
        <Button variant="ghost" onClick={() => void hub.removeNode(node.rec.nodeId)}>
          {t('Remove from the list', 'Eltávolítás a listából')}
        </Button>
      </div>
    </div>
  );
}
