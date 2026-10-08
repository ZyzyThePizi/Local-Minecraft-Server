import { CheckCircle2, ChevronDown, LoaderCircle, Play, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get } from '../api';
import type { Job } from '../types';
import { Button, Card } from './ui';

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
  return (
    <Card className={job.state === 'error' ? 'border-danger/40' : job.state === 'done' ? 'border-accent/40' : ''}>
      <div className="flex items-start gap-3">
        {job.state === 'running' && <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-accent" aria-hidden />}
        {job.state === 'done' && <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />}
        {job.state === 'error' && <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {job.state === 'running' && `${job.title} telepítése…`}
            {job.state === 'done' && `${job.title} telepítve!`}
            {job.state === 'error' && 'A telepítés nem sikerült'}
          </p>
          <p className="mt-0.5 text-sm text-muted">{job.state === 'error' ? job.error : job.stage}</p>

          {job.state === 'running' && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={`h-full rounded-full bg-accent transition-[width] duration-500 ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
                style={pct === null ? undefined : { width: `${Math.max(3, pct)}%` }}
              />
            </div>
          )}

          {job.state === 'done' && (
            <div className="mt-4 flex flex-wrap gap-2">
              {job.result?.activated ? (
                <Button variant="primary" onClick={onStart} icon={<Play className="size-4" />}>
                  Szerver indítása
                </Button>
              ) : (
                <p className="text-sm text-muted">Egy másik szerver fut, ezért ezt a Szerverek fülön tudod aktiválni.</p>
              )}
              <Button variant="ghost" onClick={onDismiss}>
                Bezárás
              </Button>
            </div>
          )}
          {job.state === 'error' && (
            <div className="mt-3">
              <Button variant="ghost" onClick={onDismiss}>
                Bezárás
              </Button>
            </div>
          )}

          <button onClick={() => setShowLog((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <ChevronDown className={`size-3.5 transition-transform ${showLog ? 'rotate-180' : ''}`} />
            Részletek
          </button>
          {showLog && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">
              {job.log.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </Card>
  );
}
