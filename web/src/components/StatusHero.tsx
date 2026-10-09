import { Check, Copy, ExternalLink, Power, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { LOADER_LABEL } from '../format';
import type { PublicStatus } from '../types';
import { Button, PackIcon, Skeleton, StateLabel } from './ui';

/** The public server card floating over the island. */
export function StatusHero({ status }: { status: PublicStatus }) {
  const inst = status.instance;
  return (
    <div className="brackets glass animate-rise border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-7">
        <span className="label">
          <span className="text-signal">[01]</span> Szerver állapot
        </span>
        <StateLabel state={status.state} />
      </div>

      <div className="px-5 pt-6 pb-7 sm:px-7">
        <div className="flex items-start gap-4">
          {inst?.iconUrl && <PackIcon src={inst.iconUrl} eager className="mt-1 size-14 shrink-0 sm:size-16" />}
          <h1 className="text-display line-clamp-3 break-words">{inst?.name ?? 'Még nincs szerver'}</h1>
        </div>
        {status.motd && status.motd !== inst?.name && <p className="mt-4 max-w-md text-fg-muted">{status.motd}</p>}
        {!inst && <p className="mt-4 max-w-md text-fg-muted">Az admin a panelen választhat modpacket vagy vanilla verziót.</p>}
        {inst?.websiteUrl && (
          <a href={inst.websiteUrl} target="_blank" rel="noreferrer" className="label mt-4 inline-flex items-center gap-1.5 hover:text-fg">
            Modpack oldala <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      <dl className="grid grid-cols-3 border-y border-line">
        <Readout label="Játékosok" value={status.state === 'running' ? `${status.players}/${status.maxPlayers}` : '–'} signal={status.players > 0} />
        <Readout label="Verzió" value={inst?.mcVersion ?? '–'} />
        <Readout label="Loader" value={inst ? LOADER_LABEL[inst.loader] : '–'} />
      </dl>

      <AddressBar address={status.gameAddress} />
    </div>
  );
}

function Readout({ label, value, signal = false }: { label: string; value: string; signal?: boolean }) {
  return (
    <div className="border-r border-line px-5 py-4 last:border-r-0 sm:px-7">
      <dt className="label">{label}</dt>
      <dd className={`readout mt-1.5 truncate text-lg ${signal ? 'text-signal' : ''}`}>{value}</dd>
    </div>
  );
}

function AddressBar({ address }: { address: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the address stays selectable */
    }
  };
  return (
    <div className="px-5 py-5 sm:px-7">
      <span className="label">Csatlakozás</span>
      {address ? (
        <div className="mt-2 flex items-stretch">
          <code className="readout flex min-w-0 flex-1 items-center truncate border border-r-0 border-line-strong bg-bg/70 px-3 text-sm select-all sm:text-base">{address}</code>
          <button onClick={copy} className="inline-flex h-11 shrink-0 items-center gap-2 bg-signal px-4 font-mono text-xs font-semibold tracking-[0.08em] text-signal-ink uppercase hover:bg-signal-hover">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Másolva' : 'Másolás'}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-fg-faint">A cím még nincs beállítva.</p>
      )}
    </div>
  );
}

export function OfflineHero({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="brackets glass animate-rise border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-7">
        <span className="label">
          <span className="text-signal">[01]</span> Szervergép
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-xs tracking-[0.08em] text-fg-muted uppercase">
          <span className="size-2 bg-fg-faint" aria-hidden /> Nem elérhető
        </span>
      </div>
      <div className="px-5 py-7 sm:px-7">
        <Power className="mb-5 size-7 text-fg-faint" aria-hidden />
        <h1 className="text-display">A szervergép alszik</h1>
        <p className="mt-4 max-w-md text-fg-muted">Amint bekapcsolom, itt megjelenik a szerver állapota és a csatlakozási cím. Az oldal magától újrapróbálja.</p>
        <Button onClick={onRetry} className="mt-6" icon={<RefreshCw className="size-4" />}>
          Újrapróbálás
        </Button>
        <p className="mt-6 max-w-md border-t border-line pt-4 text-xs text-fg-faint">
          Tailscale-t futtató gépen a böngésző engedélyt kér a „helyi hálózati eszközök” eléréséhez. Ezt engedélyezd, különben az oldal nem éri el a
          szervergépet.
        </p>
      </div>
    </div>
  );
}

export function LoadingHero() {
  return (
    <div className="brackets glass border border-line p-7">
      <span className="label">
        <span className="text-signal">[01]</span> Kapcsolódás<span className="animate-blink">_</span>
      </span>
      <Skeleton className="mt-6 h-16 w-4/5" />
      <Skeleton className="mt-3 h-16 w-3/5" />
      <Skeleton className="mt-8 h-12 w-full" />
    </div>
  );
}
