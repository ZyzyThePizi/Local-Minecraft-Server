import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { HttpError } from './config.ts';
import { ensureJava } from './java.ts';
import { getSettings, serverDir, type Instance } from './store.ts';

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

const MAX_LINES = 3000;
const STOP_TIMEOUT_MS = 90_000;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
// Anchored right after "]: " so chat ("<Steve> Alex joined the game") cannot spoof it.
const JOINED = /\]: ([A-Za-z0-9_]{3,16}) joined the game$/;
const LEFT = /\]: ([A-Za-z0-9_]{3,16}) left the game$/;
const DONE = /\]: Done \([\d.,]+s\)!/;

class ServerManager {
  state: ServerState = 'stopped';
  instanceId: string | null = null;
  startedAt: number | null = null;
  players = new Set<string>();
  private proc: ChildProcessWithoutNullStreams | null = null;
  private lines: { seq: number; line: string }[] = [];
  private seq = 0;
  private stopTimer: NodeJS.Timeout | null = null;
  private exitWaiters: (() => void)[] = [];

  isActive() {
    return this.state === 'starting' || this.state === 'running' || this.state === 'stopping';
  }

  private push(raw: string) {
    const line = raw.replace(ANSI, '').trimEnd();
    if (!line) return;
    this.lines.push({ seq: ++this.seq, line });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);

    if (this.state === 'starting' && DONE.test(line)) this.state = 'running';
    const joined = JOINED.exec(line);
    if (joined) this.players.add(joined[1]!);
    const left = LEFT.exec(line);
    if (left) this.players.delete(left[1]!);
  }

  panel(message: string) {
    this.push(`[Panel] ${message}`);
  }

  logsSince(since: number) {
    return { lines: this.lines.filter((l) => l.seq > since), last: this.seq };
  }

  /** Validates and returns quickly; the launch itself (which may download Java first) runs in the background. */
  async start(inst: Instance) {
    if (this.isActive()) throw new HttpError(409, 'ALREADY_RUNNING', 'A szerver már fut.');
    if (!(await getSettings()).eulaAccepted) {
      throw new HttpError(409, 'EULA_REQUIRED', 'Indítás előtt el kell fogadni a Minecraft EULA-t.');
    }
    this.state = 'starting';
    this.instanceId = inst.id;
    this.startedAt = Date.now();
    this.players.clear();
    this.panel(`${inst.name} indítása…`);
    this.launch(inst).catch((err: unknown) => {
      this.state = 'crashed';
      this.panel(`Indítási hiba: ${err instanceof Error ? err.message : err}`);
    });
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
    proc.on('error', (err) => this.panel(`Hiba: ${err.message}`));
    proc.on('exit', (code) => this.onExit(code));
  }

  private onExit(code: number | null) {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    const expected = this.state === 'stopping' || code === 0;
    this.state = expected ? 'stopped' : 'crashed';
    this.panel(expected ? 'A szerver leállt.' : `A szerver összeomlott (kilépési kód: ${code}). Nézd meg a fenti naplót.`);
    this.proc = null;
    this.startedAt = null;
    this.players.clear();
    for (const resolveWait of this.exitWaiters.splice(0)) resolveWait();
  }

  /** Sends `stop` and waits for the process to exit, killing it after a timeout (or right away with `force`). */
  stop(force = false) {
    const proc = this.proc;
    if (!proc) {
      if (this.isActive()) this.panel('Indítás megszakítva.');
      this.state = 'stopped';
      return Promise.resolve();
    }
    const exited = new Promise<void>((r) => this.exitWaiters.push(r));
    if (force) {
      this.panel('Kényszerített leállítás.');
      this.state = 'stopping';
      proc.kill('SIGKILL');
      return exited;
    }
    if (this.state !== 'stopping') {
      this.state = 'stopping';
      this.panel('Leállítás…');
      proc.stdin.write('stop\n');
      this.stopTimer = setTimeout(() => {
        this.panel('A szerver nem állt le időben, kényszerített leállítás.');
        proc.kill('SIGKILL');
      }, STOP_TIMEOUT_MS);
    }
    return exited;
  }

  send(command: string) {
    if (!this.proc || this.state === 'stopping') throw new HttpError(409, 'NOT_RUNNING', 'A szerver nem fut.');
    this.push(`> ${command}`);
    this.proc.stdin.write(`${command}\n`);
  }
}

export const server = new ServerManager();
