import { useState } from 'react';
import { ApiError } from '../api';
import { useApi } from '../hub/HubProvider';
import { useT } from '../i18n';
import { Button, Modal, Notice } from './ui';

export function EulaModal({ retry, onClose }: { retry: (() => Promise<void>) | null; onClose: () => void }) {
  const api = useApi();
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t('Unknown error.', 'Ismeretlen hiba.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={retry !== null} onClose={onClose} title="Minecraft EULA">
      <div className="space-y-4 text-sm">
        <p className="text-fg-muted">
          {t('To run a server you have to accept Mojang’s end user licence agreement (EULA). You only need to do this once.', 'A szerver futtatásához el kell fogadnod a Mojang felhasználási feltételeit (EULA). Ezt csak egyszer kell megtenned.')}
        </p>
        <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="inline-block text-signal hover:underline">
          {t('Read the EULA', 'Az EULA elolvasása')} →
        </a>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel', 'Mégse')}
          </Button>
          <Button variant="primary" busy={busy} onClick={accept}>
            {t('Accept and start', 'Elfogadom és indítom')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
