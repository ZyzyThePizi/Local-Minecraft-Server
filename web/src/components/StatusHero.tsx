import { Check, Copy, ExternalLink, Users } from 'lucide-react';
import { useState } from 'react';
import { LOADER_LABEL } from '../format';
import type { PublicStatus } from '../types';
import { Chip, PackIcon, StatePill } from './ui';

export function StatusHero({ status }: { status: PublicStatus }) {
  const inst = status.instance;
  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-7">
        <PackIcon src={inst?.iconUrl} eager className="size-20 shrink-0 sm:size-24" />
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatePill state={status.state} />
            {status.state === 'running' && (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                <Users className="size-4" aria-hidden />
                {status.players} / {status.maxPlayers} játékos
              </span>
            )}
          </div>
          <h1 className="line-clamp-2 text-2xl break-words font-bold tracking-tight sm:text-3xl">{inst?.name ?? 'Még nincs szerver telepítve'}</h1>
          {inst && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip>Minecraft {inst.mcVersion}</Chip>
              <Chip tone={inst.loader === 'vanilla' ? 'neutral' : 'info'}>{LOADER_LABEL[inst.loader]}</Chip>
              {inst.versionName && inst.versionName !== inst.mcVersion && <Chip>{inst.versionName}</Chip>}
              {inst.websiteUrl && (
                <a href={inst.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
                  Modpack oldala <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
      <AddressBar address={status.gameAddress} />
    </section>
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
    <div className="flex flex-col gap-3 border-t border-line bg-surface-2/60 px-5 py-4 sm:flex-row sm:items-center sm:px-7">
      <span className="text-sm text-muted">Csatlakozás:</span>
      {address ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm select-all">{address}</code>
          <button
            onClick={copy}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink hover:bg-accent-strong"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Másolva' : 'Másolás'}
          </button>
        </div>
      ) : (
        <span className="text-sm text-muted/80">A cím még nincs beállítva.</span>
      )}
    </div>
  );
}
