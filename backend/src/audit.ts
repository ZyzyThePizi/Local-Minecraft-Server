import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { paths } from './config.ts';

/** Who did something: the way they got in (password or which invite) and the device they named. */
export interface Actor {
  sessionId: string | null;
  via: string;
  device: string;
  ip: string;
}

export interface AuditEntry extends Actor {
  t: number;
  action: string;
  detail?: string;
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Appends one line to data/audit.log (JSON lines). The previous file is kept as audit.log.1 when it grows large. */
export function audit(actor: Actor | null, action: string, detail?: string) {
  const entry: AuditEntry = {
    t: Date.now(),
    sessionId: actor?.sessionId ?? null,
    via: actor?.via ?? 'rendszer',
    device: actor?.device ?? '',
    ip: actor?.ip ?? '',
    action,
    ...(detail ? { detail: detail.slice(0, 300) } : {}),
  };
  try {
    if (existsSync(paths.audit) && statSync(paths.audit).size > MAX_BYTES) renameSync(paths.audit, `${paths.audit}.1`);
    appendFileSync(paths.audit, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.warn('Az audit napló írása nem sikerült:', (err as Error).message);
  }
}

/** The newest entries first. */
export async function readAudit(limit: number): Promise<AuditEntry[]> {
  const text = await readFile(paths.audit, 'utf8').catch(() => '');
  const lines = text.trimEnd().split('\n').filter(Boolean).slice(-limit).reverse();
  return lines.flatMap((l) => {
    try {
      return [JSON.parse(l) as AuditEntry];
    } catch {
      return [];
    }
  });
}
