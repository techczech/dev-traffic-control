import { randomBytes } from 'node:crypto'
import { constants, type Dirent, type Stats } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink
} from 'node:fs/promises'
import path from 'node:path'
import { isInside } from './confinement'

/**
 * Record-folder file access where the confinement check and the use are one
 * operation, as far as Node allows.
 *
 * The rule, the same for every read and write of record content:
 *
 * 1. The path is plain names below the records folder: no `..`, no `.`, no
 *    absolute path.
 * 2. The folder holding the file must be exactly where its name says it is.
 *    Every folder between the records folder and the file is looked at with
 *    `lstat` and must be a real folder, never a symlink, whether the link
 *    points outside the records folder or inside it. With no link on the way
 *    down, the folder's realpath is `realpath(root)` plus the same names, so
 *    it lies inside the records folder. (The records folder itself may be
 *    reached through a link: it is the place the user chose.)
 * 3. The file itself is opened with `O_NOFOLLOW`; a symlink in its place is
 *    refused. Everything after that goes through the open descriptor: `fstat`
 *    says whether it is a regular file and how large, and the bytes are read
 *    or written through the same descriptor, never through the name again.
 *    A regular file with more than one name (a hard link) is refused too: one
 *    of its names may lie outside the records folder, and nothing about the
 *    path says so. That holds for every read, and for the one kind of write
 *    that opens an existing file ({@link overwriteConfined}).
 * 4. A write goes to a temporary file created with `O_EXCL` beside the target.
 *    Before that file is renamed into place, the way down is checked again and
 *    must end at the same folder (same device and inode), and the
 *    temporary file must still be the one that was written. Any mismatch
 *    removes the temporary file and fails the write. The rename puts a new
 *    file under the name and never opens the file that was there, so a
 *    multiply-linked file is replaced, not written through: its other names
 *    keep the old bytes.
 *
 * What this does not cover. Node has no `openat`/`renameat`, so the folder is
 * named by its path each time. A process running as the same user that renames
 * folders inside the records folder in the instant between the last check and
 * the rename (or between the check and the open) can still redirect that one
 * operation. That is outside the app's protection: the records folder should be
 * writable only by the user and the agents they run.
 */

/** Why a path was refused. */
export type ConfinementReason =
  | 'invalid-path'
  | 'no-root'
  | 'outside-root'
  | 'symlink'
  | 'not-regular-file'
  | 'multiply-linked'
  | 'not-directory'
  | 'too-large'
  | 'moved'

export class ConfinementError extends Error {
  readonly code = 'ECONFINED'

  constructor(
    readonly reason: ConfinementReason,
    detail: string
  ) {
    super(`Refused (${reason}): ${detail}`)
    this.name = 'ConfinementError'
  }
}

export function isConfinementError(error: unknown): error is ConfinementError {
  return error instanceof ConfinementError
}

/** Largest file a read returns unless the caller sets its own cap. */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

/**
 * Called between the check and the use. Tests use these to change the tree at
 * the one moment a race would; nothing in the app sets them.
 */
export interface ConfinedFsHooks {
  /** After the file is open and checked, before its bytes are read. */
  afterOpen?: () => void | Promise<void>
  /** After the bytes are written, before the file is put in place. */
  beforeCommit?: () => void | Promise<void>
}

export interface ReadConfinedOptions {
  /** A file larger than this is refused. Defaults to {@link DEFAULT_MAX_BYTES}. */
  maxBytes?: number
  /** Read only the first `head` bytes, whatever the file's size. */
  head?: number
  hooks?: ConfinedFsHooks
}

export interface WriteConfinedOptions {
  /** Create the file and fail with `EEXIST` when the name is taken; never replace. */
  exclusive?: boolean
  /** Create missing folders below the root on the way to the file. */
  makeDirs?: boolean
  hooks?: ConfinedFsHooks
}

// Absent on Windows, where the leaf is checked with lstat instead.
const NOFOLLOW = constants.O_NOFOLLOW ?? 0
// A FIFO planted at a record's name must not hang the open.
const NONBLOCK = constants.O_NONBLOCK ?? 0

