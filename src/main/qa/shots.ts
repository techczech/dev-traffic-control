import path from 'node:path';
import { recordRelative, writeConfinedAtomic } from '../confinedFs';

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
 * actually written. The file is created exclusively, so a symlink planted at
 * the chosen name is never followed; an existing name (planted or a concurrent
 * shot) moves on to `<item>-<n+1>.png` instead of overwriting it.
 *
 * The write is confined (confinedFs): the shots folder is created when missing
 * and must be a real folder all the way down from `recordRoot`, the records
 * folder. Without `recordRoot` the folder holding the shots folder stands in.
 */
export async function saveShot(p: string, png: Buffer, recordRoot?: string): Promise<string> {
  if (png.length === 0) throw new Error('refusing to write empty screenshot buffer');
  const dir = path.dirname(p);
  const root = recordRoot ?? path.dirname(dir);
  const relDir = await recordRelative(root, dir);
  const numbered = path.basename(p).match(/^(.*)-(\d+)\.png$/);
  let candidate = p;
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    try {
      await writeConfinedAtomic(root, `${relDir}/${path.basename(candidate)}`, png, {
        exclusive: true,
        makeDirs: true
      });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !numbered) throw error;
      const next = Number(numbered[2]) + attempt + 1;
      candidate = path.join(path.dirname(p), `${numbered[1]}-${next}.png`);
    }
  }
  throw new Error('no free screenshot name');
}
