import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { paths } from './config.ts';
import { toText, tx, type Lang, type Text } from './i18n.ts';

/** Who did something: the way they got in (password or which invite) and the device they named. */
export interface Actor {
  sessionId: string | null;
  via: Text | string;
  device: string;
  ip: string;
}

/** One line of data/audit.log: English at the top level, the Hungarian wording next to it. */
interface StoredEntry {
  t: number;
  sessionId: string | null;
  via: string;
  device: string;
  ip: string;
  action: string;
  detail?: string;
  hu?: { via: string; action: string; detail?: string };
}

export type AuditEntry = Omit<StoredEntry, 'hu'>;

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DETAIL = 300;

/** Appends one line to data/audit.log (JSON lines). The previous file is kept as audit.log.1 when it grows large. */
export function audit(actor: Actor | null, action: Text, detail?: Text | string) {
  const via = toText(actor?.via ?? tx('system', 'rendszer'));
  const d = detail ? toText(detail) : null;
  const entry: StoredEntry = {
    t: Date.now(),
    sessionId: actor?.sessionId ?? null,
    via: via.en,
    device: actor?.device ?? '',
    ip: actor?.ip ?? '',
    action: action.en,
    ...(d ? { detail: d.en.slice(0, MAX_DETAIL) } : {}),
    hu: { via: via.hu, action: action.hu, ...(d ? { detail: d.hu.slice(0, MAX_DETAIL) } : {}) },
  };
  try {
    if (existsSync(paths.audit) && statSync(paths.audit).size > MAX_BYTES) renameSync(paths.audit, `${paths.audit}.1`);
    appendFileSync(paths.audit, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.warn('Az audit napló írása nem sikerült:', (err as Error).message);
  }
}

// Entries written before the panel had two languages are Hungarian only; these are the actions they used.
const LEGACY: Record<string, string> = {
  'Belépés meghívóval': 'Signed in with an invite',
  'Sikertelen belépés (meghívó)': 'Failed sign-in (invite)',
  'Belépés jelszóval': 'Signed in with the password',
  'Sikertelen belépés (hibás jelszó)': 'Failed sign-in (wrong password)',
  Kilépés: 'Signed out',
  'Gépbeállítás módosítva': 'Machine settings changed',
  'Sikertelen jelszócsere (hibás jelenlegi jelszó)': 'Failed password change (wrong current password)',
  'Jelszó megváltoztatva': 'Password changed',
  'Munkamenet lezárva': 'Session ended',
  'Kijelentkeztetés mindenhol': 'Signed out everywhere',
  'Meghívó létrehozva': 'Invite created',
  'Meghívó visszavonva': 'Invite revoked',
  'Szerver módosítva': 'Server changed',
  'Szerver törölve': 'Server deleted',
  'Szerver indítása': 'Server started',
  'Szerver kényszerített leállítása': 'Server force-stopped',
  'Szerver leállítása': 'Server stopped',
  'Szerver újraindítása': 'Server restarted',
  Konzolparancs: 'Console command',
  'Játékos visszaállítva': 'Player reset',
  'server.properties módosítva': 'server.properties changed',
  'Telepítés indítása': 'Install started',
  '.env frissítve': '.env updated',
};
const LEGACY_VIA: Record<string, string> = { jelszó: 'password', névtelen: 'anonymous', rendszer: 'system', meghívó: 'invite' };

function view(e: StoredEntry, lang: Lang): AuditEntry {
  const { hu, ...en } = e;
  if (hu) return lang === 'hu' ? { ...en, ...hu } : en;
  if (lang === 'hu') return en;
  return { ...en, action: LEGACY[en.action] ?? en.action, via: LEGACY_VIA[en.via] ?? en.via.replace(/^meghívó: /, 'invite: '), ip: en.ip === 'helyi' ? 'local' : en.ip };
}

/** The newest entries first. */
export async function readAudit(limit: number, lang: Lang): Promise<AuditEntry[]> {
  const text = await readFile(paths.audit, 'utf8').catch(() => '');
  const lines = text.trimEnd().split('\n').filter(Boolean).slice(-limit).reverse();
  return lines.flatMap((l) => {
    try {
      return [view(JSON.parse(l) as StoredEntry, lang)];
    } catch {
      return [];
    }
  });
}