interface VerifiedDir {
  root: string
  segments: readonly string[]
  path: string
  dev: number
  ino: number
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

function splitRelative(rel: string): string[] {
  if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\0') || path.isAbsolute(rel)) {
    throw new ConfinementError('invalid-path', 'a record path is plain names below the root')
  }
  const segments = rel.split(/[/\\]/)
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ConfinementError('invalid-path', 'a record path is plain names below the root')
  }
  return segments
}

async function canonicalRoot(root: string): Promise<string> {
  try {
    return await realpath(root)
  } catch {
    throw new ConfinementError('no-root', 'the records folder does not resolve')
  }
}

const LINKED_FOLDER = 'a folder on the way to the file is a link'

/**
 * Rule 2: every folder from the records folder down to this one is a real
 * folder. A folder that is not there fails with the system's own `ENOENT`.
 * The check is one `lstat` per folder, which matters to a scan that reads
 * thousands of files.
 */
async function verifyDir(root: string, segments: readonly string[]): Promise<VerifiedDir> {
  let current = path.resolve(root)
  // The records folder itself: followed if it is a link, but it must be a folder.
  let info = segments.length === 0 ? await stat(current) : undefined
  for (const segment of segments) {
    current = path.join(current, segment)
    info = await lstat(current)
    if (info.isSymbolicLink()) throw new ConfinementError('symlink', LINKED_FOLDER)
    if (!info.isDirectory()) throw new ConfinementError('not-directory', 'not a folder')
  }
  if (!info?.isDirectory()) throw new ConfinementError('not-directory', 'not a folder')
  return { root, segments, path: current, dev: info.dev, ino: info.ino }
}

/** Rule 4's second look: the way down still ends at the same folder. */
async function assertUnmoved(dir: VerifiedDir): Promise<void> {
  const moved = new ConfinementError('moved', 'the folder changed while the file was in use')
  const now = await verifyDir(dir.root, dir.segments).catch(() => {
    throw moved
  })
  if (now.dev !== dir.dev || now.ino !== dir.ino) throw moved
}

