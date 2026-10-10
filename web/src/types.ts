export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';
export type Source = 'curseforge' | 'modrinth' | 'vanilla';
export type Loader = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt';

/** A server as anyone may see it (when the machine's owner allows public status). */
export interface PublicServer {
  id: string;
  name: string;
  versionName?: string;
  mcVersion: string;
  loader: Loader;
  iconUrl?: string;
  websiteUrl?: string;
  state: ServerState;
  players: number;
  maxPlayers: number;
  motd: string | null;
  gameAddress: string | null;
}

/** A server as a signed-in owner sees it. */
export interface ServerSummary {
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
  autoStart: boolean;
  gameAddress: string;
  port: number;
  maxPlayers: number;
  motd: string | null;
  state: ServerState;
  players: string[];
  startedAt: number | null;
}

export interface NodeSettings {
  panelName: string;
  eulaAccepted: boolean;
  apiPort: number;
  allowedOrigins: string[];
  maxRamMb: number | null;
  publicStatus: boolean;
  publicUrl: string;
  funnel: { enabled: boolean; path: string };
  registry: { enabled: boolean; url: string };
}

export interface Announcement {
  id: string;
  level: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  createdAt: number;
}

export type Via = { kind: 'password' } | { kind: 'invite'; inviteId: string; label: string };

export interface NodeOverview {
  nodeId: string;
  shortId: string;
  publicKey: string;
  name: string;
  version: string;
  apiVersion: number;
  publicUrl: string | null;
  funnelNote: string | null;
  settings: NodeSettings;
  system: { totalMemoryMb: number; recommendedMemoryMb: number; platform: string; cpus: number };
  ram: { budgetMb: number; reservedMb: number };
  curseforgeConfigured: boolean;
  installing: boolean;
  registry: { lastOkAt: number | null; lastError: string | null; announcements: Announcement[]; minVersion: string | null; defaultUrl?: string };
  session: { id: string; via: Via; device: string };
}

export interface SessionInfo {
  id: string;
  via: Via;
  device: string;
  createdAt: number;
  lastUsedAt: number;
  lastIp: string;
  expiresAt: number;
}

export interface InviteInfo {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number | null;
  uses: number;
  revokedAt?: number;
  createdBy: string;
  state: 'active' | 'expired' | 'used' | 'revoked';
}

export interface AuditEntry {
  t: number;
  sessionId: string | null;
  via: string;
  device: string;
  ip: string;
  action: string;
  detail?: string;
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
  result?: { instanceId: string };
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
