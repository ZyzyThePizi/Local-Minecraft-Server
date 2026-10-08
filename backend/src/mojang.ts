import { fetchJson } from './download.ts';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const CACHE_MS = 60 * 60 * 1000;

interface ManifestVersion {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  releaseTime: string;
}

interface VersionJson {
  javaVersion?: { majorVersion: number };
  downloads?: { server?: { url: string; sha1: string; size: number } };
}

let cache: { at: number; versions: ManifestVersion[] } | null = null;

export async function mojangVersions() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const manifest = await fetchJson<{ versions: ManifestVersion[] }>(MANIFEST_URL);
    cache = { at: Date.now(), versions: manifest.versions };
  }
  return cache.versions;
}

export async function versionInfo(id: string) {
  const entry = (await mojangVersions()).find((v) => v.id === id);
  if (!entry) throw new Error(`Ismeretlen Minecraft verzió: ${id}`);
  const json = await fetchJson<VersionJson>(entry.url);
  return {
    // Versions before 1.17 do not declare javaVersion and run on Java 8.
    javaMajor: json.javaVersion?.majorVersion ?? 8,
    server: json.downloads?.server ?? null,
  };
}
