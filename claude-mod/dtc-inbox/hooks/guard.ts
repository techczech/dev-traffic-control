/**
 * The trust boundary. Everything that turns outside text (a tool argument, a dtc:// link, a
 * file name from the records folder, a path read back from the shared `$.store`) into a file read,
 * a process argument or prompt text passes through here. Pure except for the injected fs.
 */

import type { RequestRef } from './paths'

/** One path segment of a request: `[A-Za-z0-9._-]`, not starting with a dot (so never `.` or `..`). */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/

export const isSafeSegment = (s: string): boolean => SEGMENT.test(s)

/**
 * The ref when it is safe to put into a prompt, a URL or a path: the project one safe
 * segment, `rel` one or two safe segments ending `.md`. Null otherwise.
 */
export function safeRef(ref: RequestRef): RequestRef | null {
  if (typeof ref.project !== 'string' || typeof ref.rel !== 'string') return null
  if (!isSafeSegment(ref.project)) return null
  const parts = ref.rel.split('/')
  if (parts.length < 1 || parts.length > 2 || !parts.every(isSafeSegment)) return null
  if (!ref.rel.endsWith('.md') || (parts[parts.length - 1] as string).length <= 3) return null
  return { project: ref.project, rel: ref.rel }
}

/**
 * Traversal or smuggling, spelt any way: a `.` or `..` segment, a control character (NUL
 * included), a backslash, or a percent-encoded dot, slash, backslash or NUL.
 */
export function hasTraversal(text: string): boolean {
  if (/[\u0000-\u001f\u007f\\]/.test(text)) return true
  if (/%(2e|2f|5c|00)/i.test(text)) return true
  return text.split('/').some(s => s === '..' || s === '.')
}

const trim = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** `path` is `root` itself or below it, compared with a trailing separator (so `/x/records-evil` is not under `/x/records`). */
export function isWithin(path: string, root: string): boolean {
  const r = trim(root)
  return path === r || path.startsWith(r === '/' ? '/' : `${r}/`)
}

export type ConfineStat = { kind: 'file' | 'dir' | 'other'; realPath?: string; /** Bytes, for a file. */ size?: number; /** The path itself is a symbolic link. */ isLink?: boolean }

/** The most bytes read of any one file when the caller names no smaller cap. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/** Which file a descriptor or a path names: device and inode, as decimal strings. */
export type FileId = { dev: string; ino: string }

/** What a descriptor-bound read is asked for: the leaf `name` in the folder `parent`, under `root`. */
export type BoundRequest = { root: string; parent: string; name: string; /** The most bytes of content to return. */ maxBytes: number; /** False: open and identify only, read no content. */ wantText: boolean }

/**
 * What one descriptor-bound read observed, in the order it happened. The host produces these
 * facts (see `bound-read.ts`); `confinedTo` judges them and nothing else decides a read.
 */
export type BoundFacts = {
  /** Real path of the root, resolved before the leaf was opened. */
  rootBefore: string
  /** Real path of the leaf's folder, resolved before the leaf was opened. */
  parentBefore: string
  /** `fstat` of the descriptor the leaf was opened to, without following a link at the leaf. `nlink` is how many names the file has. */
  opened: FileId & { kind: 'file' | 'dir' | 'other'; size: number; nlink: number }
  /** Bytes read from that descriptor; 0 when no content was asked for or none was read. */
  bytes: number
  /** The content read from that descriptor; null when none was asked for, or it was not a regular file, or it was over the cap. */
  text: string | null
  /** Real path of the root, resolved again after the read; null when it no longer resolves. */
  rootAfter: string | null
  /** Real path of the leaf's folder, resolved again after the read; null when it no longer resolves. */
  parentAfter: string | null
  /** `lstat` of the leaf's path after the read; null when nothing is there any more. */
  leaf: (FileId & { kind: 'file' | 'dir' | 'link' | 'other' }) | null
}

export type ConfineFs = {
  /** Resolved stat (`$.fs.stat(path, { resolve: true })`): null when the path is missing. Used for folders and presence only, never to read a file. */
  stat: (path: string) => Promise<ConfineStat | null>
  /**
   * The one way a file is opened: no-follow at the leaf, identified and read through the
   * descriptor, with the checks before and after reported as facts. Null when the open failed or
   * the facts could not be gathered. Absent when the host has no such call: every file read and
   * every file check then fails closed.
   */
  bound?: (req: BoundRequest) => Promise<BoundFacts | null>
}

export type Confined = {
  /**
   * Text of a regular file under the root that no symbolic link leads to, read from the descriptor
   * it was opened to (see `confinedTo`). Null otherwise, and null for a file larger than `maxBytes`
   * (default `MAX_FILE_BYTES`) or one that changed place or identity around the read.
   */
  read: (path: string, maxBytes?: number) => Promise<string | null>
  /** Whether the path is a regular file `read` would accept, whatever its size: the same open and the same checks, with no content read. */
  isFile: (path: string) => Promise<boolean>
  /** Whether the path exists and its real path is under the real root. Presence only: nothing is read. */
  exists: (path: string) => Promise<boolean>
  /** The real path of a directory at or under the root; null when it leaves the root or is not a directory. */
  dir: (path: string) => Promise<string | null>
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9]+$/.test(v)

