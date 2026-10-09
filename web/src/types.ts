export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';
export type Source = 'curseforge' | 'modrinth' | 'vanilla';
export type Loader = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt';

export interface PublicStatus {
  name: string;
  state: ServerState;
  players: number;
  maxPlayers: number;
  motd: string | null;
  gameAddress: string | null;
  instance: {
    name: string;
    versionName?: string;
    mcVersion: string;
    loader: Loader;
    iconUrl?: string;
    websiteUrl?: string;
  } | null;
}

export interface InstanceSummary {
  id: string;
  name: string;
  source: Source;
  versionName?: string;
  mcVersion: string;
  loader: Loader;
  loaderVersion?: string;
  iconUrl?: string;
  websiteUrl?: string;
  memoryMb: number;
  jvmArgs: string;
  javaMajor: number;
  createdAt: string;
}

export interface Settings {
  eulaAccepted: boolean;
  activeInstanceId: string | null;
  autoStart: boolean;
  gameAddress: string;
}

export interface Overview {
  server: { state: ServerState; players: string[]; ops?: string[]; startedAt: number | null; instanceId: string | null };
  instance: InstanceSummary | null;
  settings: Settings;
  system: { totalMemoryMb: number; recommendedMemoryMb: number; platform: string };
  curseforgeConfigured: boolean;
  installing: boolean;
}

export interface PackSummary {
  source: Source;
  id: string;
  slug: string;
  name: string;
  summary: string;
  iconUrl?: string;
  downloads: number;
  author?: string;
  websiteUrl?: string;
  mcVersions: string[];
  loaders: string[];
}

export interface PackVersion {
  id: string;
  name: string;
  mcVersions: string[];
  loaders: string[];
  type: 'release' | 'beta' | 'alpha';
  date: string;
  hasServerPack?: boolean;
}

export interface Job {
  id: string;
  kind: string;
  title: string;
  state: 'running' | 'done' | 'error';
  stage: string;
  progress: number | null;
  log: string[];
  error?: string;
  result?: { instanceId: string; activated: boolean };
  startedAt: number;
  finishedAt?: number;
}

export interface KnownPlayer {
  name: string;
  uuid: string;
  op: boolean;
  online: boolean;
  dataFiles: number;
}
