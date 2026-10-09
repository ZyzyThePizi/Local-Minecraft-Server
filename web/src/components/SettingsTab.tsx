import { ChevronDown, Save } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, patch, put } from '../api';
import { formatMemory } from '../format';
import type { InstanceSummary, Overview, Settings } from '../types';
import { Button, Field, inputClass, Notice, Panel, PanelTitle, Skeleton, Toggle } from './ui';

type Props = Record<string, string>;

// The settings most people touch; everything else is under "Haladó".
const FIELDS: { group: string; items: { key: string; label: string; type: 'text' | 'number' | 'bool' | 'select'; options?: [string, string][]; hint?: string }[] }[] = [
  {
    group: 'Általános',
    items: [
      { key: 'motd', label: 'Szerver leírása (MOTD)', type: 'text', hint: 'Ez látszik a szerverlistában.' },
      { key: 'max-players', label: 'Max. játékos', type: 'number' },
      {
        key: 'difficulty',
        label: 'Nehézség',
        type: 'select',
        options: [['peaceful', 'Békés'], ['easy', 'Könnyű'], ['normal', 'Normál'], ['hard', 'Nehéz']],
      },
      {
        key: 'gamemode',
        label: 'Játékmód',
        type: 'select',
        options: [['survival', 'Túlélő'], ['creative', 'Kreatív'], ['adventure', 'Kaland'], ['spectator', 'Néző']],
      },
      { key: 'pvp', label: 'PvP', type: 'bool' },
      { key: 'hardcore', label: 'Hardcore', type: 'bool' },
    ],
  },
  {
    group: 'Világ',
    items: [
      { key: 'level-seed', label: 'Seed', type: 'text', hint: 'Csak új világnál számít.' },
      { key: 'view-distance', label: 'Látótávolság (chunk)', type: 'number' },
      { key: 'simulation-distance', label: 'Szimulációs távolság (chunk)', type: 'number' },
      { key: 'spawn-protection', label: 'Spawn védelem (blokk)', type: 'number' },
      { key: 'allow-nether', label: 'Nether engedélyezése', type: 'bool' },
      { key: 'allow-flight', label: 'Repülés engedélyezése', type: 'bool', hint: 'Modpackeknél érdemes bekapcsolni, különben kidobhatja a játékosokat.' },
    ],
  },
  {
    group: 'Hozzáférés',
    items: [
      { key: 'white-list', label: 'Whitelist', type: 'bool', hint: 'Csak a felvett játékosok léphetnek be. Felvétel a konzolban: whitelist add Név' },
      { key: 'enforce-whitelist', label: 'Whitelist kikényszerítése', type: 'bool' },
      { key: 'online-mode', label: 'Online mód (eredeti fiók kell)', type: 'bool', hint: 'Kikapcsolva bárki bármilyen névvel beléphet, ezt ne kapcsold ki.' },
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

export function SettingsTab({ overview, refresh }: { overview: Overview; refresh: () => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-5">
        <PanelSettings settings={overview.settings} refresh={refresh} />
        {overview.instance && <MemorySettings key={overview.instance.id} instance={overview.instance} overview={overview} refresh={refresh} />}
      </div>
      <div className="lg:col-span-7">
        {overview.instance ? (
          <PropertiesEditor key={overview.instance.id} running={overview.server.state !== 'stopped' && overview.server.state !== 'crashed'} />
        ) : (
          <Panel>
            <p className="text-sm text-fg-muted">A server.properties egy szerver telepítése után szerkeszthető.</p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function SaveRow({ busy, dirty, onSave, message }: { busy: boolean; dirty: boolean; onSave: () => void; message: ReactNode }) {
  return (
    <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-4">
      {message}
      <Button variant="primary" busy={busy} disabled={!dirty} onClick={onSave} icon={<Save className="size-4" />}>
        Mentés
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
      setMessage((await fn()) ?? <span className="label !text-signal">Elmentve</span>);
    } catch (err) {
      setMessage(<span className="text-sm text-danger">{err instanceof ApiError ? err.message : 'Nem sikerült menteni.'}</span>);
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, run };
}

const restartNote = <span className="text-sm text-warn">Elmentve, újraindítás után lép életbe.</span>;

function PanelSettings({ settings, refresh }: { settings: Settings; refresh: () => void }) {
  const [address, setAddress] = useState(settings.gameAddress);
  const saver = useSaver();
  const toggle = (key: 'autoStart' | 'eulaAccepted', value: boolean) =>
    saver.run(async () => {
      await put('/api/admin/settings', { [key]: value });
      refresh();
    });

  return (
    <Panel>
      <PanelTitle>Panel</PanelTitle>
      <div className="space-y-5">
        <Field label="Csatlakozási cím a játékosoknak" hint="Pl. a playit.gg-től kapott cím. Ez jelenik meg a nyilvános oldalon.">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="valami.joinmc.link" className={`${inputClass} readout`} />
        </Field>
        <Toggle checked={settings.autoStart} onChange={(v) => toggle('autoStart', v)} label="Automatikus indítás" hint="A backend indulásakor a Minecraft szerver is elindul." />
        <Toggle
          checked={settings.eulaAccepted}
          onChange={(v) => toggle('eulaAccepted', v)}
          label="Minecraft EULA elfogadva"
          hint={
            <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="text-signal hover:underline">
              EULA elolvasása
            </a>
          }
        />
      </div>
      <SaveRow
        busy={saver.busy}
        dirty={address.trim() !== settings.gameAddress}
        message={saver.message}
        onSave={() =>
          saver.run(async () => {
            await put('/api/admin/settings', { gameAddress: address });
            refresh();
          })
        }
      />
    </Panel>
  );
}

function MemorySettings({ instance, overview, refresh }: { instance: InstanceSummary; overview: Overview; refresh: () => void }) {
  const [memory, setMemory] = useState(instance.memoryMb);
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs);
  const saver = useSaver();
  const max = Math.max(1024, Math.floor((overview.system.totalMemoryMb - 2048) / 512) * 512);

  return (
    <Panel>
      <PanelTitle aside={<span className="readout text-lg text-signal">{formatMemory(memory)}</span>}>
        Memória
      </PanelTitle>
      <input type="range" min={1024} max={max} step={512} value={memory} onChange={(e) => setMemory(Number(e.target.value))} className="w-full" aria-label="Memória (MB)" />
      <div className="label mt-2 flex justify-between gap-3 !text-[11px]">
        <span>1 GB</span>
        <span>
          Ajánlott: {formatMemory(overview.system.recommendedMemoryMb)} · Gép: {formatMemory(overview.system.totalMemoryMb)}
        </span>
      </div>
      <details className="group mt-5">
        <summary className="label flex cursor-pointer list-none items-center gap-1 hover:text-fg">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          További JVM argumentumok
        </summary>
        <input value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} placeholder="-XX:+UseG1GC" className={`${inputClass} readout mt-3`} />
      </details>
      <SaveRow
        busy={saver.busy}
        dirty={memory !== instance.memoryMb || jvmArgs !== instance.jvmArgs}
        message={saver.message}
        onSave={() =>
          saver.run(async () => {
            const res = await patch<{ restartRequired: boolean }>(`/api/admin/instances/${instance.id}`, { memoryMb: memory, jvmArgs });
            refresh();
            if (res.restartRequired) return restartNote;
          })
        }
      />
    </Panel>
  );
}

function PropertiesEditor({ running }: { running: boolean }) {
  const [original, setOriginal] = useState<Props | null>(null);
  const [values, setValues] = useState<Props>({});
  const [error, setError] = useState<string | null>(null);
  const saver = useSaver();

  useEffect(() => {
    get<{ properties: Props }>('/api/admin/properties')
      .then(({ properties }) => {
        setOriginal(properties);
        setValues(properties);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);

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
      <PanelTitle aside={dirty && <span className="label !text-warn">{Object.keys(changes).length} módosítás</span>}>
        server.properties
      </PanelTitle>
      {Object.keys(original).length === 0 && (
        <div className="mb-5">
          <Notice>A fájl az első indításkor jön létre teljesen. Amit itt beállítasz, az már az első indításnál érvényes lesz.</Notice>
        </div>
      )}
      <div className="space-y-8">
        {FIELDS.map((group) => (
          <fieldset key={group.group}>
            <legend className="label mb-4 !text-fg-muted">{group.group}</legend>
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {group.items.map((f) =>
                f.type === 'bool' ? (
                  <Toggle key={f.key} checked={value(f.key) === 'true'} onChange={(v) => set(f.key, String(v))} label={f.label} hint={f.hint} />
                ) : (
                  <div key={f.key} className={f.key === 'motd' ? 'sm:col-span-2' : ''}>
                    <Field label={f.label} hint={f.hint}>
                      {f.type === 'select' ? (
                        <select value={value(f.key)} onChange={(e) => set(f.key, e.target.value)} className={inputClass}>
                          {f.options!.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
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
              Haladó · {advanced.length} további beállítás
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
            const res = await put<{ properties: Props; restartRequired: boolean }>('/api/admin/properties', { properties: changes });
            setOriginal(res.properties);
            setValues(res.properties);
            if (running) return restartNote;
          })
        }
      />
    </Panel>
  );
}
