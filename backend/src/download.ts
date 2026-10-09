import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { USER_AGENT } from './config.ts';
import type { JobContext } from './jobs.ts';

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers as Record<string, string>) },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} – ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return (await res.json()) as T;
}

interface DownloadOptions {
  sha1?: string;
  headers?: Record<string, string>;
  onProgress?: (received: number, total: number) => void;
  retries?: number;
}

/** Streams a URL to disk (via a .part file), optionally verifying its SHA-1. Retries on failure. */
export async function download(url: string, dest: string, opts: DownloadOptions = {}) {
  const attempts = (opts.retries ?? 3) + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await downloadOnce(url, dest, opts);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError;
}

async function downloadOnce(url: string, dest: string, opts: DownloadOptions) {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...opts.headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!res.ok || !res.body) throw new Error(`Letöltés sikertelen (${res.status}): ${url}`);

  const total = Number(res.headers.get('content-length') ?? 0);
  const hash = opts.sha1 ? createHash('sha1') : null;
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      hash?.update(chunk);
      opts.onProgress?.(received, total);
      cb(null, chunk);
    },
  });

  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), meter, createWriteStream(part));
    if (hash && opts.sha1 && hash.digest('hex') !== opts.sha1.toLowerCase()) {
      throw new Error(`Hibás ellenőrzőösszeg: ${url}`);
    }
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
}

export interface DownloadItem {
  /** Tried in order; every source must yield the same bytes (checked by sha1 when known). */
  urls: string[];
  dest: string;
  sha1?: string;
  size?: number;
}

/**
 * Downloads many files in parallel, falling back to the next URL when a source fails,
 * and keeps the job's stage text updated with "done/total · MB/s".
 */
export async function downloadAll(ctx: JobContext, items: DownloadItem[], label: string, concurrency = 8) {
  const started = Date.now();
  let done = 0;
  let bytes = 0;
  let lastUpdate = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - lastUpdate < 500) return;
    lastUpdate = now;
    const secs = Math.max(0.5, (now - started) / 1000);
    ctx.detail(`${label} (${done}/${items.length} · ${(bytes / 1048576 / secs).toFixed(1)} MB/s)`);
    ctx.progress(done / Math.max(1, items.length));
  };
  report(true);
  await mapLimit(items, concurrency, async (item) => {
    let lastError: unknown;
    let received = 0;
    for (const url of item.urls) {
      try {
        received = 0;
        await download(url, item.dest, {
          sha1: item.sha1,
          retries: url === item.urls.at(-1) ? 3 : 1,
          onProgress: (r) => {
            bytes += r - received;
            received = r;
            report();
          },
        });
        lastError = undefined;
        break;
      } catch (err) {
        bytes -= received;
        lastError = err;
      }
    }
    if (lastError) throw lastError;
    done++;
    report();
  });
  report(true);
  ctx.log(`  ${items.length} fájl, ${formatBytes(bytes)}, ${Math.round((Date.now() - started) / 1000)} mp alatt`);
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Resolves `rel` inside `root`, refusing anything that would escape it (pack files are untrusted). */
export function safeJoin(root: string, rel: string) {
  const full = resolve(root, rel);
  const r = relative(root, full);
  if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error(`Érvénytelen fájlútvonal a csomagban: ${rel}`);
  return full;
}

export const formatBytes = (n: number) =>
  n > 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
