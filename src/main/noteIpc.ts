import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { addNoteShot, createNote, handOverNote, openNote, reopenNote, saveNote } from './noteIo'
import {
  canonicalRecordRoot,
  confinedSegments,
  isInside,
  realpathBelow,
  shotsFolderIsConfined
} from './confinement'
import { readShotDataUrl } from './runnerIo'
import { isNoteFileName, scannerReadsFolder } from './qa/scan'
import { shotsDirFor } from './qa/shots'
import type { NoteDoc, QaSnapshot } from '../shared/ipc'

export interface NoteHandlerDeps {
  recordRoot: () => string
  snapshot: () => Pick<QaSnapshot, 'notes'> | null
  now: () => string
}

export interface NoteHandlers {
  create: (dir: unknown, title: unknown) => Promise<NoteDoc | null>
  open: (notePath: unknown) => Promise<NoteDoc | null>
  save: (doc: unknown) => Promise<{ savedAt: string } | null>
  handOver: (notePath: unknown) => Promise<NoteDoc | null>
  reopen: (notePath: unknown) => Promise<NoteDoc | null>
  addShot: (notePath: unknown, pngBase64: unknown) => Promise<string | null>
  readShot: (notePath: unknown, relPath: unknown) => Promise<string | null>
}

/**
 * Where a note may be created: a project folder (`<root>/<project>`) or a
 * folder the scanner reads below it (`<root>/<project>/<round>`, by the
 * scanner's own rule), existing and reached through no symlink.
 */
async function confineNoteDir(recordRoot: string, dir: unknown): Promise<string | null> {
  if (typeof dir !== 'string') return null
  const segments = await confinedSegments(recordRoot, dir)
  if (!segments || segments.length < 1 || segments.length > 2) return null
  if (segments.length === 2 && !scannerReadsFolder(segments[1])) return null
  try {
    if (!(await stat(dir)).isDirectory()) return null
  } catch {
    return null
  }
  return dir
}

/**
 * A note file in a note location: an existing regular file named
 * `YYYY-MM-DD-note-<slug>.md` ({@link isNoteFileName}), in a folder {@link confineNoteDir} would accept.
 */
async function confineNoteFile(recordRoot: string, notePath: unknown): Promise<string | null> {
  if (typeof notePath !== 'string') return null
  const name = path.basename(notePath)
  if (!isNoteFileName(name)) return null
  try {
    if (!(await lstat(notePath)).isFile()) return null
  } catch {
    return null
  }
  const segments = await confinedSegments(recordRoot, notePath)
  if (!segments || segments.length < 2 || segments.length > 3) return null
  if (segments.length === 3 && !scannerReadsFolder(segments[1])) return null
  return notePath
}

/**
 * The main-process boundary for note IO the renderer asks for.
 *
 * Reads (`open`) accept a note file in a note location inside the record root,
 * so a note search found opens before the next scan lists it. Writes (`save`,
 * `handOver`, `reopen`, `addShot`) also require the path to be in main's own
 * record of notes — the current snapshot's notes, plus every note main created
 * this session; opening a note grants no write. `save` writes to that recorded
 * path, never to the renderer's `doc.path` alone. A refused call returns
 * `null` and reads and writes nothing.
 */
export function createNoteHandlers(deps: NoteHandlerDeps): NoteHandlers {
  const created = new Set<string>()

  const inRecord = (notePath: string): boolean =>
    created.has(notePath) ||
    (deps.snapshot()?.notes.some((note) => note.path === notePath) ?? false)

  const confineForWrite = async (notePath: unknown): Promise<string | null> => {
    const confined = await confineNoteFile(deps.recordRoot(), notePath)
    return confined && inRecord(confined) ? confined : null
  }

  return {
    async create(dir, title) {
      const confinedDir = await confineNoteDir(deps.recordRoot(), dir)
      if (!confinedDir || typeof title !== 'string') return null
      const doc = await createNote(confinedDir, title, deps.now, deps.recordRoot())
      created.add(doc.path)
      return doc
    },
    async open(notePath) {
      const confined = await confineNoteFile(deps.recordRoot(), notePath)
      if (!confined) return null
      return openNote(confined, deps.recordRoot())
    },
    async save(doc) {
      if (typeof doc !== 'object' || doc === null) return null
      const candidate = doc as Partial<NoteDoc>
      const target = await confineForWrite(candidate.path)
      if (!target) return null
      return saveNote(
        {
          path: target,
          title: typeof candidate.title === 'string' ? candidate.title : '',
          body: typeof candidate.body === 'string' ? candidate.body : '',
          linkedRun: typeof candidate.linkedRun === 'string' ? candidate.linkedRun : undefined,
          handedOverAt:
            typeof candidate.handedOverAt === 'string' ? candidate.handedOverAt : undefined,
          shots: Array.isArray(candidate.shots)
            ? candidate.shots.filter((shot): shot is string => typeof shot === 'string')
            : []
        },
        deps.recordRoot()
      )
    },
    async handOver(notePath) {
      const target = await confineForWrite(notePath)
      return target ? handOverNote(target, deps.now, deps.recordRoot()) : null
    },
    async reopen(notePath) {
      const target = await confineForWrite(notePath)
      return target ? reopenNote(target, deps.recordRoot()) : null
    },
    async readShot(notePath, relPath) {
      // A read, so like `open` it needs only a note file in a note location.
      const target = await confineNoteFile(deps.recordRoot(), notePath)
      if (!target || typeof relPath !== 'string') return null
      const canonicalRoot = await canonicalRecordRoot(deps.recordRoot())
      if (!canonicalRoot) return null
      // The shot must resolve inside the note's own `<note>.shots` folder,
      // which itself must be inside the record root.
      const shotsDir = shotsDirFor(target.replace(/\.md$/, ''))
      const realShotsDir = await realpathBelow(canonicalRoot, shotsDir)
      if (!realShotsDir) return null
      let realShot: string
      try {
        realShot = await realpath(path.resolve(path.dirname(target), relPath))
      } catch {
        return null
      }
      if (realShot === realShotsDir || !isInside(realShotsDir, realShot)) return null
      return readShotDataUrl(target, relPath, deps.recordRoot())
    },
    async addShot(notePath, pngBase64) {
      const target = await confineForWrite(notePath)
      if (!target || typeof pngBase64 !== 'string') return null
      const shotsDir = shotsDirFor(target.replace(/\.md$/, ''))
      if (!(await shotsFolderIsConfined(deps.recordRoot(), shotsDir))) return null
      return addNoteShot(target, Buffer.from(pngBase64, 'base64'), deps.recordRoot())
    }
  }
}
