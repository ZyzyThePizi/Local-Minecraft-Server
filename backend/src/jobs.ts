import { randomBytes } from 'node:crypto';

export interface Job {
  id: string;
  kind: string;
  title: string;
  state: 'running' | 'done' | 'error';
  stage: string;
  /** 0..1, or null when the current stage has no measurable progress. */
  progress: number | null;
  log: string[];
  error?: string;
  result?: unknown;
  startedAt: number;
  finishedAt?: number;
}

export interface JobContext {
  stage(name: string, progress?: number | null): void;
  progress(value: number | null): void;
  log(line: string): void;
}

const MAX_LOG = 400;
const jobs = new Map<string, Job>();

export function createJob(kind: string, title: string, run: (ctx: JobContext) => Promise<unknown>) {
  const job: Job = {
    id: randomBytes(6).toString('hex'),
    kind,
    title,
    state: 'running',
    stage: 'Indítás…',
    progress: null,
    log: [],
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  const ctx: JobContext = {
    stage(name, progress = null) {
      job.stage = name;
      job.progress = progress;
      ctx.log(`▸ ${name}`);
    },
    progress(value) {
      job.progress = value === null ? null : Math.max(0, Math.min(1, value));
    },
    log(line) {
      job.log.push(line);
      if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
    },
  };

  run(ctx)
    .then((result) => {
      job.state = 'done';
      job.stage = 'Kész';
      job.progress = 1;
      job.result = result;
    })
    .catch((err: unknown) => {
      job.state = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      ctx.log(`✖ ${job.error}`);
      console.error(`[job ${job.kind}]`, err);
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });

  return job;
}

export const getJob = (id: string) => jobs.get(id) ?? null;

export const runningJob = (kind?: string) =>
  [...jobs.values()].find((j) => j.state === 'running' && (!kind || j.kind === kind)) ?? null;

/** The most recent job of a kind, so a reopened page can pick up where it left off. */
export const latestJob = (kind: string) =>
  [...jobs.values()].filter((j) => j.kind === kind).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
