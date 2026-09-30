import { randomBytes } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';

/**
 * Write `data` to `p` via a sibling temp file and a rename.
 *
 * The temp name carries a random suffix and is created exclusively (`wx`), so a
 * symlink planted at a guessable `<p>.tmp-…` name cannot redirect the write:
 * `wx` refuses to open an existing path, symlink included. The rename then
 * replaces `p` itself rather than following it. On any failure the temp file is
 * removed, so a failed write leaves nothing behind.
 */
export async function atomicWrite(p: string, data: string | Buffer): Promise<void> {
  const tmp = `${p}.tmp-${randomBytes(12).toString('hex')}`;
  try {
    await writeFile(tmp, data, typeof data === 'string' ? { encoding: 'utf8', flag: 'wx' } : { flag: 'wx' });
    await rename(tmp, p);
  } catch (error) {
    // EEXIST means the temp name was already taken and nothing was written:
    // whatever sits there is not ours to remove. Any other failure may have
    // left a partial temp file of our own, so it goes.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await unlink(tmp).catch(() => undefined);
    }
    throw error;
  }
}
