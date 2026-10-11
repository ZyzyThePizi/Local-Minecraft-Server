import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, deviceLabel, login } from '../hub/client';
import { useHub, type HubNode } from '../hub/HubProvider';
import { useT } from '../i18n';
import { parseJoin } from '../hub/links';
import { Button, Field, inputClass, Modal, Notice } from './ui';

/** Sign in to a machine that is already on the list: its password, or an invite link made for it. */
export function LoginModal({ node, open, onClose }: { node: HubNode; open: boolean; onClose: () => void }) {
  const hub = useHub();
  const t = useT();
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
      if (join && join.n !== node.rec.nodeId) throw new ApiError(400, 'WRONG_MACHINE', t('This invite was made for another machine.', 'Ez a meghívó egy másik géphez készült.'));
      const label = device.trim() || deviceLabel();
      const tokens = await login(node.rec.url, join ? { invite: join.i, device: label } : { password: secret.trim(), device: label });
      await hub.signIn(node.rec.nodeId, tokens, label);
      setSecret('');
      onClose();
      setTimeout(() => document.getElementById('admin')?.scrollIntoView({ behavior: 'smooth' }), 600);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Unknown error.', 'Ismeretlen hiba.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t(`Sign in: ${node.rec.name}`, `Belépés: ${node.rec.name}`)}>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label={t('Password or invite link', 'Jelszó vagy meghívólink')}
          hint={t('The ADMIN_PASSWORD in the machine’s backend/.env file, or the invite link its owner sent you.', 'A gép backend/.env fájljában lévő ADMIN_PASSWORD, vagy a tulajdonostól kapott meghívólink.')}
        >
          <input type="password" autoComplete="current-password" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t('Device name', 'Eszköz neve')}>
          <input value={device} onChange={(e) => setDevice(e.target.value)} maxLength={60} className={inputClass} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" busy={busy} disabled={!secret.trim()} icon={<LogIn className="size-4" />} className="w-full">
          {t('Sign in', 'Belépés')}
        </Button>
      </form>
    </Modal>
  );
}
