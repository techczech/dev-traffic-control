import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from './qa/atomicWrite'
import { notePathFor, parseNote, serialiseNote } from './qa/note'
import type { NoteContent } from './qa/note'
import { readReport, reportPathFor, writeReport } from './qa/report'
import { nextShotPath, saveShot, shotsDirFor } from './qa/shots'
import { slugify, uniqueId } from './qa/slug'
import { queueReportWrite } from './runnerIo'
import type { NoteDoc } from '../shared/ipc'

/**
 * Pure-ish IO over the M1 note/shots/slug contract — no Electron imports and no
 * new file formats. Timestamps are injected as `now` so the wiring (index.ts) is
 * the only place that reads the wall clock. Notes are created lazily: the caller
 * (the editor) only invokes {@link createNote} once there is content to save.
 */

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
export async function createNote(dir: string, title: string, now: () => string): Promise<NoteDoc> {
  const date = now().slice(0, 10) // YYYY-MM-DD
  const taken = new Set<string>()
  try {
    for (const name of await readdir(dir)) {
      const m = name.match(new RegExp(`^${date}-note-(.+)\\.md$`))
      if (m) taken.add(m[1])
    }
  } catch {
    /* the project folder may not have been read before — no siblings then */
  }
  const slug = uniqueId(slugify(title), taken)
  const p = notePathFor(dir, date, slug)
  const content: NoteContent = { title, body: '', shots: [] }
  await atomicWrite(p, serialiseNote(content))
  return docOf(p, content)
}

export async function openNote(p: string): Promise<NoteDoc> {
  return docOf(p, parseNote(await readFile(p, 'utf8')))
}

/** Atomic; the doc carries its own handedOverAt, so a draft save never drops the stamp. */
export async function saveNote(doc: NoteDoc): Promise<{ savedAt: string }> {
  const content: NoteContent = {
    title: doc.title,
    body: doc.body,
    linkedRun: doc.linkedRun,
    handedOverAt: doc.handedOverAt,
    shots: doc.shots
  }
  await atomicWrite(doc.path, serialiseNote(content))
  return { savedAt: new Date().toISOString() }
}

/** Hand over: MAIN stamps handedOverAt (mirror of Finish run). */
export async function handOverNote(p: string, now: () => string): Promise<NoteDoc> {
  const n = parseNote(await readFile(p, 'utf8'))
  const stamped: NoteContent = { ...n, handedOverAt: now() }
  await atomicWrite(p, serialiseNote(stamped))
  return docOf(p, stamped)
}

/** Reopen: clear the stamp (mirror of Reopen run). */
export async function reopenNote(p: string): Promise<NoteDoc> {
  const n = parseNote(await readFile(p, 'utf8'))
  const cleared: NoteContent = {
    title: n.title,
    body: n.body,
    linkedRun: n.linkedRun,
    shots: n.shots
  }
  await atomicWrite(p, serialiseNote(cleared))
  return docOf(p, cleared)
}

/** PNGs into `<basename>.shots/` named note-1.png, note-2.png…; returns a note-folder-relative path. */
export async function addNoteShot(notePath: string, png: Buffer): Promise<string> {
  const dir = shotsDirFor(notePath.replace(/\.md$/, ''))
  let existing: string[] = []
  try {
    existing = await readdir(dir)
  } catch {
    /* first shot creates the dir */
  }
  const abs = await saveShot(nextShotPath(dir, 'note', existing), png)
  return path.relative(path.dirname(notePath), abs) // e.g. "x.shots/note-1.png"
}

/**
 * Cross-link a note into a run's report `noteFiles` (idempotent). Honours the
 * empty-over-nonempty guard via writeReport, and never resurrects a report that
 * does not exist on disk (no report → nothing to link).
 */
export async function linkNoteToReport(requestPath: string, noteBasename: string): Promise<void> {
  const p = reportPathFor(requestPath)
  await queueReportWrite(p, async () => {
    const report = await readReport(p)
    if (!report) return // no report yet → never write one from here
    if (report.noteFiles.includes(noteBasename)) return
    await writeReport(p, { ...report, noteFiles: [...report.noteFiles, noteBasename] })
  })
}
