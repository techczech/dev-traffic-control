import { readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { parseRequest } from './parseRequest'
import { parseEntry, isEntry } from './entry'
import { readReport, reportPathFor, runStatus } from './report'
import type {
  AgentWatchClaim,
  CollectionReceipt,
  NoteStatus,
  QaReport,
  QaRequest,
  RunStatus,
  ThreadEntry
} from './types'

export interface RunRef {
  request: QaRequest
  /** Request-file mtime as an ISO timestamp; `''` only when stat fails. */
  requestMtime?: string
  report: QaReport | null
  status: RunStatus
  project: string
  round: string | null
  // An agent wrote a `<basename>.resolved.md` marker — the request was actioned
  // in chat rather than the app. It drops out of the queue; delete the marker
  // to resurrect it. The app reads this marker but never writes it (agent-owned).
  resolvedAt?: string
  /** Invalid report JSON/shape is visible without entering unsafe renderer data. */
  reportError?: string
  /** Agent-owned collection signals; malformed files are treated as absent. */
  watch?: AgentWatchClaim
  collection?: CollectionReceipt
}
export interface NoteRef {
  path: string
  title: string
  status: NoteStatus
  project: string
  round: string | null
}

// Folders scanned for entries but excluded from the project list (ADR-0009):
// unfiled capture has no project.
const RESERVED = new Set(['_unfiled'])
const RESERVED_PROJECT_FOLDERS = new Set(['threads', 'releases', 'handoffs', 'roadmap'])
const SKIP_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md'])
const RESERVED_ARTIFACT_SUFFIXES = [
  '.report.json',
  '.state.json',
  '.watch.json',
  '.collected.json',
  '.opened.json'
]
/**
 * A note is a file the app named `YYYY-MM-DD-note-<slug>.md` (createNote).
 * Matching `-note-` anywhere made a request titled "new-note-…" a note, which
 * opened it in the note editor with autosave (28 Sep 2026).
 */
export const isNoteFileName = (name: string): boolean =>
  /^\d{4}-\d{2}-\d{2}-note-.+\.md$/.test(name) && !name.endsWith('.resolved.md')
const isNote = isNoteFileName
const isRequest = (name: string): boolean =>
  name.endsWith('.md') &&
  !RESERVED_ARTIFACT_SUFFIXES.some((suffix) => name.endsWith(suffix)) &&
  !SKIP_FILES.has(name) &&
  !isNote(name)

/**
 * Whether the scanner reads runs and notes from the project subfolder
 * `folder`: a round folder, or the threads folder. Screenshot folders, dot
 * folders and the other reserved folders (releases, handoffs, roadmap) are
 * never read as records. Writers that must land where the scanner looks (new
 * notes) use the same rule.
 */
export function scannerReadsFolder(folder: string): boolean {
  if (folder.startsWith('.') || folder.endsWith('.shots')) return false
  return folder === 'threads' || !RESERVED_PROJECT_FOLDERS.has(folder)
}

export interface ScanResult {
  runs: RunRef[]
  notes: NoteRef[]
  entries: ThreadEntry[]
  projects: string[]
}

export async function scanQaRepo(
  root: string,
  readText: (file: string, encoding: BufferEncoding) => Promise<string> = readFile
): Promise<ScanResult> {
  const runs: RunRef[] = []
  const notes: NoteRef[] = []
  const entries: ThreadEntry[] = []
  const projects: string[] = []

  for (const proj of await lsDirs(root)) {
    if (!RESERVED.has(proj.name)) projects.push(proj.name)
    await collect(path.join(root, proj.name), proj.name, null, runs, notes, entries, readText)
    for (const round of await lsDirs(path.join(root, proj.name))) {
      if (!scannerReadsFolder(round.name)) continue
      await collect(
        path.join(root, proj.name, round.name),
        proj.name,
        // The threads folder holds project-level entries, not a round.
        round.name === 'threads' ? null : round.name,
        runs,
        notes,
        entries,
        readText
      )
    }
  }
  return { runs, notes, entries, projects }
}

async function lsDirs(p: string): Promise<Dirent[]> {
  try {
    return (await readdir(p, { withFileTypes: true })).filter(
      (e) => e.isDirectory() && !e.name.startsWith('.')
    )
  } catch {
    return []
  }
}

async function collect(
  dir: string,
  project: string,
  round: string | null,
  runs: RunRef[],
  notes: NoteRef[],
  entries: ThreadEntry[],
  readText: (file: string, encoding: BufferEncoding) => Promise<string>
): Promise<void> {
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  const names = new Set(dirents.filter((e) => e.isFile()).map((e) => e.name))
  for (const e of dirents) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    if (SKIP_FILES.has(e.name)) continue
    // Resolution markers (<basename>.resolved.md) are agent-written closures,
    // surfaced only as an attribute of their request — never runs/notes/entries.
    if (e.name.endsWith('.resolved.md')) continue
    const full = path.join(dir, e.name)
    try {
      // Classification order (ADR-0009): note → entry → request. Each file is
      // read at most once; a thread entry is never a run and never a note.
      if (isNote(e.name)) {
        notes.push({ path: full, project, round, ...(await noteMeta(full, e.name)) })
        continue
      }
      const raw = await readText(full, 'utf8')
      if (isEntry(e.name, raw)) {
        entries.push(parseEntry(raw, full, await mtimeIso(full)))
      } else if (isRequest(e.name)) {
        const request = parseRequest(raw, full)
        let report: QaReport | null = null
        let reportError: string | undefined
        try {
          report = await readReport(reportPathFor(full))
        } catch (error) {
          reportError = error instanceof Error ? error.message : 'Invalid report'
        }
        const markerName = e.name.replace(/\.md$/, '.resolved.md')
        const resolvedAt = names.has(markerName)
          ? await resolvedStamp(path.join(dir, markerName))
          : undefined
        runs.push({
          request,
          requestMtime: await mtimeIso(full),
          report,
          status: runStatus(report),
          project,
          round,
          resolvedAt,
          watch: await readSignal(full, '.watch.json', isWatchClaim),
          collection: await readSignal(full, '.collected.json', isCollectionReceipt),
          ...(reportError ? { reportError } : {})
        })
      }
    } catch (error) {
      // Agents create, rename and remove records while a scan is in flight.
      // One vanished or temporarily unreadable file must not discard every
      // successfully collected row.
      console.warn(
        `Skipping record that changed during scan: ${full}`,
        error instanceof Error ? error.message : error
      )
    }
  }
}

