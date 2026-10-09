import { useState } from 'react';
import { ApiError, builtInUrls, getCustomUrl, put, setCustomUrl } from '../api';
import { Button, Field, inputClass, Modal, Notice } from './ui';

export function EulaModal({ retry, onClose }: { retry: (() => Promise<void>) | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await put('/api/admin/settings', { eulaAccepted: true });
      await retry?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ismeretlen hiba.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={retry !== null} onClose={onClose} title="Minecraft EULA">
      <div className="space-y-4 text-sm">
        <p className="text-fg-muted">
          A szerver futtatásához el kell fogadnod a Mojang felhasználási feltételeit (EULA). Ezt csak egyszer kell megtenned.
        </p>
        <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="inline-block text-signal hover:underline">
          Az EULA elolvasása →
        </a>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Mégse
          </Button>
          <Button variant="primary" busy={busy} onClick={accept}>
            Elfogadom és indítom
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function BackendModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [url, setUrl] = useState(getCustomUrl() ?? '');
  const valid = !url || /^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(url.trim());
  const save = (value: string | null) => {
    setCustomUrl(value);
    onClose();
    onChanged();
  };
  return (
    <Modal open={open} onClose={onClose} title="Backend cím">
      <div className="space-y-4 text-sm">
        <p className="text-fg-muted">
          Az oldal magától megkeresi, melyik gépen fut a backend. Ha egy új gépet használsz, itt megadhatod a címét (pl. a Tailscale Funnel
          címet).
        </p>
        {builtInUrls().length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">Beépített címek:</p>
            <ul className="space-y-1 font-mono text-xs">
              {builtInUrls().map((u) => (
                <li key={u} className="truncate">
                  {u}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field label="Egyéni cím">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gepem.tailXXXX.ts.net:10000" className={`${inputClass} font-mono`} />
        </Field>
        {!valid && <Notice tone="warn">A cím formája: https://host[:port]</Notice>}
        <div className="flex justify-end gap-2">
          {getCustomUrl() && (
            <Button variant="ghost" onClick={() => save(null)}>
              Törlés
            </Button>
          )}
          <Button variant="primary" disabled={!url.trim() || !valid} onClick={() => save(url.trim())}>
            Mentés
          </Button>
        </div>
      </div>
    </Modal>
  );
}
