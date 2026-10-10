import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './config.ts';

/**
 * The machine's identity: an Ed25519 key pair made on the first start. The hub pins the public key
 * (like SSH), so a different machine answering on a known address is caught.
 *
 * On Windows the private key is sealed with DPAPI in machine scope: a copy of data/ on another
 * computer cannot open it, so the identity stays with this machine.
 */

interface KeyFile {
  v: 1;
  scheme: 'dpapi-machine' | 'plain';
  data: string;
}

let privateKey: KeyObject;
let publicRaw: Buffer;
export let nodeId = '';

// Crockford base32 without I, L, O, U: easy to read aloud and compare.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(bytes: Buffer, length: number) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** 16 characters from the public key's hash, e.g. 7F3KQ9LD2M8XA4TC. Shown in groups of four. */
export const fingerprint = (raw: Buffer) => base32(createHash('sha256').update(raw).digest(), 16);

function dpapi(mode: 'Protect' | 'Unprotect', input: string) {
  const script =
    'Add-Type -AssemblyName System.Security;' +
    '$in=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());' +
    `$out=[Security.Cryptography.ProtectedData]::${mode}($in,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine);` +
    '[Console]::Out.Write([Convert]::ToBase64String($out))';
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (res.status !== 0 || !res.stdout) throw new Error(`DPAPI ${mode} hiba: ${(res.stderr || res.error?.message || '').trim().slice(0, 200)}`);
  return res.stdout.trim();
}

function save(key: KeyObject) {
  const pkcs8 = key.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  let file: KeyFile = { v: 1, scheme: 'plain', data: pkcs8 };
  if (process.platform === 'win32') {
    try {
      file = { v: 1, scheme: 'dpapi-machine', data: dpapi('Protect', pkcs8) };
    } catch (err) {
      console.warn(`  A gépkulcs DPAPI-védelme nem sikerült, védelem nélkül mentem: ${(err as Error).message}`);
    }
  }
  mkdirSync(dirname(paths.nodeKey), { recursive: true });
  writeFileSync(paths.nodeKey, JSON.stringify(file), { mode: 0o600 });
}

function load(): KeyObject {
  const file = JSON.parse(readFileSync(paths.nodeKey, 'utf8')) as KeyFile;
  const der = file.scheme === 'dpapi-machine' ? dpapi('Unprotect', file.data) : file.data;
  return createPrivateKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'pkcs8' });
}

export function initNode() {
  if (existsSync(paths.nodeKey)) {
    try {
      privateKey = load();
    } catch (err) {
      console.error(
        `\n  A gépkulcs (data/node.key) nem nyitható meg: ${(err as Error).message}\n` +
          '  Ha a data mappát másik gépről másoltad, töröld a node.key fájlt: új azonosító készül,\n' +
          '  és a panelen újra hozzá kell adni ezt a gépet.',
      );
      process.exit(1);
    }
  } else {
    privateKey = generateKeyPairSync('ed25519').privateKey;
    save(privateKey);
  }
  // The raw 32-byte key is the tail of the SPKI DER encoding.
  publicRaw = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
  nodeId = fingerprint(publicRaw);
}

export const publicKey = () => publicRaw.toString('base64url');
export const shortId = () => `${nodeId.slice(0, 4)}-${nodeId.slice(4, 8)}`;
export const signBytes = (data: Buffer | string) => sign(null, Buffer.from(data), privateKey).toString('base64url');

/** What the hub verifies on every connect: the machine proves it holds the pinned key. */
export const helloMessage = (nonce: string, id: string) => `local-minecraft-server/hello/v1\n${id}\n${nonce}`;
