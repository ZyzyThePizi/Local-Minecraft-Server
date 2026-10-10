import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// LMS_ENV_FILE points the tests at a throwaway file.
export const envFile = resolve(process.env.LMS_ENV_FILE || resolve(backendDir, '.env'));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = (key: string, fallback = '') => process.env[key]?.trim() || fallback;

// .env holds only the two secrets. Everything else is set from the panel and saved in data/settings.json.
export const config = {
  dataDir: resolve(backendDir, env('DATA_DIR', '../data')),
  adminPassword: env('ADMIN_PASSWORD'),
  curseforgeApiKey: env('CURSEFORGE_API_KEY'),
};

/**
 * Settings older versions read from .env. They are copied into settings.json once (see store.ts)
 * and ignored afterwards, so they can be deleted from .env.
 */
export const legacyEnv = {
  port: Number(env('PORT')) || null,
  panelName: env('PANEL_NAME'),
  gameAddress: env('PUBLIC_GAME_ADDRESS'),
  allowedOrigins: env('ALLOWED_ORIGINS'),
};

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Re-reads the secrets from .env so a changed password or CurseForge key takes effect without a restart.
 * Returns the names of the settings that changed.
 */
export function reloadEnv() {
  const changed: string[] = [];
  let vars: Record<string, string | undefined>;
  try {
    vars = parseEnv(readFileSync(envFile, 'utf8'));
  } catch {
    return changed;
  }
  const password = vars.ADMIN_PASSWORD?.trim() ?? '';
  if (password && password !== config.adminPassword) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.warn(`Az új ADMIN_PASSWORD túl rövid (min. ${MIN_PASSWORD_LENGTH} karakter), a régi marad érvényben.`);
    } else {
      config.adminPassword = password;
      changed.push('ADMIN_PASSWORD');
    }
  }
  const cfKey = vars.CURSEFORGE_API_KEY?.trim() ?? '';
  if (cfKey !== config.curseforgeApiKey) {
    config.curseforgeApiKey = cfKey;
    changed.push('CURSEFORGE_API_KEY');
  }
  return changed;
}

/** Sets one key in .env, keeping every other line (and comments) as they are. */
export function writeEnvValue(key: string, value: string) {
  const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const lines = text.split(/\r?\n/);
  // Single quotes keep $ and # literal; a value with a single quote falls back to double quotes.
  const quoted = value.includes("'") ? JSON.stringify(value) : `'${value}'`;
  const line = `${key}=${quoted}`;
  const at = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (at >= 0) lines[at] = line;
  else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(line);
  }
  writeFileSync(envFile, `${lines.join('\n')}\n`);
}

export const paths = {
  instances: resolve(config.dataDir, 'instances'),
  java: resolve(config.dataDir, 'java'),
  tmp: resolve(config.dataDir, 'tmp'),
  settings: resolve(config.dataDir, 'settings.json'),
  secret: resolve(config.dataDir, 'secret.key'),
  nodeKey: resolve(config.dataDir, 'node.key'),
  sessions: resolve(config.dataDir, 'sessions.json'),
  invites: resolve(config.dataDir, 'invites.json'),
  audit: resolve(config.dataDir, 'audit.log'),
  lock: resolve(config.dataDir, '.lock'),
};

export const VERSION = '2.0.0';
/** Bumped when the hub and the backend stop understanding each other. */
export const API_VERSION = 1;

export const USER_AGENT = `ZyzyThePizi/Local-Minecraft-Server/${VERSION} (+https://github.com/ZyzyThePizi/Local-Minecraft-Server)`;

/** Error with an HTTP status and a stable code the UI can react to. */
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
