import { useState } from 'react';
import { ApiError } from '../api';
import { useApi } from '../hub/HubProvider';
import { Button, Modal, Notice } from './ui';

export function EulaModal({ retry, onClose }: { retry: (() => Promise<void>) | null; onClose: () => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch('/api/v1/node', { eulaAccepted: true });
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
