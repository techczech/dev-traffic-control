import path from 'node:path'
import {
  listConfined,
  readConfinedText,
  recordRelative,
  recordTarget,
  writeConfinedAtomic
} from './confinedFs'
import { notePathFor, parseNote, serialiseNote } from './qa/note'
import type { NoteContent } from './qa/note'
import { readReport, reportPathFor, writeReport } from './qa/report'
import { nextShotPath, saveShot, shotsDirFor } from './qa/shots'
import { slugify, uniqueId } from './qa/slug'
import { queueReportWrite } from './runnerIo'
import type { NoteDoc } from '../shared/ipc'

/**
 * Pure-ish IO over the note/shots/slug contract — no Electron imports and no
 * new file formats. Timestamps are injected as `now` so the wiring (index.ts) is
 * the only place that reads the wall clock. Notes are created lazily: the caller
 * (the editor) only invokes {@link createNote} once there is content to save.
 *
 * Every function takes the records folder as its last argument, `recordRoot`,
 * and reads and writes only through the confined file calls (confinedFs). The
 * note handlers always pass it; see `recordTarget` for what is checked when it
 * is left out.
 */

async function readNoteText(p: string, recordRoot?: string): Promise<string> {
  const target = await recordTarget(p, recordRoot)
  return readConfinedText(target.root, target.rel)
}

async function writeNoteText(p: string, text: string, recordRoot?: string): Promise<void> {
  const target = await recordTarget(p, recordRoot)
  await writeConfinedAtomic(target.root, target.rel, text)
}

/** The names in a folder, or none when it is not there yet. */
async function namesIn(dir: string, recordRoot?: string): Promise<string[]> {
  const root = recordRoot ?? path.dirname(dir)
  try {
    return (await listConfined(root, await recordRelative(root, dir))).map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function docOf(p: string, n: NoteContent): NoteDoc {
  return {
    path: p,
    title: n.title,
    body: n.body,
    linkedRun: n.linkedRun,
    handedOverAt: n.handedOverAt,
    shots: n.shots
  }
}

/** Write a fresh note. Slug derives from the title once, unique against same-day siblings. */
export async function createNote(
  dir: string,
  title: string,
  now: () => string,
  recordRoot?: string
): Promise<NoteDoc> {
  const date = now().slice(0, 10) // YYYY-MM-DD
  const taken = new Set<string>()
  // The project folder may not have been read before — no siblings then.
  for (const name of await namesIn(dir, recordRoot)) {
    const m = name.match(new RegExp(`^${date}-note-(.+)\\.md$`))
    if (m) taken.add(m[1])
  }
  const slug = uniqueId(slugify(title), taken)
  const p = notePathFor(dir, date, slug)
  const content: NoteContent = { title, body: '', shots: [] }
  await writeNoteText(p, serialiseNote(content), recordRoot)
  return docOf(p, content)
}

export async function openNote(p: string, recordRoot?: string): Promise<NoteDoc> {
  return docOf(p, parseNote(await readNoteText(p, recordRoot)))
}

/** Atomic; the doc carries its own handedOverAt, so a draft save never drops the stamp. */
export async function saveNote(doc: NoteDoc, recordRoot?: string): Promise<{ savedAt: string }> {
  const content: NoteContent = {
    title: doc.title,
    body: doc.body,
    linkedRun: doc.linkedRun,
    handedOverAt: doc.handedOverAt,
    shots: doc.shots
  }
  await writeNoteText(doc.path, serialiseNote(content), recordRoot)
  return { savedAt: new Date().toISOString() }
}

/** Hand over: MAIN stamps handedOverAt (mirror of Finish run). */
export async function handOverNote(
  p: string,
  now: () => string,
  recordRoot?: string
): Promise<NoteDoc> {
  const n = parseNote(await readNoteText(p, recordRoot))
  const stamped: NoteContent = { ...n, handedOverAt: now() }
  await writeNoteText(p, serialiseNote(stamped), recordRoot)
  return docOf(p, stamped)
}

/** Reopen: clear the stamp (mirror of Reopen run). */
export async function reopenNote(p: string, recordRoot?: string): Promise<NoteDoc> {
  const n = parseNote(await readNoteText(p, recordRoot))
  const cleared: NoteContent = {
    title: n.title,
    body: n.body,
    linkedRun: n.linkedRun,
    shots: n.shots
  }
  await writeNoteText(p, serialiseNote(cleared), recordRoot)
  return docOf(p, cleared)
}

/** PNGs into `<basename>.shots/` named note-1.png, note-2.png…; returns a note-folder-relative path. */
export async function addNoteShot(
  notePath: string,
  png: Buffer,
  recordRoot?: string
): Promise<string> {
  const dir = shotsDirFor(notePath.replace(/\.md$/, ''))
  // The first shot creates the folder.
  const existing = await namesIn(dir, recordRoot)
  const abs = await saveShot(nextShotPath(dir, 'note', existing), png, recordRoot)
  return path.relative(path.dirname(notePath), abs) // e.g. "x.shots/note-1.png"
}

/**
 * Cross-link a note into a run's report `noteFiles` (idempotent). Honours the
 * empty-over-nonempty guard via writeReport, and never resurrects a report that
 * does not exist on disk (no report → nothing to link).
 */
export async function linkNoteToReport(
  requestPath: string,
  noteBasename: string,
  recordRoot?: string
): Promise<void> {
  const p = reportPathFor(requestPath)
  await queueReportWrite(p, async () => {
    const report = await readReport(p, recordRoot)
    if (!report) return // no report yet → never write one from here
    if (report.noteFiles.includes(noteBasename)) return
    await writeReport(p, { ...report, noteFiles: [...report.noteFiles, noteBasename] }, recordRoot)
  })
}
