import { X } from 'lucide-react';
import { useHub } from '../hub/HubProvider';
import { useT } from '../i18n';

const TONE = { danger: 'border-danger/50', signal: 'border-signal/50', info: 'border-line-strong' } as const;

/** Alerts from any machine (e.g. a server crashed on another island), while the hub is open. */
export function Toasts() {
  const { toasts, dismissToast } = useHub();
  const t = useT();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100%-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`glass animate-rise pointer-events-auto flex items-start gap-3 border-l-2 px-4 py-3 text-sm ${TONE[toast.tone]}`}>
          <span className="flex-1">{toast.text}</span>
          <button onClick={() => dismissToast(toast.id)} className="-m-1 p-1 text-fg-muted hover:text-fg" aria-label={t('Close', 'Bezárás')}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
