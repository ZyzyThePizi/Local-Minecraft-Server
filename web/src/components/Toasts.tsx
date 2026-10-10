import { X } from 'lucide-react';
import { useHub } from '../hub/HubProvider';

const TONE = { danger: 'border-danger/50', signal: 'border-signal/50', info: 'border-line-strong' } as const;

/** Alerts from any machine (e.g. a server crashed on another island), while the hub is open. */
export function Toasts() {
  const { toasts, dismissToast } = useHub();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100%-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`glass animate-rise pointer-events-auto flex items-start gap-3 border-l-2 px-4 py-3 text-sm ${TONE[t.tone]}`}>
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismissToast(t.id)} className="-m-1 p-1 text-fg-muted hover:text-fg" aria-label="Bezárás">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
