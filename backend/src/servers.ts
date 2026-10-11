import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { totalmem } from 'node:os';
import { changed } from './changes.ts';
import { HttpError } from './config.ts';
import { errorText, toText, tx, type Lang, type Text } from './i18n.ts';
import { ensureJava } from './java.ts';
import { findFreePort, isPortFree } from './ports.ts';
import { readProperties, writeProperties } from './properties.ts';
import { serverDir, settings, type Instance } from './store.ts';

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

const MAX_LINES = 3000;
const STOP_TIMEOUT_MS = 90_000;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
// Anchored right after "]: " so chat ("<Steve> Alex joined the game") cannot spoof it.
const JOINED = /\]: ([A-Za-z0-9_]{3,16}) joined the game$/;
const LEFT = /\]: ([A-Za-z0-9_]{3,16}) left the game$/;
const DONE = /\]: Done \([\d.,]+s\)!/;

/** Memory all servers on this machine may use together. */
export function ramBudgetMb() {
  const total = Math.floor(totalmem() / 1048576);
  return settings().maxRamMb ?? Math.max(1024, total - 2048);
}

/** One Minecraft server process. Every installed server has its own, so several can run at once. */
class ServerProcess {
  readonly instanceId: string;
  #state: ServerState = 'stopped';
  startedAt: number | null = null;
  /** Memory (-Xmx) and game port of the current run. */
  memoryMb = 0;
  port: number | null = null;
  players = new Set<string>();
  private proc: ChildProcessWithoutNullStreams | null = null;
  /** `hu` is set on the panel's own lines, which exist in both languages. */
  private lines: { seq: number; line: string; hu?: string }[] = [];
  private seq = 0;
  private stopTimer: NodeJS.Timeout | null = null;
  private exitWaiters: (() => void)[] = [];

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  get state() {
    return this.#state;
  }

  set state(next: ServerState) {
    if (next === this.#state) return;
    this.#state = next;
    changed();
  }

  isActive() {
    return this.state === 'starting' || this.state === 'running' || this.state === 'stopping';
  }

  private push(raw: string, hu?: string) {
    const line = raw.replace(ANSI, '').trimEnd();
    if (!line) return;
    this.lines.push({ seq: ++this.seq, line, ...(hu && hu !== line ? { hu } : {}) });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);

    if (this.state === 'starting' && DONE.test(line)) this.state = 'running';
    const joined = JOINED.exec(line);
    if (joined) this.players.add(joined[1]!);
    const left = LEFT.exec(line);
    if (left) this.players.delete(left[1]!);
    if (joined || left) changed();
  }

  panel(message: Text | string) {
    const t = toText(message);
    this.push(`[Panel] ${t.en}`, `[Panel] ${t.hu}`);
  }

  logsSince(since: number, lang: Lang) {
    const lines = this.lines.filter((l) => l.seq > since).map((l) => ({ seq: l.seq, line: lang === 'hu' && l.hu ? l.hu : l.line }));
    return { lines, last: this.seq };
  }

  /** Validates and returns quickly; the launch itself (which may download Java first) runs in the background. */
  async start(inst: Instance) {
    if (this.isActive()) throw new HttpError(409, 'ALREADY_RUNNING', tx('The server is already running.', 'A szerver már fut.'));
    if (!settings().eulaAccepted) {
      throw new HttpError(409, 'EULA_REQUIRED', tx('The Minecraft EULA must be accepted before starting.', 'Indítás előtt el kell fogadni a Minecraft EULA-t.'));
    }
    const others = servers.active().filter((s) => s !== this);
    const reserved = others.reduce((sum, s) => sum + s.memoryMb, 0);
    const budget = ramBudgetMb();
    if (reserved + inst.memoryMb > budget) {
      throw new HttpError(
        409,
        'RAM_BUDGET',
        tx(
          `Not enough memory in the budget: the running servers hold ${reserved} MB, this server asks for ${inst.memoryMb} MB, and the budget is ${budget} MB. ` +
            'Stop a server, lower its memory, or raise the budget on the Machine tab.',
          `Nincs elég memória a keretben: a futó szerverek ${reserved} MB-ot foglalnak, ez a szerver ${inst.memoryMb} MB-ot kérne, a keret ${budget} MB. ` +
            'Állíts le egy szervert, csökkentsd a memóriáját, vagy emeld a keretet a Gép fülön.',
        ),
      );
    }
    this.state = 'starting';
    this.startedAt = Date.now();
    this.memoryMb = inst.memoryMb;
    this.players.clear();
    this.panel(tx(`Starting ${inst.name}…`, `${inst.name} indítása…`));
    try {
      this.port = await this.claimPort(new Set(others.map((s) => s.port).filter((p): p is number => p !== null)));
    } catch (err) {
      this.state = 'crashed';
      throw err;
    }
    this.launch(inst).catch((err: unknown) => {
      this.state = 'crashed';
      this.memoryMb = 0;
      const why = errorText(err);
      this.panel(tx(`Start failed: ${why.en}`, `Indítási hiba: ${why.hu}`));
    });
  }

  /**
   * The game port from server.properties, moved to a free one when another server (here or in
   * another backend on this machine) already listens there.
   */
  private async claimPort(taken: Set<number>) {
    const file = join(serverDir(this.instanceId), 'server.properties');
    const current = Number((await readProperties(file))['server-port']) || 25565;
    if (!taken.has(current) && (await isPortFree(current))) return current;
    const next = await findFreePort(25565, taken);
    await writeProperties(file, { 'server-port': String(next) });
    this.panel(tx(`Port ${current} is taken, so this server now uses port ${next}.`, `A ${current}-es port foglalt, ez a szerver mostantól a ${next}-es portot használja.`));
    this.panel(tx(`Point its playit.gg tunnel to 127.0.0.1:${next} as well.`, `A playit.gg tunnelt is állítsd át erre: 127.0.0.1:${next}`));
    return next;
  }

