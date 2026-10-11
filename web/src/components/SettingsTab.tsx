import { ChevronDown, Save } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { useApi } from '../hub/HubProvider';
import { formatMemory } from '../format';
import { tr, tx, useT, type Text } from '../i18n';
import type { NodeOverview, ServerSummary } from '../types';
import { Button, Field, inputClass, Notice, Panel, PanelTitle, Skeleton, Toggle } from './ui';

type Props = Record<string, string>;

// The settings most people touch; everything else is under "Advanced".
const FIELDS: { group: Text; items: { key: string; label: Text; type: 'text' | 'number' | 'bool' | 'select'; options?: [string, Text][]; hint?: Text }[] }[] = [
  {
    group: tx('General', 'Általános'),
    items: [
      { key: 'motd', label: tx('Server description (MOTD)', 'Szerver leírása (MOTD)'), type: 'text', hint: tx('This shows in the server list.', 'Ez látszik a szerverlistában.') },
      { key: 'max-players', label: tx('Max players', 'Max. játékos'), type: 'number' },
      {
        key: 'difficulty',
        label: tx('Difficulty', 'Nehézség'),
        type: 'select',
        options: [
          ['peaceful', tx('Peaceful', 'Békés')],
          ['easy', tx('Easy', 'Könnyű')],
          ['normal', tx('Normal', 'Normál')],
          ['hard', tx('Hard', 'Nehéz')],
        ],
      },
      {
        key: 'gamemode',
        label: tx('Game mode', 'Játékmód'),
        type: 'select',
        options: [
          ['survival', tx('Survival', 'Túlélő')],
          ['creative', tx('Creative', 'Kreatív')],
          ['adventure', tx('Adventure', 'Kaland')],
          ['spectator', tx('Spectator', 'Néző')],
        ],
      },
      { key: 'pvp', label: tx('PvP', 'PvP'), type: 'bool' },
      { key: 'hardcore', label: tx('Hardcore', 'Hardcore'), type: 'bool' },
    ],
  },
  {
    group: tx('World', 'Világ'),
    items: [
      { key: 'level-seed', label: tx('Seed', 'Seed'), type: 'text', hint: tx('Only matters for a new world.', 'Csak új világnál számít.') },
      { key: 'view-distance', label: tx('View distance (chunks)', 'Látótávolság (chunk)'), type: 'number' },
      { key: 'simulation-distance', label: tx('Simulation distance (chunks)', 'Szimulációs távolság (chunk)'), type: 'number' },
      { key: 'spawn-protection', label: tx('Spawn protection (blocks)', 'Spawn védelem (blokk)'), type: 'number' },
      { key: 'allow-nether', label: tx('Allow the Nether', 'Nether engedélyezése'), type: 'bool' },
      {
        key: 'allow-flight',
        label: tx('Allow flight', 'Repülés engedélyezése'),
        type: 'bool',
        hint: tx('Worth switching on for modpacks, otherwise players may get kicked.', 'Modpackeknél érdemes bekapcsolni, különben kidobhatja a játékosokat.'),
      },
    ],
  },
  {
    group: tx('Access', 'Hozzáférés'),
    items: [
      {
        key: 'white-list',
        label: tx('Whitelist', 'Whitelist'),
        type: 'bool',
        hint: tx('Only listed players can join. Add them in the console: whitelist add Name', 'Csak a felvett játékosok léphetnek be. Felvétel a konzolban: whitelist add Név'),
      },
      { key: 'enforce-whitelist', label: tx('Enforce the whitelist', 'Whitelist kikényszerítése'), type: 'bool' },
      {
        key: 'online-mode',
        label: tx('Online mode (needs a real account)', 'Online mód (eredeti fiók kell)'),
        type: 'bool',
        hint: tx('Switched off, anyone can join under any name. Leave it on.', 'Kikapcsolva bárki bármilyen névvel beléphet, ezt ne kapcsold ki.'),
      },
    ],
  },
];

const DEFAULTS: Props = {
  'max-players': '20',
  difficulty: 'easy',
  gamemode: 'survival',
  pvp: 'true',
  hardcore: 'false',
  'view-distance': '10',
  'simulation-distance': '10',
  'spawn-protection': '16',
  'allow-nether': 'true',
  'allow-flight': 'false',
  'white-list': 'false',
  'enforce-whitelist': 'false',
  'online-mode': 'true',
};

