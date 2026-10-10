import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, deviceLabel, login } from '../hub/client';
import { useHub, type HubNode } from '../hub/HubProvider';
import { parseJoin } from '../hub/links';
import { Button, Field, inputClass, Modal, Notice } from './ui';

/** Sign in to a machine that is already on the list: its password, or an invite link made for it. */
export function LoginModal({ node, open, onClose }: { node: HubNode; open: boolean; onClose: () => void }) {
  const hub = useHub();
  const [secret, setSecret] = useState('');
  const [device, setDevice] = useState(deviceLabel());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const join = parseJoin(secret);
      if (join && join.n !== node.rec.nodeId) throw new ApiError(400, 'WRONG_MACHINE', 'Ez a meghívó egy másik géphez készült.');
      const label = device.trim() || deviceLabel();
      const tokens = await login(node.rec.url, join ? { invite: join.i, device: label } : { password: secret.trim(), device: label });
      await hub.signIn(node.rec.nodeId, tokens, label);
      setSecret('');
      onClose();
      setTimeout(() => document.getElementById('admin')?.scrollIntoView({ behavior: 'smooth' }), 600);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ismeretlen hiba.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Belépés: ${node.rec.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Jelszó vagy meghívólink" hint="A gép backend/.env fájljában lévő ADMIN_PASSWORD, vagy a tulajdonostól kapott meghívólink.">
          <input type="password" autoComplete="current-password" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Eszköz neve">
          <input value={device} onChange={(e) => setDevice(e.target.value)} maxLength={60} className={inputClass} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" busy={busy} disabled={!secret.trim()} icon={<LogIn className="size-4" />} className="w-full">
          Belépés
        </Button>
      </form>
    </Modal>
  );
}
