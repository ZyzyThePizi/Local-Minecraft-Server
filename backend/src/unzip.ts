import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { safeJoin } from './download.ts';

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/**
 * Extracts a zip from an untrusted source. Symlink entries and paths that would land
 * outside `dir` are skipped, so a crafted pack cannot write anywhere else on the disk.
 */
export function extractZip(file: string, dir: string) {
  return new Promise<void>((resolveAll, reject) => {
    yauzl.open(file, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) return reject(openErr ?? new Error(`Nem nyitható meg: ${file}`));
      zip.on('error', reject);
      zip.on('end', () => resolveAll());
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.replaceAll('\\', '/');
        const isLink = ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK;
        let dest: string;
        try {
          dest = safeJoin(dir, name);
        } catch {
          return zip.readEntry();
        }
        if (isLink) return zip.readEntry();
        if (name.endsWith('/')) {
          mkdir(dest, { recursive: true }).then(() => zip.readEntry(), reject);
          return;
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr);
          mkdir(dirname(dest), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(dest)))
            .then(() => zip.readEntry(), reject);
        });
      });
      zip.readEntry();
    });
  });
}
