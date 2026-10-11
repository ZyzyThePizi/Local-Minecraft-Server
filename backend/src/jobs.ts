import { randomBytes } from 'node:crypto';
import { errorText, toText, tx, type Lang, type Text } from './i18n.ts';

export interface Job {
  id: string;
  kind: string;
  title: string;
  state: 'running' | 'done' | 'error';
  stage: Text;
  /** 0..1, or null when the current stage has no measurable progress. */
  progress: number | null;
  log: Text[];
  error?: Text;
  result?: unknown;
  startedAt: number;
  finishedAt?: number;
}

export interface JobContext {
  stage(name: Text | string, progress?: number | null): void;
  /** Updates the stage text without adding a log line (live counters). */
  detail(text: Text | string): void;
  progress(value: number | null): void;
  log(line: Text | string): void;
}

const MAX_LOG = 400;
const jobs = new Map<string, Job>();

export function createJob(kind: string, title: string, run: (ctx: JobContext) => Promise<unknown>) {
  const job: Job = {
    id: randomBytes(6).toString('hex'),
    kind,
    title,
    state: 'running',
    stage: tx('Starting…', 'Indítás…'),
    progress: null,
    log: [],
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  const ctx: JobContext = {
    stage(name, progress = null) {
      job.stage = toText(name);
      job.progress = progress;
      ctx.log(tx(`▸ ${job.stage.en}`, `▸ ${job.stage.hu}`));
    },
    detail(text) {
      job.stage = toText(text);
    },
    progress(value) {
      job.progress = value === null ? null : Math.max(0, Math.min(1, value));
    },
    log(line) {
      job.log.push(toText(line));
      if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
    },
  };

  run(ctx)
    .then((result) => {
      job.state = 'done';
      job.stage = tx('Done', 'Kész');
      job.progress = 1;
      job.result = result;
    })
    .catch((err: unknown) => {
      job.state = 'error';
      job.error = errorText(err);
      ctx.log(tx(`✖ ${job.error.en}`, `✖ ${job.error.hu}`));
      console.error(`[job ${job.kind}]`, err);
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });

  return job;
}

/** A job as the panel reads it, in one language. */
export const jobView = (job: Job | null, lang: Lang) =>
  job && { ...job, stage: job.stage[lang], log: job.log.map((l) => l[lang]), error: job.error?.[lang] };

export const getJob = (id: string) => jobs.get(id) ?? null;

export const runningJob = (kind?: string) =>
  [...jobs.values()].find((j) => j.state === 'running' && (!kind || j.kind === kind)) ?? null;

/** The most recent job of a kind, so a reopened page can pick up where it left off. */
export const latestJob = (kind: string) =>
  [...jobs.values()].filter((j) => j.kind === kind).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