  private async launch(inst: Instance) {
    const dir = serverDir(inst.id);
    await writeFile(join(dir, 'eula.txt'), 'eula=true\n');
    const java = await ensureJava(inst.javaMajor, (l) => this.panel(l));
    if (this.state !== 'starting') return; // stopped while Java was downloading

    const launchArgs = inst.launch.kind === 'jar' ? ['-jar', inst.launch.jar] : [`@${inst.launch.file}`];
    const args = [
      `-Xms${Math.min(1024, inst.memoryMb)}M`,
      `-Xmx${inst.memoryMb}M`,
      ...(inst.jvmArgs?.split(/\s+/).filter(Boolean) ?? []),
      ...launchArgs,
      'nogui',
    ];
    this.panel(`java ${args.join(' ')}`);
    const proc = spawn(java, args, { cwd: dir, windowsHide: true });
    this.proc = proc;
    createInterface({ input: proc.stdout }).on('line', (l) => this.push(l));
    createInterface({ input: proc.stderr }).on('line', (l) => this.push(l));
    proc.on('error', (err) => this.panel(tx(`Error: ${err.message}`, `Hiba: ${err.message}`)));
    proc.on('exit', (code) => this.onExit(code));
  }

  private onExit(code: number | null) {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    const expected = this.state === 'stopping' || code === 0;
    this.state = expected ? 'stopped' : 'crashed';
    this.panel(
      expected
        ? tx('The server has stopped.', 'A szerver leállt.')
        : tx(`The server crashed (exit code: ${code}). See the log above.`, `A szerver összeomlott (kilépési kód: ${code}). Nézd meg a fenti naplót.`),
    );
    if (!expected && this.startedAt) void this.explainCrash(serverDir(this.instanceId), this.startedAt);
    this.proc = null;
    this.startedAt = null;
    this.memoryMb = 0;
    this.players.clear();
    for (const resolveWait of this.exitWaiters.splice(0)) resolveWait();
  }

  /** Surfaces the gist of a crash report written during this run (the console usually only says "see crash report"). */
  private async explainCrash(dir: string, since: number) {
    try {
      const reports = join(dir, 'crash-reports');
      const files = await Promise.all((await readdir(reports)).map(async (f) => ({ f, t: (await stat(join(reports, f))).mtimeMs })));
      const latest = files.filter((x) => x.t >= since).sort((a, b) => b.t - a.t)[0];
      if (!latest) return;
      const text = await readFile(join(reports, latest.f), 'utf8');
      const reasons = [...new Set([...text.matchAll(/Failure message: (.+)/g)].map((m) => m[1]!.trim()))];
      const description = /^Description: (.+)$/m.exec(text)?.[1];
      this.panel(`Crash report: crash-reports/${latest.f}${description ? ` (${description.trim()})` : ''}`);
      for (const reason of reasons.slice(0, 10)) this.panel(`  ${reason}`);
      if (reasons.some((r) => /requires .+ or above/.test(r))) {
        this.panel(
          tx(
            'A mod dependency is missing. Install the modpack again from the panel: the installer now adds the missing mods too.',
            'Hiányzó modfüggőség. Telepítsd újra a modpacket a panelről: az új telepítő a hiányzó modokat is felrakja.',
          ),
        );
      }
    } catch {
      // no crash report folder
    }
  }

  /** Sends `stop` and waits for the process to exit, killing it after a timeout (or right away with `force`). */
  stop(force = false) {
    const proc = this.proc;
    if (!proc) {
      if (this.isActive()) this.panel(tx('Start cancelled.', 'Indítás megszakítva.'));
      this.state = 'stopped';
      this.memoryMb = 0;
      return Promise.resolve();
    }
    const exited = new Promise<void>((r) => this.exitWaiters.push(r));
    if (force) {
      this.panel(tx('Force stop.', 'Kényszerített leállítás.'));
      this.state = 'stopping';
      proc.kill('SIGKILL');
      return exited;
    }
    if (this.state !== 'stopping') {
      this.state = 'stopping';
      this.panel(tx('Stopping…', 'Leállítás…'));
      proc.stdin.write('stop\n');
      this.stopTimer = setTimeout(() => {
        this.panel(tx('The server did not stop in time; forcing it.', 'A szerver nem állt le időben, kényszerített leállítás.'));
        proc.kill('SIGKILL');
      }, STOP_TIMEOUT_MS);
    }
    return exited;
  }

  send(command: string) {
    if (!this.proc || this.state === 'stopping') throw new HttpError(409, 'NOT_RUNNING', tx('The server is not running.', 'A szerver nem fut.'));
    this.push(`> ${command}`);
    this.proc.stdin.write(`${command}\n`);
  }
}

const processes = new Map<string, ServerProcess>();

export type { ServerProcess };

export const servers = {
  /** The process slot of an installed server (created on first use). */
  get(instanceId: string) {
    let p = processes.get(instanceId);
    if (!p) {
      p = new ServerProcess(instanceId);
      processes.set(instanceId, p);
    }
    return p;
  },
  peek: (instanceId: string) => processes.get(instanceId) ?? null,
  active: () => [...processes.values()].filter((p) => p.isActive()),
  forget: (instanceId: string) => processes.delete(instanceId),
  reservedMb: () => [...processes.values()].reduce((sum, p) => sum + (p.isActive() ? p.memoryMb : 0), 0),
};
