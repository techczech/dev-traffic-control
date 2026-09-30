import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function shotsDirFor(basename: string): string {
  return `${basename}.shots`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function nextShotPath(dir: string, itemId: string, existing: string[]): string {
  // Ids are slugs; anything else could name a path outside `dir`.
  if (!/^[A-Za-z0-9_-]+$/.test(itemId)) throw new Error(`invalid screenshot item id: ${itemId}`);
  const nums = existing
    .map(n => n.match(new RegExp(`^${escapeRegExp(itemId)}-(\\d+)\\.png$`)))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => Number(m[1]));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return path.join(dir, `${itemId}-${next}.png`);
}

const MAX_NAME_ATTEMPTS = 100;

/**
 * Write a PNG at `p`, or at the next free number after it, and return the path
 * actually written. The file is created exclusively (`wx`), so a symlink
 * planted at the chosen name is never followed; an existing name (planted or
 * a concurrent shot) moves on to `<item>-<n+1>.png` instead of overwriting it.
 */
export async function saveShot(p: string, png: Buffer): Promise<string> {
  if (png.length === 0) throw new Error('refusing to write empty screenshot buffer');
  await mkdir(path.dirname(p), { recursive: true });
  const numbered = path.basename(p).match(/^(.*)-(\d+)\.png$/);
  let candidate = p;
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    try {
      await writeFile(candidate, png, { flag: 'wx' });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !numbered) throw error;
      const next = Number(numbered[2]) + attempt + 1;
      candidate = path.join(path.dirname(p), `${numbered[1]}-${next}.png`);
    }
  }
  throw new Error('no free screenshot name');
}
