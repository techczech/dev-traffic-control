import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { QaSnapshot } from '../shared/ipc'

/**
 * Record-root confinement: the one place that decides whether a path is inside
 * the record root. Callers resolve both sides through realpath first (or use
 * {@link realpathBelow}), so neither `..` nor a symlink can move a read or a
 * write outside the root.
 */

/** True when `candidate` is `root` or below it. Both must already be resolved. */
export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/**
 * The realpath of `candidate` when it exists and resolves strictly below
 * `canonicalRoot` (itself already a realpath); otherwise `null`.
 */
export async function realpathBelow(
  canonicalRoot: string,
  candidate: string
): Promise<string | null> {
  let resolved: string
  try {
    resolved = await realpath(candidate)
  } catch {
    return null
  }
  return resolved !== canonicalRoot && isInside(canonicalRoot, resolved) ? resolved : null
}

/** The record root's realpath, or `null` when it does not resolve. */
export async function canonicalRecordRoot(recordRoot: string): Promise<string | null> {
  try {
    return await realpath(recordRoot)
  } catch {
    return null
  }
}

/**
 * The path segments of `candidate` below the record root, when it exists,
 * resolves strictly below the root's realpath, and reaches there through no
 * symlink: its resolved location is the same as where its name says it is.
 * `null` otherwise. A segment starting with `.` is never a record folder.
 */
export async function confinedSegments(
  recordRoot: string,
  candidate: string
): Promise<string[] | null> {
  if (!path.isAbsolute(candidate)) return null
  const canonicalRoot = await canonicalRecordRoot(recordRoot)
  if (!canonicalRoot) return null
  const resolved = await realpathBelow(canonicalRoot, candidate)
  if (!resolved) return null
  const relative = path.relative(canonicalRoot, resolved)
  const named = [path.resolve(recordRoot), canonicalRoot].map((base) =>
    path.relative(base, path.resolve(candidate))
  )
  if (!named.includes(relative)) return null
  const segments = relative.split(path.sep)
  return segments.some((segment) => segment.startsWith('.')) ? null : segments
}

/**
 * A screenshot folder (`<record>.shots`) a write may go into: absent (the
 * first shot creates it beside a confined record), or a real directory below
 * the root reached through no symlink.
 */
export async function shotsFolderIsConfined(
  recordRoot: string,
  shotsDir: string
): Promise<boolean> {
  try {
    await lstat(shotsDir)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
  return (await confinedSegments(recordRoot, shotsDir)) !== null
}

/**
 * Confine an absolute path the renderer asks main to reveal (Show in Finder) to
 * the record root. The path must exist and its realpath must lie inside the
 * root's realpath, so neither `..` nor a symlink can point Finder elsewhere.
 * Returns the resolved path to reveal, or `null` when refused.
 */
export async function confineRevealPath(
  recordRoot: string,
  suppliedPath: unknown
): Promise<string | null> {
  if (typeof suppliedPath !== 'string' || !path.isAbsolute(suppliedPath)) return null
  const canonicalRoot = await canonicalRecordRoot(recordRoot)
  return canonicalRoot ? realpathBelow(canonicalRoot, suppliedPath) : null
}

/**
 * The one gate for every handoff sidecar write that starts in the renderer
 * (archive, restore, copy prompt, archive old). A path passes only when it is
 * exactly the `path` of a handoff in the current snapshot; anything else —
 * unknown, non-string, traversal, a request path, no snapshot — is `null`.
 */
export function confineHandoffPath(
  handoffPath: unknown,
  snapshot: Pick<QaSnapshot, 'handoffs'> | null
): string | null {
  if (!snapshot || typeof handoffPath !== 'string') return null
  return snapshot.handoffs.some((handoff) => handoff.path === handoffPath) ? handoffPath : null
}
