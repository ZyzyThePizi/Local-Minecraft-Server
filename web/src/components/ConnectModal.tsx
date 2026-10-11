import { KeyRound, LogIn, ShieldAlert, ShieldCheck, Ticket } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, deviceLabel, hello, login, type Hello } from '../hub/client';
import { groupFingerprint } from '../hub/crypto';
import { useHub } from '../hub/HubProvider';
import { useT } from '../i18n';
import { keyring } from '../hub/keyring';
import { parseJoin, parseMachineUrl, type JoinPayload } from '../hub/links';
import { Button, Field, inputClass, Modal, Notice } from './ui';

type Step = { kind: 'input' } | { kind: 'verify'; url: string; hello: Hello & { verified: boolean }; join: JoinPayload | null; known: boolean };

/**
 * Adds a machine to the hub: address or invite link → identity check (fingerprint) → sign in.
 * An existing entry is only reused when the machine still has the pinned key.
 */
export function ConnectModal({
  open,
  initial,
  onClose,
  onConnected,
}: {
  open: boolean;
  /** Prefilled address or invite link (from #add= or #join=). */
  initial: string;
  onClose: () => void;
  onConnected: (nodeId: string) => void;
}) {
  const hub = useHub();
  const t = useT();
  const [text, setText] = useState(initial);
  const [step, setStep] = useState<Step>({ kind: 'input' });
  const [password, setPassword] = useState('');
  const [device, setDevice] = useState(deviceLabel());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText(initial);
    setStep({ kind: 'input' });
    setPassword('');
    setError(null);
    if (initial) void check(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  async function check(value: string) {
    setError(null);
    const join = parseJoin(value);
    const url = join ? parseMachineUrl(join.u) : parseMachineUrl(value);
    if (!url) {
      setError(
        t(
          'This is not a machine address or an invite link. An address starts with https:// (e.g. https://pc.tailXXXX.ts.net:10000).',
          'Ez nem egy gép címe vagy meghívólink. A cím https://-sel kezdődik (pl. https://gep.tailXXXX.ts.net:10000).',
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const pinned = join ? await keyring.get(join.n) : (await keyring.list()).find((r) => r.url === url);
      const h = await hello(url, pinned?.publicKey);
      if (join && join.n !== h.nodeId) throw new ApiError(495, 'WRONG_MACHINE', t('The invite was made for a different machine than the one answering at this address.', 'A meghívó egy másik géphez készült, mint ami ezen a címen válaszol.'));
      setStep({ kind: 'verify', url, hello: h, join, known: Boolean(pinned) });
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setError(
        e?.code === 'KEY_CHANGED'
          ? t(
              'This machine is already on your list, but it now answered with a different key. If it was reinstalled, accept the new key on its island; if not, do not connect.',
              'Ez a gép már szerepel a listádban, de most más kulccsal válaszolt. Ha újratelepítették, a szigetén fogadd el az új kulcsot; ha nem, ne csatlakozz.',
            )
          : (e?.message ?? t('Unknown error.', 'Ismeretlen hiba.')),
      );
    } finally {
      setBusy(false);
    }
  }

  const submitInput = (e: FormEvent) => {
    e.preventDefault();
    void check(text);
  };

  const connect = async (mode: 'password' | 'invite' | 'view') => {
    if (step.kind !== 'verify') return;
    setBusy(true);
    setError(null);
    try {
      const label = device.trim() || deviceLabel();
      const tokens =
        mode === 'view'
          ? undefined
          : await login(step.url, mode === 'invite' ? { invite: step.join!.i, device: label } : { password: password.trim(), device: label });
      await hub.addNode(step.hello, step.url, tokens, label);
      setPassword('');
      onConnected(step.hello.nodeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Unknown error.', 'Ismeretlen hiba.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={step.kind === 'verify' ? step.hello.name : t('Add an island', 'Sziget hozzáadása')}>
      {step.kind === 'input' ? (
        <form onSubmit={submitInput} className="space-y-4 text-sm">
          <p className="text-fg-muted">
            {t('Paste the machine’s address (its backend window prints it at startup), or the invite link its owner sent you.', 'Illeszd be a gép címét (a backend ablaka kiírja indításkor), vagy a meghívólinket, amit a gép tulajdonosától kaptál.')}
          </p>
          <Field label={t('Address or invite link', 'Cím vagy meghívólink')}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              placeholder={t('https://pc.tailXXXX.ts.net:10000', 'https://gep.tailXXXX.ts.net:10000')}
              className={`${inputClass} font-mono`}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" variant="primary" busy={busy} disabled={!text.trim()} className="w-full">
            {t('Continue', 'Tovább')}
          </Button>
        </form>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="border border-line bg-bg/60 p-4">
            <p className="label">{t('Machine fingerprint', 'Gép ujjlenyomata')}</p>
            <p className="readout mt-2 text-base tracking-wide text-fg">{groupFingerprint(step.hello.nodeId)}</p>
            <p className="mt-3 flex items-start gap-2 text-xs text-fg-muted">
              {step.hello.verified ? (
                <>
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
                  {t('The machine proved that it holds this key.', 'A gép igazolta, hogy övé ez a kulcs.')}{' '}
                  {step.known
                    ? t('It matches the one saved earlier.', 'Egyezik a korábban elmentettel.')
                    : t('If the owner gave you the fingerprint, compare them: the backend window prints it.', 'Ha a tulajdonos megadta az ujjlenyomatot, hasonlítsd össze: a backend ablaka kiírja.')}
                </>
              ) : (
                <>
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  {t('This browser cannot check the machine’s signature (Ed25519). Update the browser, or compare the fingerprint with the backend window.', 'Ez a böngésző nem tudja ellenőrizni a gép aláírását (Ed25519). Frissítsd a böngészőt, vagy hasonlítsd össze az ujjlenyomatot a backend ablakával.')}
                </>
              )}
            </p>
            <p className="label mt-3 !normal-case !tracking-normal">
              {step.url} · v{step.hello.version}
            </p>
          </div>

          <Field label={t('Device name', 'Eszköz neve')} hint={t('This is how you appear among the machine’s signed-in devices and in its audit log.', 'Így látszol a gép munkamenetei és az audit napló között.')}>
            <input value={device} onChange={(e) => setDevice(e.target.value)} maxLength={60} className={inputClass} />
          </Field>

          {step.join ? (
            <Button variant="primary" busy={busy} onClick={() => connect('invite')} icon={<Ticket className="size-4" />} className="w-full">
              {t('Join with the invite', 'Csatlakozás a meghívóval')}
            </Button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void connect('password');
              }}
              className="space-y-3"
            >
              <Field label={t('Password', 'Jelszó')} hint={t('The ADMIN_PASSWORD in the machine’s backend/.env file. Whoever knows it has full access.', 'A gép backend/.env fájljában lévő ADMIN_PASSWORD. Aki tudja, teljes hozzáférést kap.')}>
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </Field>
              <Button type="submit" variant="primary" busy={busy} disabled={!password.trim()} icon={<LogIn className="size-4" />} className="w-full">
                {t('Sign in', 'Belépés')}
              </Button>
            </form>
          )}
          {!step.join && step.hello.publicStatus && (
            <Button variant="ghost" disabled={busy} onClick={() => connect('view')} icon={<KeyRound className="size-4" />} className="w-full">
              {t('Add without a password (view only)', 'Hozzáadás jelszó nélkül (csak megtekintés)')}
            </Button>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          <button onClick={() => setStep({ kind: 'input' })} className="label hover:text-fg">
            ← {t('Another address', 'Másik cím')}
          </button>
        </div>
      )}
    </Modal>
  );
}