/** Settings of the selected server: join address, autostart, memory and server.properties. */
export function SettingsTab({ server, overview, refresh }: { server: ServerSummary | null; overview: NodeOverview; refresh: () => void }) {
  const t = useT();
  if (!server) {
    return (
      <Panel>
        <p className="text-sm text-fg-muted">{t('The settings can be edited once a server is installed.', 'A beállítások egy szerver telepítése után szerkeszthetők.')}</p>
      </Panel>
    );
  }
  const running = server.state !== 'stopped' && server.state !== 'crashed';
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-5">
        <ServerSettings key={`s-${server.id}`} server={server} refresh={refresh} />
        <MemorySettings key={`m-${server.id}`} server={server} overview={overview} refresh={refresh} />
      </div>
      <div className="lg:col-span-7">
        <PropertiesEditor key={server.id} serverId={server.id} running={running} />
      </div>
    </div>
  );
}

function SaveRow({ busy, dirty, onSave, message }: { busy: boolean; dirty: boolean; onSave: () => void; message: ReactNode }) {
  const t = useT();
  return (
    <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-4">
      {message}
      <Button variant="primary" busy={busy} disabled={!dirty} onClick={onSave} icon={<Save className="size-4" />}>
        {t('Save', 'Mentés')}
      </Button>
    </div>
  );
}

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ReactNode>(null);
  const run = async (fn: () => Promise<ReactNode | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage((await fn()) ?? <span className="label !text-signal">{tr('Saved', 'Elmentve')}</span>);
    } catch (err) {
      setMessage(<span className="text-sm text-danger">{err instanceof ApiError ? err.message : tr('Could not save.', 'Nem sikerült menteni.')}</span>);
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, run };
}

const restartNote = () => <span className="text-sm text-warn">{tr('Saved; it takes effect after a restart.', 'Elmentve, újraindítás után lép életbe.')}</span>;

function ServerSettings({ server, refresh }: { server: ServerSummary; refresh: () => void }) {
  const api = useApi();
  const t = useT();
  const [address, setAddress] = useState(server.gameAddress);
  const saver = useSaver();
  const save = (body: Record<string, unknown>) =>
    saver.run(async () => {
      await api.patch(`/api/v1/servers/${server.id}`, body);
      refresh();
    });

  return (
    <Panel>
      <PanelTitle aside={<span className="readout text-sm text-fg-muted">port {server.port}</span>}>{t('Server', 'Szerver')}</PanelTitle>
      <div className="space-y-5">
        <Field
          label={t('Join address for players', 'Csatlakozási cím a játékosoknak')}
          hint={
            <>
              {t('The playit.gg tunnel of this server. On playit.gg the tunnel’s local address is:', 'Ennek a szervernek a playit.gg tunnelje. A playit.gg-n a tunnel helyi címe:')}{' '}
              <span className="readout text-fg-muted">127.0.0.1:{server.port}</span>
            </>
          }
        >
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('something.joinmc.link', 'valami.joinmc.link')} className={`${inputClass} readout`} />
        </Field>
        <Toggle
          checked={server.autoStart}
          onChange={(v) => save({ autoStart: v })}
          label={t('Auto start', 'Automatikus indítás')}
          hint={t('This server starts together with the backend.', 'A backend indulásakor ez a szerver is elindul.')}
        />
      </div>
      <SaveRow busy={saver.busy} dirty={address.trim() !== server.gameAddress} message={saver.message} onSave={() => save({ gameAddress: address })} />
    </Panel>
  );
}

function MemorySettings({ server: instance, overview, refresh }: { server: ServerSummary; overview: NodeOverview; refresh: () => void }) {
  const api = useApi();
  const t = useT();
  const [memory, setMemory] = useState(instance.memoryMb);
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs);
  const saver = useSaver();
  const max = Math.max(1024, Math.floor((overview.system.totalMemoryMb - 2048) / 512) * 512);

  return (
    <Panel>
      <PanelTitle aside={<span className="readout text-lg text-signal">{formatMemory(memory)}</span>}>{t('Memory', 'Memória')}</PanelTitle>
      <input type="range" min={1024} max={max} step={512} value={memory} onChange={(e) => setMemory(Number(e.target.value))} className="w-full" aria-label={t('Memory (MB)', 'Memória (MB)')} />
      <div className="label mt-2 flex justify-between gap-3 !text-[11px]">
        <span>1 GB</span>
        <span>
          {t('Recommended', 'Ajánlott')}: {formatMemory(overview.system.recommendedMemoryMb)} · {t('Machine', 'Gép')}: {formatMemory(overview.system.totalMemoryMb)}
        </span>
      </div>
      <details className="group mt-5">
        <summary className="label flex cursor-pointer list-none items-center gap-1 hover:text-fg">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          {t('More JVM arguments', 'További JVM argumentumok')}
        </summary>
        <input value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} placeholder="-XX:+UseG1GC" className={`${inputClass} readout mt-3`} />
      </details>
      <SaveRow
        busy={saver.busy}
        dirty={memory !== instance.memoryMb || jvmArgs !== instance.jvmArgs}
        message={saver.message}
        onSave={() =>
          saver.run(async () => {
            const res = await api.patch<{ restartRequired: boolean }>(`/api/v1/servers/${instance.id}`, { memoryMb: memory, jvmArgs });
            refresh();
            if (res.restartRequired) return restartNote();
          })
        }
      />
    </Panel>
  );
}

