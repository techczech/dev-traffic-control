import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { isInside } from './confinement'

/**
 * Resolve a renderer-supplied request path to the exact path held by the
 * current authoritative scan. Both the root and candidate are resolved
 * through realpath so a symlink cannot move a write outside the record repo.
 */
export async function confineRequestPath(
  recordRoot: string,
  scannedRequestPaths: readonly string[],
  suppliedPath: string
): Promise<string> {
  if (!suppliedPath.endsWith('.md')) throw new Error('request path must end in .md')

  const canonicalRoot = await realpath(recordRoot)
  const candidate = path.isAbsolute(suppliedPath)
    ? path.resolve(suppliedPath)
    : path.resolve(recordRoot, suppliedPath)
  let canonicalCandidate: string
  try {
    canonicalCandidate = await realpath(candidate)
  } catch {
    throw new Error('request path is not an existing scanned request')
  }
  if (!isInside(canonicalRoot, canonicalCandidate)) {
    throw new Error('request path is outside the record root')
  }

  for (const authoritativePath of scannedRequestPaths) {
    if (!authoritativePath.endsWith('.md')) continue
    let canonicalAuthoritative: string
    try {
      canonicalAuthoritative = await realpath(authoritativePath)
    } catch {
      continue
    }
    if (!isInside(canonicalRoot, canonicalAuthoritative)) continue
    if (canonicalAuthoritative === canonicalCandidate) return authoritativePath
  }
  throw new Error('request path is not an existing scanned request')
}

/**
 * A record path that has been through the confinement gate.
 *
 * Confined-but-absent and refused are separate outcomes on purpose
 * (ADR-0016 § Security): a link whose path confines cleanly but names a file
 * this Mac does not have yet is rootsync being behind, and must not be reported
 * as a safety refusal. If sync lag ever wore the refusal's appearance, the reviewer
 * would learn to ignore refusals.
 */
export type ConfinedRecordPath =
  { kind: 'confined'; path: string; exists: boolean } | { kind: 'refused' }

const REFUSED: ConfinedRecordPath = { kind: 'refused' }

/**
 * Confine a record-root-relative path from a `dtc://` link to the record root.
 *
 * Runs in MAIN, before any renderer sees the path. A path that escapes is
 * refused outright and never clamped to something inside the root.
 *
 * Every ancestor is realpath-resolved on the way down, so a symlink that points
 * outside the root is caught even when the leaf itself does not exist — the
 * case a leaf-only `realpath` cannot see, because the leaf's ENOENT looks
 * exactly like a record that has not synced yet.
 */
export async function confineRecordPath(
  recordRoot: string,
  relativePath: string
): Promise<ConfinedRecordPath> {
  if (relativePath.length === 0 || path.isAbsolute(relativePath)) return REFUSED
  const segments = relativePath.split(/[/\\]/)
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return REFUSED
  }

  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(recordRoot)
  } catch {
    // No resolvable record root: nothing can be confined to it, so nothing opens.
    return REFUSED
  }

  let resolved = canonicalRoot
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = path.join(resolved, segments[index])
    let canonicalCandidate: string
    try {
      canonicalCandidate = await realpath(candidate)
    } catch (error) {
      // Only "it is not there" means not there. A permission error or a symlink
      // loop is refused rather than reported as a record still in flight.
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return REFUSED
      // The parent is confined and every remaining segment is a plain name, so
      // the full path is inside the root — it simply is not on this Mac yet.
      return {
        kind: 'confined',
        path: path.join(candidate, ...segments.slice(index + 1)),
        exists: false
      }
    }
    if (!isInside(canonicalRoot, canonicalCandidate)) return REFUSED
    resolved = canonicalCandidate
  }
  return { kind: 'confined', path: resolved, exists: true }
}