type SignalShape<T> = (value: unknown) => value is T

async function readSignal<T>(
  requestPath: string,
  suffix: '.watch.json' | '.collected.json',
  valid: SignalShape<T>
): Promise<T | undefined> {
  const signalPath = requestPath.replace(/\.md$/, suffix)
  try {
    const parsed: unknown = JSON.parse(await readFile(signalPath, 'utf8'))
    return valid(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return isString(value) && !Number.isNaN(Date.parse(value))
}

function isWatchClaim(value: unknown): value is AgentWatchClaim {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    isString(record.agent) &&
    isString(record.machine) &&
    isTimestamp(record.startedAt) &&
    isTimestamp(record.heartbeatAt)
  )
}

function isCollectionReceipt(value: unknown): value is CollectionReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    isString(record.agent) &&
    isString(record.machine) &&
    isTimestamp(record.collectedAt) &&
    (record.note === undefined ||
      (isString(record.note) && !record.note.includes('\n') && !record.note.includes('\r')))
  )
}

async function mtimeIso(full: string): Promise<string> {
  try {
    return (await stat(full)).mtime.toISOString()
  } catch {
    return ''
  }
}

/** The resolution stamp: the marker's frontmatter `at:`, else its mtime. */
async function resolvedStamp(full: string): Promise<string> {
  try {
    const raw = await readFile(full, 'utf8')
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (fm) {
      const at = (parseYaml(fm[1]) as Record<string, unknown> | null)?.at
      if (typeof at === 'string' && at.trim()) return at.trim()
    }
    return (await stat(full)).mtime.toISOString()
  } catch {
    return ''
  }
}

async function noteMeta(
  full: string,
  name: string
): Promise<{ title: string; status: NoteStatus }> {
  try {
    const raw = await readFile(full, 'utf8')
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    const meta = (fm ? (parseYaml(fm[1]) ?? {}) : {}) as Record<string, unknown>
    return {
      title: noteTitle(meta.title, fm ? raw.slice(fm[0].length) : raw, name),
      status: meta.handedOverAt ? 'handed-over' : 'draft'
    }
  } catch {
    return { title: noteTitle(undefined, '', name), status: 'draft' }
  }
}

/**
 * What a note is called in a list. The note editor writes `title: ""` for a
 * note he never named — most of his notes — so an empty title is common, and a
 * row that reads it verbatim is a blank row. In order: the title, the first
 * non-empty line of the body (a heading's `#` marks dropped), the file name.
 */
export function noteTitle(title: unknown, body: string, name: string): string {
  const named = typeof title === 'string' || typeof title === 'number' ? String(title).trim() : ''
  if (named) return named
  for (const line of body.split(/\r?\n/)) {
    const text = line.replace(/^\s*#+\s*/, '').trim()
    if (text) return text
  }
  return name.replace(/\.md$/, '')
}
