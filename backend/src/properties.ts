import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

// server.properties is read by Java's Properties.load (ISO-8859-1), so anything outside ASCII
// must be written as \uXXXX, otherwise accented MOTDs (á, é, ő) arrive mangled.

function unescape(value: string) {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, seq: string) => {
    if (seq[0] === 'u' && seq.length === 5) return String.fromCharCode(parseInt(seq.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r', f: '\f' } as Record<string, string>)[seq] ?? seq;
  });
}

function escape(value: string) {
  let out = '';
  for (const ch of value.replace(/\\/g, '\\\\')) {
    const code = ch.charCodeAt(0);
    out += code > 0x7e ? `\\u${code.toString(16).padStart(4, '0')}` : ch;
  }
  return out.replace(/^ /, '\\ ');
}

const LINE = /^\s*([^#!=:\s][^=:]*?)\s*[=:]\s?(.*)$/;

export async function readProperties(file: string) {
  const props: Record<string, string> = {};
  if (!existsSync(file)) return props;
  for (const line of (await readFile(file, 'latin1')).split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) props[m[1]!] = unescape(m[2]!);
  }
  return props;
}

/** Updates keys in place (keeping comments and order) and appends new ones. */
export async function writeProperties(file: string, updates: Record<string, string>) {
  const lines = existsSync(file) ? (await readFile(file, 'latin1')).split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  const out = lines.map((line) => {
    const m = LINE.exec(line);
    if (!m || !pending.has(m[1]!)) return line;
    const value = pending.get(m[1]!)!;
    pending.delete(m[1]!);
    return `${m[1]}=${escape(value)}`;
  });
  for (const [key, value] of pending) out.push(`${key}=${escape(value)}`);
  while (out.length && out[out.length - 1] === '') out.pop();
  await writeFile(file, `${out.join('\n')}\n`, 'latin1');
}
