import { lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from './qa/atomicWrite'
import { canonicalRecordRoot } from './confinement'
import {
  EXAMPLE_MARKER,
  EXAMPLE_SLUG,
  type ExampleOpenResult,
  type ExampleRemoveResult
} from '../shared/example'

/**
 * The example project a new user can open from Get started (ticket 34).
 *
 * The app bundles `resources/example-app/`. Opening it copies that folder into
 * `<records folder>/example-app/` — only when no folder of that name exists —
 * and stamps a marker file that says the app put it there. Removing it deletes
 * that one folder, and only while it still carries the marker. Nothing else in
 * the records folder is ever written or removed here.
 *
 * Confinement follows tickets 24/25: the record root is resolved through
 * realpath, the target is a fixed name directly below it, no symlink is ever
 * followed (an existing entry of any kind — symlink included — is refused),
 * every file goes through the atomic writer, and a directory is written into
 * only after `lstat` shows it is a real directory.
 */

const MARKER_BODY = `${JSON.stringify({ example: 'dev-traffic-control', version: 1 }, null, 2)}\n`

/** Whether `candidate` exists as a real directory (a symlink is not one). */
async function isRealDirectory(candidate: string): Promise<boolean> {
  try {
    const info = await lstat(candidate)
    return info.isDirectory() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

/**
 * True when `folder` is a real directory holding the example's marker as a
 * regular file (not a symlink) with the marker's content.
 */
export async function carriesExampleMarker(folder: string): Promise<boolean> {
  if (!(await isRealDirectory(folder))) return false
  const marker = path.join(folder, EXAMPLE_MARKER)
  try {
    const info = await lstat(marker)
    if (!info.isFile()) return false
    const parsed = JSON.parse(await readFile(marker, 'utf8')) as { example?: unknown }
    return parsed?.example === 'dev-traffic-control'
  } catch {
    return false
  }
}

/** The example folder's path under the resolved record root, or null. */
async function exampleTarget(recordRoot: string): Promise<string | null> {
  const canonicalRoot = await canonicalRecordRoot(recordRoot)
  if (!canonicalRoot || !(await isRealDirectory(canonicalRoot))) return null
  return path.join(canonicalRoot, EXAMPLE_SLUG)
}

/** Whether the records folder holds the app's own example project right now. */
export async function examplePresent(recordRoot: string): Promise<boolean> {
  const target = await exampleTarget(recordRoot)
  return target ? carriesExampleMarker(target) : false
}

/**
 * Copy the bundled example into the records folder. An example already there
 * (marker present) is left as it is and reported `present`; any other entry
 * named `example-app` — a folder of the user's own, a file, a symlink — is
 * refused and nothing is written.
 */
export async function openExample(
  recordRoot: string,
  sourceDir: string
): Promise<ExampleOpenResult> {
  const target = await exampleTarget(recordRoot)
  if (!target) return { kind: 'refused', reason: 'no-root' }
  if (await carriesExampleMarker(target)) return { kind: 'present', slug: EXAMPLE_SLUG }
  if (await exists(target)) return { kind: 'refused', reason: 'folder-exists' }
  if (!(await isRealDirectory(sourceDir))) return { kind: 'refused', reason: 'no-source' }

  try {
    // Not recursive: the parent is the resolved root, and a folder (or link)
    // that appeared since the check above makes this fail with EEXIST.
    await mkdir(target)
  } catch (error) {
    return {
      kind: 'refused',
      reason: (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'folder-exists' : 'write-failed'
    }
  }
  try {
    // The marker goes first, so even a copy that fails halfway can be removed.
    await writeInto(target, EXAMPLE_MARKER, MARKER_BODY)
    await copyTree(sourceDir, target)
    return { kind: 'installed', slug: EXAMPLE_SLUG }
  } catch {
    // The folder did not exist before this call, so everything in it is ours.
    await rm(target, { recursive: true, force: true }).catch(() => undefined)
    return { kind: 'refused', reason: 'write-failed' }
  }
}

async function writeInto(dir: string, name: string, data: string | Buffer): Promise<void> {
  if (!(await isRealDirectory(dir))) throw new Error(`not a real directory: ${dir}`)
  await atomicWrite(path.join(dir, name), data)
}

/**
 * Copy regular files and directories from the bundle. Dot entries and
 * anything that is neither (a symlink in the bundle, say) are skipped.
 */
async function copyTree(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const source = path.join(from, entry.name)
    if (entry.isDirectory()) {
      if (!(await isRealDirectory(to))) throw new Error(`not a real directory: ${to}`)
      const child = path.join(to, entry.name)
      await mkdir(child)
      await copyTree(source, child)
    } else if (entry.isFile()) {
      await writeInto(to, entry.name, await readFile(source))
    }
  }
}

/**
 * Delete `<records folder>/example-app/`, and only that, when it is a real
 * directory still carrying the example's marker.
 */
export async function removeExample(recordRoot: string): Promise<ExampleRemoveResult> {
  const target = await exampleTarget(recordRoot)
  if (!target) return { kind: 'refused', reason: 'no-root' }
  if (!(await exists(target))) return { kind: 'refused', reason: 'absent' }
  if (!(await carriesExampleMarker(target))) return { kind: 'refused', reason: 'not-example' }
  try {
    // rm removes symlinks found inside the folder; it never follows them.
    await rm(target, { recursive: true })
    return { kind: 'removed' }
  } catch {
    return { kind: 'refused', reason: 'remove-failed' }
  }
}
