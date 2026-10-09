import { LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { STATE_LABEL } from '../format';
import type { ServerState } from '../types';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-signal text-signal-ink hover:bg-signal-hover font-semibold',
  secondary: 'border border-line-strong text-fg hover:border-fg-muted bg-bg/40',
  danger: 'border border-danger/50 text-danger hover:bg-danger/10',
  ghost: 'text-fg-muted hover:text-fg hover:bg-surface-2',
};

export function Button({
  variant = 'secondary',
  busy = false,
  icon,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex h-10 items-center justify-center gap-2 px-4 font-mono text-xs tracking-[0.08em] uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** Framed module: hairline border, corner brackets, frosted over the world. */
export function Panel({ children, className = '', signal = false }: { children: ReactNode; className?: string; signal?: boolean }) {
  return <section className={`brackets glass border border-line p-5 sm:p-6 ${signal ? 'brackets-signal' : ''} ${className}`}>{children}</section>;
}

export function PanelTitle({ index, children, aside }: { index?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 border-b border-line pb-3">
      <h2 className="label flex items-center gap-2 !text-fg-muted">
        {index && <span className="text-signal">{index}</span>}
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'signal' | 'warn' }) {
  const tones = {
    neutral: 'border-line-strong text-fg-muted',
    signal: 'border-signal/40 text-signal bg-signal-dim',
    warn: 'border-warn/40 text-warn',
  };
  return <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[11px] tracking-[0.06em] uppercase ${tones[tone]}`}>{children}</span>;
}

const STATE_COLOR: Record<ServerState, string> = {
  running: 'bg-signal',
  starting: 'bg-warn animate-pulse',
  stopping: 'bg-warn animate-pulse',
  stopped: 'bg-fg-faint',
  crashed: 'bg-danger',
};
const STATE_TEXT: Record<ServerState, string> = {
  running: 'text-signal',
  starting: 'text-warn',
  stopping: 'text-warn',
  stopped: 'text-fg-muted',
  crashed: 'text-danger',
};

export function StateDot({ state, className = '' }: { state: ServerState; className?: string }) {
  return <span className={`inline-block size-2 ${STATE_COLOR[state]} ${className}`} aria-hidden />;
}

export function StateLabel({ state }: { state: ServerState }) {
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-xs tracking-[0.08em] uppercase ${STATE_TEXT[state]}`}>
      <StateDot state={state} />
      {STATE_LABEL[state]}
    </span>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'signal'; children: ReactNode }) {
  const tones = {
    info: 'border-line-strong text-fg-muted',
    warn: 'border-warn/40 text-warn',
    danger: 'border-danger/40 text-danger',
    signal: 'border-signal/40 text-signal',
  };
  return <div className={`border-l-2 bg-bg/60 px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-2 block">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-fg-faint">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-10 w-full border border-line-strong bg-bg/70 px-3 text-sm text-fg placeholder:text-fg-faint/80 transition-colors focus:border-signal focus:outline-none disabled:opacity-50';

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-fg-faint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 border transition-colors ${checked ? 'border-signal bg-signal-dim' : 'border-line-strong bg-bg/60'}`}
      >
        <span className={`absolute top-[3px] left-[3px] size-4 transition-transform duration-200 ${checked ? 'translate-x-5 bg-signal' : 'bg-fg-faint'}`} />
      </button>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex border border-line-strong bg-bg/60">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-10 px-4 font-mono text-xs tracking-[0.08em] uppercase transition-colors ${
            value === o.value ? 'bg-signal text-signal-ink' : 'text-fg-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`brackets brackets-signal m-auto w-[calc(100%-2rem)] border border-line bg-surface p-0 text-fg ${wide ? 'max-w-2xl' : 'max-w-md'}`}
    >
      {open && (
        <div className="p-5 sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            <button onClick={onClose} className="-m-1 p-1 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Bezárás">
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function GrassBlock({ className = 'size-12' }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className={`pixel ${className}`} />;
}

export function PackIcon({ src, className = 'size-12', eager = false }: { src?: string | null; className?: string; eager?: boolean }) {
  return src ? (
    <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} className={`border border-line bg-surface-2 object-cover ${className}`} />
  ) : (
    <GrassBlock className={className} />
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse border border-line bg-surface/60 ${className}`} />;
}
