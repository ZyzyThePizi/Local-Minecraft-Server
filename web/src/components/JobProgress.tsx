import { ChevronDown, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get } from '../api';
import type { Job } from '../types';
import { Button } from './ui';

export function JobProgress({
  initial,
  onFinished,
  onStart,
  onDismiss,
}: {
  initial: Job;
  onFinished: (job: Job) => void;
  onStart: () => void;
  onDismiss: () => void;
}) {
  const [job, setJob] = useState(initial);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    if (job.state !== 'running') return;
    const t = setTimeout(async () => {
      try {
        const { job: next } = await get<{ job: Job }>(`/api/admin/jobs/${job.id}`);
        setJob(next);
        if (next.state !== 'running') onFinished(next);
      } catch {
        setJob({ ...job }); // retry on the next tick
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [job, onFinished]);

  const pct = job.progress === null ? null : Math.round(job.progress * 100);
  const tone = job.state === 'error' ? 'border-danger/50' : job.state === 'done' ? 'border-signal/50 brackets-signal' : 'border-line';
  return (
    <section className={`brackets glass animate-rise border ${tone}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
        <span className="label">
          <span className="text-signal">●</span> Telepítés
        </span>
        <span className={`readout text-sm ${job.state === 'error' ? 'text-danger' : 'text-signal'}`}>
          {job.state === 'running' ? (pct === null ? '…' : `${pct}%`) : job.state === 'done' ? 'KÉSZ' : 'HIBA'}
        </span>
      </div>
      <div className="px-5 py-5 sm:px-6">
        <p className="text-xl font-semibold tracking-tight">
          {job.state === 'running' && `${job.title} telepítése`}
          {job.state === 'done' && `${job.title} telepítve`}
          {job.state === 'error' && 'A telepítés nem sikerült'}
        </p>
        <p className="mt-1 text-sm text-fg-muted">{job.state === 'error' ? job.error : job.stage}</p>

        {job.state === 'running' && (
          <div className="mt-4 h-1.5 overflow-hidden bg-line" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={`h-full origin-left bg-signal transition-transform duration-500 ${pct === null ? 'w-1/3 animate-pulse' : 'w-full'}`}
              style={pct === null ? undefined : { transform: `scaleX(${Math.max(0.03, pct / 100)})` }}
            />
          </div>
        )}

        {job.state === 'done' && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {job.result?.activated ? (
              <Button variant="primary" onClick={onStart} icon={<Play className="size-4" />}>
                Szerver indítása
              </Button>
            ) : (
              <p className="text-sm text-fg-muted">Egy másik szerver fut, ezért ezt a Szerverek fülön tudod aktiválni.</p>
            )}
            <Button variant="ghost" onClick={onDismiss}>
              Bezárás
            </Button>
          </div>
        )}
        {job.state === 'error' && (
          <Button variant="ghost" onClick={onDismiss} className="mt-4">
            Bezárás
          </Button>
        )}

        <button onClick={() => setShowLog((v) => !v)} className="label mt-4 inline-flex items-center gap-1 hover:text-fg">
          <ChevronDown className={`size-3.5 transition-transform ${showLog ? 'rotate-180' : ''}`} />
          Részletek
        </button>
        {showLog && (
          <pre className="mt-2 max-h-64 overflow-auto border border-line bg-bg/80 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-muted">
            {job.log.join('\n')}
          </pre>
        )}
      </div>
    </section>
  );
}
