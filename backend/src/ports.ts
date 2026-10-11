import { createServer } from 'node:net';
import { LocalError, tx } from './i18n.ts';

/** True when nothing listens on the port (tries to bind it for a moment). */
export function isPortFree(port: number, host = '0.0.0.0') {
  return new Promise<boolean>((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen({ port, host, exclusive: true });
  });
}

/** The first free port from `start` that is not in `taken`. */
export async function findFreePort(start: number, taken: Set<number> = new Set(), host = '0.0.0.0') {
  for (let port = start; port < start + 200; port++) {
    if (!taken.has(port) && (await isPortFree(port, host))) return port;
  }
  throw new LocalError(tx(`No free port between ${start} and ${start + 200}.`, `Nincs szabad port ${start} és ${start + 200} között.`));
}
