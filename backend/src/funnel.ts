import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nodeId } from './node.ts';
import { settings, updateSettings } from './store.ts';

const run = promisify(execFile);
const FUNNEL_PORT = 10000; // 443 and 8443 are left to other services

interface ServeConfig {
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  AllowFunnel?: Record<string, boolean>;
}

async function tailscaleJson<T>(args: string[]) {
  const { stdout } = await run('tailscale', [...args, '--json'], { windowsHide: true, timeout: 15_000 });
  return JSON.parse(stdout) as T;
}

/** The node id of the backend answering on a local port, or null when nothing (or an old version) answers. */
async function backendAt(target: string) {
  try {
    const res = await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(2000) });
    const json = (await res.json()) as { nodeId?: string };
    return json.nodeId ?? 'v1';
  } catch {
    return null;
  }
}

/**
 * Publishes the API with Tailscale Funnel on :10000 and returns its public address.
 * The first backend on a machine gets the root; another one (from a second folder) gets its own
 * sub-path, so both can be reached through the same port.
 */
export async function exposeViaFunnel(port: number): Promise<{ url: string | null; note?: string }> {
  if (!settings().funnel.enabled) return { url: null };
  let dns: string;
  try {
    const status = await tailscaleJson<{ BackendState?: string; Self?: { DNSName?: string } }>(['status']);
    if (status.BackendState !== 'Running' || !status.Self?.DNSName) return { url: null, note: 'A Tailscale nem fut, vagy nem vagy bejelentkezve.' };
    dns = status.Self.DNSName.replace(/\.$/, '');
  } catch {
    return { url: null, note: 'A Tailscale nincs telepítve (https://tailscale.com/download), vagy nem fut.' };
  }

  const target = `http://127.0.0.1:${port}`;
  const host = `${dns}:${FUNNEL_PORT}`;
  let config: ServeConfig = {};
  try {
    config = await tailscaleJson<ServeConfig>(['funnel', 'status']);
  } catch {
    /* no serve config yet */
  }
  const handlers = config.Web?.[host]?.Handlers ?? {};
  let path = Object.entries(handlers).find(([, h]) => h.Proxy === target)?.[0];

  if (!path) {
    path = settings().funnel.path || '/';
    const taken = handlers[path]?.Proxy;
    if (taken) {
      const other = await backendAt(taken);
      // Another live backend owns this path: take a sub-path named after this machine's id.
      if (other && other !== nodeId) path = `/${nodeId.slice(0, 8).toLowerCase()}`;
    }
  }

  if (handlers[path]?.Proxy !== target || !config.AllowFunnel?.[host]) {
    const args = ['funnel', '--bg', `--https=${FUNNEL_PORT}`, ...(path === '/' ? [] : [`--set-path=${path}`]), target];
    try {
      await run('tailscale', args, { windowsHide: true, timeout: 30_000 });
    } catch (err) {
      const msg = ((err as { stderr?: string }).stderr || (err as Error).message).trim().split('\n')[0];
      return { url: null, note: `A Tailscale Funnel nem állt be: ${msg}` };
    }
  }
  if (settings().funnel.path !== path) await updateSettings({ funnel: { ...settings().funnel, path } });
  return { url: `https://${host}${path === '/' ? '' : path}` };
}