async function ensureDir(root: string, segments: readonly string[]): Promise<VerifiedDir> {
  let current = path.resolve(root)
  for (const segment of segments) {
    current = path.join(current, segment)
    try {
      await mkdir(current)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new ConfinementError('symlink', LINKED_FOLDER)
    if (!info.isDirectory()) throw new ConfinementError('not-directory', 'not a folder')
  }
  return verifyDir(root, segments)
}

/** Remove a file this module created, and only while the name still holds it. */
async function discardOwn(file: string, own: Pick<Stats, 'dev' | 'ino'>): Promise<void> {
  try {
    const now = await lstat(file)
    if (now.dev === own.dev && now.ino === own.ino) await unlink(file)
  } catch {
    // Already gone, or no longer ours to remove.
  }
}

function refuseLinkOpen(error: unknown): never {
  // O_NOFOLLOW on a symlink: ELOOP on macOS and Linux, EMLINK on some BSDs.
  const code = errorCode(error)
  if (code === 'ELOOP' || code === 'EMLINK') {
    throw new ConfinementError('symlink', 'the file is a link')
  }
  throw error
}

/**
 * Rule 3's last clause: a regular file reached by more than one name is
 * refused. `info` comes from the open descriptor, so it describes the file
 * that will be read or written.
 */
function refuseMultiplyLinked(info: Pick<Stats, 'nlink'>): void {
  if (info.nlink > 1) {
    throw new ConfinementError('multiply-linked', 'the file has more than one name (a hard link)')
  }
}

/**
 * The path of `absolute` below the records folder, as the plain names
 * {@link readConfined} and {@link writeConfinedAtomic} take. The path may be
 * spelled under the configured root or under its realpath.
 */
export async function recordRelative(root: string, absolute: string): Promise<string> {
  if (typeof absolute !== 'string' || !path.isAbsolute(absolute)) {
    throw new ConfinementError('invalid-path', 'expected an absolute record path')
  }
  const target = path.resolve(absolute)
  const named = path.resolve(root)
  if (target !== named && isInside(named, target)) return path.relative(named, target)
  const canonical = await canonicalRoot(root)
  if (target !== canonical && isInside(canonical, target)) return path.relative(canonical, target)
  throw new ConfinementError('outside-root', 'the path is not below the records folder')
}

export interface RecordTarget {
  root: string
  rel: string
}

/**
 * Where an absolute record path sits for the confined calls. With the records
 * folder given, the whole way down from it is checked. Without it, the file's
 * own folder stands in as the root: the file is still opened no-follow and its
 * folder is still checked again before a write lands, but nothing above that
 * folder is. Every call that starts in the renderer passes the records folder.
 */
export async function recordTarget(absolute: string, root?: string): Promise<RecordTarget> {
  if (root !== undefined) return { root, rel: await recordRelative(root, absolute) }
  if (typeof absolute !== 'string' || !path.isAbsolute(absolute)) {
    throw new ConfinementError('invalid-path', 'expected an absolute record path')
  }
  return { root: path.dirname(absolute), rel: path.basename(absolute) }
}

/**
 * Read one regular file below the records folder through its descriptor.
 * A missing file or folder fails with `ENOENT`; anything the rule refuses
 * throws a {@link ConfinementError}.
 */
export async function readConfined(
  root: string,
  rel: string,
  options: ReadConfinedOptions = {}
): Promise<Buffer> {
  const segments = splitRelative(rel)
  const leaf = segments.pop()!
  const dir = await verifyDir(root, segments)
  const file = path.join(dir.path, leaf)
  if (NOFOLLOW === 0 && (await lstat(file)).isSymbolicLink()) {
    throw new ConfinementError('symlink', 'the file is a link')
  }
  const handle = await open(file, constants.O_RDONLY | NOFOLLOW | NONBLOCK).catch(refuseLinkOpen)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new ConfinementError('not-regular-file', 'not a regular file')
    refuseMultiplyLinked(info)
    const cap = options.maxBytes ?? DEFAULT_MAX_BYTES
    if (options.head === undefined && info.size > cap) {
      throw new ConfinementError('too-large', `the file is larger than ${cap} bytes`)
    }
    await options.hooks?.afterOpen?.()
    await assertUnmoved(dir)
    const wanted = Math.min(info.size, options.head ?? cap)
    const buffer = Buffer.alloc(wanted)
    let filled = 0
    while (filled < wanted) {
      const { bytesRead } = await handle.read(buffer, filled, wanted - filled, filled)
      if (bytesRead === 0) break
      filled += bytesRead
    }
    return buffer.subarray(0, filled)
  } finally {
    await handle.close()
  }
}

/** {@link readConfined}, decoded as UTF-8. */
export async function readConfinedText(
  root: string,
  rel: string,
  options: ReadConfinedOptions = {}
): Promise<string> {
  return (await readConfined(root, rel, options)).toString('utf8')
}

/**
 * Write one file below the records folder: a temporary file created
 * exclusively beside the target, written through its descriptor, then renamed
 * into place once the folder has been checked again. With `exclusive`, the
 * target itself is created and an existing name fails with `EEXIST`. A failed
 * write removes its temporary file when that file is still where it was
 * written. Cleanup is best effort: when the folder was moved or swapped during
 * the write, the temporary file is no longer reachable by its name and stays
 * in the moved folder.
 */
