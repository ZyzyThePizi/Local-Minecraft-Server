import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const envFile = resolve(backendDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = (key: string, fallback = '') => process.env[key]?.trim() || fallback;

export const config = {
  port: Number(env('PORT', '8765')),
  host: env('HOST', '127.0.0.1'),
  dataDir: resolve(backendDir, env('DATA_DIR', '../data')),
  adminPassword: env('ADMIN_PASSWORD'),
  curseforgeApiKey: env('CURSEFORGE_API_KEY'),
  panelName: env('PANEL_NAME', hostname()),
  gameAddress: env('PUBLIC_GAME_ADDRESS'),
  allowedOrigins: env('ALLOWED_ORIGINS', 'https://zyzythepizi.github.io,http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
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

export const paths = {
  instances: resolve(config.dataDir, 'instances'),
  java: resolve(config.dataDir, 'java'),
  tmp: resolve(config.dataDir, 'tmp'),
  settings: resolve(config.dataDir, 'settings.json'),
  secret: resolve(config.dataDir, 'secret.key'),
};

export const USER_AGENT = 'ZyzyThePizi/Local-Minecraft-Server/1.0 (+https://github.com/ZyzyThePizi/Local-Minecraft-Server)';

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