/**
 * Whether the facts of one bound read describe a regular file inside the root that stayed where
 * and what it was for the whole read. `expectedParent` is the root's real path plus the folder's
 * own spelling, so no folder between the root and the file may be a link. The file must have
 * exactly one name: a file with more (a hard link, which may name a file outside the root) is
 * refused. Any mismatch is a no.
 */
export function boundFactsHold(facts: BoundFacts | null | undefined, expectedParent: (rootReal: string) => string): facts is BoundFacts {
  if (facts === null || facts === undefined || typeof facts !== 'object') return false
  const root = facts.rootBefore
  if (typeof root !== 'string' || !root.startsWith('/') || facts.rootAfter !== root) return false
  const parent = expectedParent(trim(root))
  if (facts.parentBefore !== parent || facts.parentAfter !== parent) return false
  const o = facts.opened
  if (o === null || typeof o !== 'object' || o.kind !== 'file' || !isId(o.dev) || !isId(o.ino)) return false
  if (typeof o.size !== 'number' || !Number.isFinite(o.size) || o.size < 0) return false
  // A second name for the same file can lie anywhere on the disk: only a file with one name is read.
  if (o.nlink !== 1) return false
  const l = facts.leaf
  // The path must still name the very file the descriptor holds: not a link, not another file.
  return l !== null && typeof l === 'object' && l.kind === 'file' && l.dev === o.dev && l.ino === o.ino
}

/**
 * File access held to `root`. A path is refused when it spells traversal or its spelling is not
 * under the root. Every file is read through one primitive (`fs.bound`):
 *
 * 1. the real path of the file's folder must be the root's real path plus the folder's own
 *    spelling (inside the root, and no link on the way);
 * 2. the leaf is opened without following a link, and the descriptor is identified (`fstat`): a
 *    regular file with exactly one name (link count 1), no larger than the cap;
 * 3. the content is read from that descriptor, never from the pathname again;
 * 4. after the read the folder's real path must be unchanged, and the path must still name the
 *    same file (device and inode) as the descriptor.
 *
 * Anything else reads as "could not read": a mismatch, a host with no bound read, a failed call.
 * The root itself may be a link; its real path is resolved at every read and must not change
 * during it. A file with more than one name (a hard link) is "could not read", whichever name was asked for.
 */
export function confinedTo(root: string, fs: ConfineFs): Confined {
  const spelt = trim(root)
  const isSpeltInside = (path: string): boolean => typeof path === 'string' && path.startsWith('/') && !hasTraversal(path) && isWithin(path, spelt)
  let realRoot: Promise<string | null> | undefined
  const rootReal = (): Promise<string | null> =>
    (realRoot ??= fs
      .stat(spelt)
      .then(s => (s !== null && s.kind === 'dir' && typeof s.realPath === 'string' ? trim(s.realPath) : null))
      .catch(() => null))

  const place = async (path: string): Promise<(ConfineStat & { realPath: string }) | null> => {
    if (!isSpeltInside(path)) return null
    const r = await rootReal()
    if (r === null) return null
    const s = await fs.stat(path).catch(() => null)
    if (s === null || typeof s.realPath !== 'string' || !isWithin(s.realPath, r)) return null
    return { kind: s.kind, realPath: s.realPath, ...(typeof s.size === 'number' ? { size: s.size } : {}), ...(s.isLink === true ? { isLink: true } : {}) }
  }

  /** The facts of one bound read of `path`, when they hold; null otherwise. */
  const bound = async (path: string, maxBytes: number, wantText: boolean): Promise<BoundFacts | null> => {
    if (fs.bound === undefined || !isSpeltInside(path) || path === spelt) return null
    const cut = path.lastIndexOf('/')
    const parent = path.slice(0, cut)
    const name = path.slice(cut + 1)
    if (name === '' || !isWithin(parent, spelt)) return null
    const facts = await fs.bound({ root: spelt, parent, name, maxBytes, wantText }).catch(() => null)
    return boundFactsHold(facts, r => `${r === '/' ? '' : r}${parent.slice(spelt.length)}`) ? facts : null
  }

  return {
    read: async (path, maxBytes = MAX_FILE_BYTES) => {
      if (!Number.isFinite(maxBytes) || maxBytes < 0) return null
      const f = await bound(path, maxBytes, true)
      if (f === null || f.opened.size > maxBytes) return null
      if (typeof f.bytes !== 'number' || !Number.isFinite(f.bytes) || f.bytes > maxBytes) return null
      return typeof f.text !== 'string' || f.text.length > maxBytes ? null : f.text
    },
    isFile: async path => (await bound(path, 0, false)) !== null,
    exists: async path => (await place(path)) !== null,
    dir: async path => {
      const p = await place(path)
      return p !== null && p.kind === 'dir' ? p.realPath : null
    },
  }
}

/** Toast text: control characters (terminal escapes included) become spaces, at most `max` characters. */
export function plain(text: string, max = 200): string {
  const t = String(text).replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