export async function writeConfinedAtomic(
  root: string,
  rel: string,
  data: string | Buffer,
  options: WriteConfinedOptions = {}
): Promise<void> {
  const segments = splitRelative(rel)
  const leaf = segments.pop()!
  const dir = options.makeDirs ? await ensureDir(root, segments) : await verifyDir(root, segments)
  const target = path.join(dir.path, leaf)
  const createFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW

  if (!options.exclusive) {
    // A rename would replace a link rather than follow it, but a link where a
    // record should be is refused all the same; so is a folder or a device.
    const existing = await lstat(target).catch((error) => {
      if (errorCode(error) === 'ENOENT') return null
      throw error
    })
    if (existing?.isSymbolicLink()) throw new ConfinementError('symlink', 'the file is a link')
    if (existing && !existing.isFile()) {
      throw new ConfinementError('not-regular-file', 'not a regular file')
    }
  }

  const written = options.exclusive ? target : `${target}.tmp-${randomBytes(12).toString('hex')}`
  // EEXIST means the name was taken and nothing was written: not ours to remove.
  const handle = await open(written, createFlags, 0o666)
  let own: Stats
  try {
    own = await handle.stat()
    await handle.writeFile(data)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(written).catch(() => undefined)
    throw error
  }
  await handle.close()

  try {
    await options.hooks?.beforeCommit?.()
    await assertUnmoved(dir)
    const now = await lstat(written).catch(() => null)
    if (!now || now.dev !== own.dev || now.ino !== own.ino) {
      throw new ConfinementError('moved', 'the written file is no longer where it was written')
    }
    if (!options.exclusive) await rename(written, target)
  } catch (error) {
    await discardOwn(written, own)
    throw error
  }
}

/**
 * Write one file below the records folder in place: the file is created when
 * absent, otherwise the existing file is opened, emptied and written through
 * its descriptor. This is the only write that touches a file already there, so
 * it carries the whole of rule 3: no link is followed, the file must be a
 * regular file, and a file with more than one name is refused before a byte
 * of it changes. Use it only for a file the app owns and rewrites under one
 * name; record content goes through {@link writeConfinedAtomic}.
 */
export async function overwriteConfined(
  root: string,
  rel: string,
  data: string | Buffer
): Promise<void> {
  const segments = splitRelative(rel)
  const leaf = segments.pop()!
  const dir = await verifyDir(root, segments)
  const file = path.join(dir.path, leaf)
  if (NOFOLLOW === 0) {
    const existing = await lstat(file).catch(() => null)
    if (existing?.isSymbolicLink()) throw new ConfinementError('symlink', 'the file is a link')
  }
  // No O_TRUNC: the file is emptied only after the descriptor has been checked.
  const flags = constants.O_WRONLY | constants.O_CREAT | NOFOLLOW | NONBLOCK
  const handle = await open(file, flags, 0o666).catch(refuseLinkOpen)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new ConfinementError('not-regular-file', 'not a regular file')
    refuseMultiplyLinked(info)
    await assertUnmoved(dir)
    await handle.truncate(0)
    await handle.writeFile(data)
  } finally {
    await handle.close()
  }
}

/**
 * The entries of one folder below the records folder (`''` is not accepted:
 * the root itself is the caller's to list). The folder must pass rule 2.
 */
export async function listConfined(root: string, relDir: string): Promise<Dirent[]> {
  const dir = await verifyDir(root, splitRelative(relDir))
  return readdir(dir.path, { withFileTypes: true })
}

/** Create the folder at `relDir`, and any missing folder above it, below the root. */
export async function ensureConfinedDir(root: string, relDir: string): Promise<void> {
  await ensureDir(root, splitRelative(relDir))
}

/**
 * Give a regular file a new name in the same folder without replacing
 * anything: an existing `toName` fails with `EEXIST`.
 */
export async function renameConfinedExclusive(
  root: string,
  rel: string,
  toName: string
): Promise<void> {
  const segments = splitRelative(rel)
  const leaf = segments.pop()!
  if (splitRelative(toName).length !== 1) {
    throw new ConfinementError('invalid-path', 'the new name is one plain name')
  }
  const dir = await verifyDir(root, segments)
  const source = path.join(dir.path, leaf)
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new ConfinementError('symlink', 'the file is a link')
  if (!info.isFile()) throw new ConfinementError('not-regular-file', 'not a regular file')
  await assertUnmoved(dir)
  await link(source, path.join(dir.path, toName))
  await unlink(source)
}

/**
 * Remove the folder at `rel` and everything in it. The folder must be a real
 * folder passing rule 2; links found inside are removed, never followed.
 */
export async function removeConfinedTree(root: string, rel: string): Promise<void> {
  const segments = splitRelative(rel)
  const dir = await verifyDir(root, segments.slice(0, -1))
  const target = await verifyDir(root, segments)
  await assertUnmoved(dir)
  await rm(target.path, { recursive: true })
}