function PropertiesEditor({ serverId, running }: { serverId: string; running: boolean }) {
  const api = useApi();
  const t = useT();
  const [original, setOriginal] = useState<Props | null>(null);
  const [values, setValues] = useState<Props>({});
  const [error, setError] = useState<string | null>(null);
  const saver = useSaver();

  useEffect(() => {
    api
      .get<{ properties: Props }>(`/api/v1/servers/${serverId}/properties`)
      .then(({ properties }) => {
        setOriginal(properties);
        setValues(properties);
      })
      .catch((err: ApiError) => setError(err.message));
  }, [api, serverId]);

  const value = (key: string) => values[key] ?? DEFAULTS[key] ?? '';
  const set = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));
  const changes = useMemo(() => {
    if (!original) return {};
    return Object.fromEntries(Object.entries(values).filter(([k, v]) => original[k] !== v));
  }, [values, original]);
  const dirty = Object.keys(changes).length > 0;
  const known = new Set(FIELDS.flatMap((g) => g.items.map((i) => i.key)));
  const advanced = Object.keys(values)
    .filter((k) => !known.has(k))
    .sort();

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!original) return <Skeleton className="h-[640px]" />;

  return (
    <Panel>
      <PanelTitle aside={dirty && <span className="label !text-warn">{t(`${Object.keys(changes).length} changes`, `${Object.keys(changes).length} módosítás`)}</span>}>
        server.properties
      </PanelTitle>
      {Object.keys(original).length === 0 && (
        <div className="mb-5">
          <Notice>
            {t('The file is only complete after the first start. What you set here already applies on that first start.', 'A fájl az első indításkor jön létre teljesen. Amit itt beállítasz, az már az első indításnál érvényes lesz.')}
          </Notice>
        </div>
      )}
      <div className="space-y-8">
        {FIELDS.map((group) => (
          <fieldset key={group.group.en}>
            <legend className="label mb-4 !text-fg-muted">{t(group.group)}</legend>
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {group.items.map((f) =>
                f.type === 'bool' ? (
                  <Toggle key={f.key} checked={value(f.key) === 'true'} onChange={(v) => set(f.key, String(v))} label={t(f.label)} hint={f.hint && t(f.hint)} />
                ) : (
                  <div key={f.key} className={f.key === 'motd' ? 'sm:col-span-2' : ''}>
                    <Field label={t(f.label)} hint={f.hint && t(f.hint)}>
                      {f.type === 'select' ? (
                        <select value={value(f.key)} onChange={(e) => set(f.key, e.target.value)} className={inputClass}>
                          {f.options!.map(([v, l]) => (
                            <option key={v} value={v}>
                              {t(l)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={f.type}
                          value={value(f.key)}
                          onChange={(e) => set(f.key, e.target.value)}
                          className={`${inputClass} ${f.type === 'number' ? 'readout' : ''}`}
                          maxLength={f.key === 'motd' ? 59 : undefined}
                        />
                      )}
                    </Field>
                  </div>
                ),
              )}
            </div>
          </fieldset>
        ))}

        {advanced.length > 0 && (
          <details className="group">
            <summary className="label flex cursor-pointer list-none items-center gap-1 hover:text-fg">
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              {t(`Advanced · ${advanced.length} more settings`, `Haladó · ${advanced.length} további beállítás`)}
            </summary>
            <div className="mt-3 divide-y divide-line border border-line">
              {advanced.map((k) => (
                <label key={k} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-4">
                  <span className="readout text-xs text-fg-faint sm:w-64 sm:shrink-0">{k}</span>
                  <input value={values[k] ?? ''} onChange={(e) => set(k, e.target.value)} className={`${inputClass} readout h-8 text-xs`} />
                </label>
              ))}
            </div>
          </details>
        )}
      </div>
      <SaveRow
        busy={saver.busy}
        dirty={dirty}
        message={saver.message}
        onSave={() =>
          saver.run(async () => {
            const res = await api.put<{ properties: Props; restartRequired: boolean }>(`/api/v1/servers/${serverId}/properties`, { properties: changes });
            setOriginal(res.properties);
            setValues(res.properties);
            if (running) return restartNote();
          })
        }
      />
    </Panel>
  );
}
