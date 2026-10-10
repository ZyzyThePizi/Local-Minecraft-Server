import type { Loader, ServerState } from './types';

export const LOADER_LABEL: Record<Loader, string> = {
  vanilla: 'Vanilla',
  forge: 'Forge',
  neoforge: 'NeoForge',
  fabric: 'Fabric',
  quilt: 'Quilt',
};

export const STATE_LABEL: Record<ServerState, string> = {
  running: 'Online',
  starting: 'Indul…',
  stopping: 'Leáll…',
  stopped: 'Offline',
  crashed: 'Összeomlott',
};

export function compactNumber(n: number) {
  return new Intl.NumberFormat('hu-HU', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
}

export function formatMemory(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${mb} MB`;
}

export function uptime(since: number) {
  const s = Math.floor((Date.now() - since) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} óra ${m} perc` : m ? `${m} perc` : `${s} mp`;
}

export function formatDateTime(ms: number) {
  return new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

export function relativeTime(ms: number) {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('hu-HU', { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  return rtf.format(Math.round(diff / 86400_000), 'day');
}
