import { SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError, get, post } from '../api';
import { Button, inputClass } from './ui';

interface Line {
  seq: number;
  line: string;
}

const MAX_LINES = 1500;

function lineClass(line: string) {
  if (line.startsWith('[Panel]')) return 'text-accent';
  if (line.startsWith('> ')) return 'text-info';
  if (/\bERROR\b|Exception|FATAL/.test(line)) return 'text-danger';
  if (/\bWARN\b/.test(line)) return 'text-warn';
  return 'text-ink/85';
}

export function Console({ canSend }: { canSend: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const lastSeq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await get<{ lines: Line[]; last: number }>(`/api/admin/server/logs?since=${lastSeq.current}`);
        if (!alive) return;
        // The backend restarted: its counter starts over, so reload from scratch.
        if (res.last < lastSeq.current) {
          lastSeq.current = 0;
          setLines([]);
        } else if (res.lines.length) {
          lastSeq.current = res.last;
          setLines((prev) => [...prev, ...res.lines].slice(-MAX_LINES));
        }
      } catch {
        /* the status card already reports connection problems */
      }
      if (alive) timer = setTimeout(poll, 1000);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;
    setSending(true);
    setError(null);
    try {
      await post('/api/admin/server/command', { command: cmd });
      history.current = [cmd, ...history.current.filter((h) => h !== cmd)].slice(0, 50);
      historyIndex.current = -1;
      setCommand('');
      stick.current = true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nem sikerült elküldeni.');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const h = history.current;
    historyIndex.current = Math.max(-1, Math.min(h.length - 1, historyIndex.current + (e.key === 'ArrowUp' ? 1 : -1)));
    setCommand(historyIndex.current >= 0 ? h[historyIndex.current]! : '');
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#0a0c0b]">
      <div
        ref={box}
        onScroll={onScroll}
        className="h-[min(55vh,480px)] overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed"
        role="log"
        aria-live="off"
      >
        {lines.length === 0 ? (
          <p className="text-muted">A szerver naplója itt jelenik meg.</p>
        ) : (
          lines.map((l) => (
            <div key={l.seq} className={`break-words whitespace-pre-wrap ${lineClass(l.line)}`}>
              {l.line}
            </div>
          ))
        )}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-line bg-surface p-2">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!canSend}
          placeholder={canSend ? 'Parancs, pl. say Sziasztok! · whitelist add Steve · op Steve' : 'A parancsokhoz indítsd el a szervert'}
          className={`${inputClass} font-mono`}
          aria-label="Szerver parancs"
        />
        <Button type="submit" variant="primary" busy={sending} disabled={!canSend || !command.trim()} icon={<SendHorizontal className="size-4" />}>
          <span className="hidden sm:inline">Küldés</span>
        </Button>
      </form>
      {error && <p className="border-t border-line px-4 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
