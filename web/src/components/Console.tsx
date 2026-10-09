import { SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError, get, post } from '../api';
import { Button } from './ui';

interface Line {
  seq: number;
  line: string;
}

const MAX_LINES = 1500;

function lineClass(line: string) {
  if (line.startsWith('[Panel]')) return 'text-signal';
  if (line.startsWith('> ')) return 'text-fg';
  if (/\bERROR\b|Exception|FATAL/.test(line)) return 'text-danger';
  if (/\bWARN\b/.test(line)) return 'text-warn';
  return 'text-fg-muted';
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
    <div className="bg-bg/80">
      <div
        ref={box}
        onScroll={onScroll}
        className="h-[min(62vh,560px)] overflow-y-auto px-5 py-4 font-mono text-[12.5px] leading-relaxed sm:px-6"
        role="log"
        aria-live="off"
      >
        {lines.length === 0 ? (
          <p className="text-fg-faint">A szerver naplója itt jelenik meg.</p>
        ) : (
          lines.map((l) => (
            <div key={l.seq} className={`break-words whitespace-pre-wrap ${lineClass(l.line)}`}>
              {l.line}
            </div>
          ))
        )}
      </div>
      <form onSubmit={send} className="flex items-stretch border-t border-line">
        <span className="flex items-center pl-5 font-mono text-signal sm:pl-6" aria-hidden>
          &gt;
        </span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!canSend}
          placeholder={canSend ? 'say Sziasztok! · whitelist add Steve · op Steve' : 'A parancsokhoz indítsd el a szervert'}
          className="h-12 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-fg placeholder:text-fg-faint/80 focus:outline-none disabled:opacity-50"
          aria-label="Szerver parancs"
        />
        <Button type="submit" variant="primary" busy={sending} disabled={!canSend || !command.trim()} icon={<SendHorizontal className="size-4" />} className="!h-12">
          <span className="hidden sm:inline">Küldés</span>
        </Button>
      </form>
      {error && <p className="border-t border-line px-5 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
