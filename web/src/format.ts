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
