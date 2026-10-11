import { getLang, tr, tx, type Text } from './i18n';
import type { Loader, ServerState } from './types';

export const LOADER_LABEL: Record<Loader, string> = {
  vanilla: 'Vanilla',
  forge: 'Forge',
  neoforge: 'NeoForge',
  fabric: 'Fabric',
  quilt: 'Quilt',
};

export const STATE_LABEL: Record<ServerState, Text> = {
  running: tx('Online', 'Online'),
  starting: tx('Starting…', 'Indul…'),
  stopping: tx('Stopping…', 'Leáll…'),
  stopped: tx('Offline', 'Offline'),
  crashed: tx('Crashed', 'Összeomlott'),
};

const locale = () => (getLang() === 'hu' ? 'hu-HU' : 'en-GB');

export function compactNumber(n: number) {
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
}

export function formatMemory(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${mb} MB`;
}

export function uptime(since: number) {
  const s = Math.floor((Date.now() - since) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return tr(`${h} h ${m} min`, `${h} óra ${m} perc`);
  return m ? tr(`${m} min`, `${m} perc`) : tr(`${s} s`, `${s} mp`);
}

export function formatDateTime(ms: number) {
  return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

export function relativeTime(ms: number) {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  return rtf.format(Math.round(diff / 86400_000), 'day');
}

/** Compares dotted versions ("1.20.1" ≥ "1.19.4"); anything after the numbers (a "-pre1") is ignored. */
export function versionAtLeast(version: string, min: string) {
  const parts = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0);
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
