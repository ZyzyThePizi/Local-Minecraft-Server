import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, post } from '../api';
import { Button, Field, inputClass, Modal, Notice } from './ui';

export function LoginModal({
  open,
  onClose,
  onLogin,
}: {
  open: boolean;
  onClose: () => void;
  onLogin: (value: { token: string; expiresAt: number }) => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await post<{ token: string; expiresAt: number }>('/api/auth/login', { password }));
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ismeretlen hiba.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Admin belépés">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Jelszó" hint="A backend/.env fájlban lévő ADMIN_PASSWORD.">
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" busy={busy} disabled={!password} icon={<LogIn className="size-4" />} className="w-full">
          Belépés
        </Button>
      </form>
    </Modal>
  );
}
