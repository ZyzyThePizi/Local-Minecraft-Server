import { Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useHub } from '../hub/HubProvider';
import { exportKeyring, importKeyring, keyring } from '../hub/keyring';
import { Button, Field, inputClass, Modal, Notice } from './ui';

/**
 * Moving the keyring to another device: a passphrase-encrypted file with the machines and their
 * sign-ins. The sign-ins move (they are cleared here), because a machine ends a session whose
 * refresh token shows up in two places.
 */
export function KeyringModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hub = useHub();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [message, setMessage] = useState<{ tone: 'signal' | 'danger'; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setBusy('export');
    setMessage(null);
    try {
      const text = await exportKeyring(pass);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = `kulcskarika-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      for (const rec of await keyring.list()) {
        if (rec.auth) {
          delete rec.auth;
          await keyring.put(rec);
        }
      }
      await hub.reload();
      setMessage({ tone: 'signal', text: 'Elmentve. A belépések átkerültek a fájlba, ezen az eszközön újra be kell majd lépned.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (f: File) => {
    setBusy('import');
    setMessage(null);
    try {
      const res = await importKeyring(await f.text(), pass);
      await hub.reload();
      setMessage({
        tone: res.conflicts.length ? 'danger' : 'signal',
        text: `${res.added} új, ${res.updated} frissített sziget.${res.conflicts.length ? ` Kihagyva, mert más kulccsal szerepel itt: ${res.conflicts.join(', ')}.` : ''}`,
      });
    } catch (err) {
      setMessage({ tone: 'danger', text: (err as Error).message });
    } finally {
      setBusy(null);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Kulcskarika">
      <div className="space-y-4 text-sm">
        <p className="text-fg-muted">
          A szigetek listája csak ebben a böngészőben van. Másik eszközre egy jelmondattal titkosított fájlban viheted át, a belépésekkel együtt.
        </p>
        <Field label="Jelmondat" hint="Legalább 8 karakter. Nélküle a fájl nem nyitható meg.">
          <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className={inputClass} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" busy={busy === 'export'} disabled={pass.length < 8 || !hub.nodes.length} onClick={doExport} icon={<Download className="size-4" />}>
            Exportálás
          </Button>
          <Button busy={busy === 'import'} disabled={pass.length < 8} onClick={() => file.current?.click()} icon={<Upload className="size-4" />}>
            Importálás
          </Button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </div>
    </Modal>
  );
}
