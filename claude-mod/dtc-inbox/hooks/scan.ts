import { isSafeSegment } from './guard'
import { RESERVED_DIRS, baseOf, classifyRequestPath, trimSlashes } from './paths'
import { MAX_IDEA_BYTES, MAX_VERDICTS_BYTES, asIdeaSummary, asVerdictSummary, ideaReply, releaseVerdicts, summariseIdea, summariseVerdicts } from './records'
import type { IdeaSummary, VerdictSummary } from './records'
import { MAX_MARKER_BYTES, MAX_REPORT_BYTES, MAX_REQUEST_BYTES, SKEW_MS, emptyVerdicts, hasReportShape, isFinal, isValidCompletion, isoTime, parseJson, requestTitle, stateOf, summarise } from './reports'
import { cleanLine, isPlainName } from './sanitise'
import type { ReportKnown, ReportState, ReportSummary } from './reports'

/** A release verdict is shown once no newer one has followed it for this long, so a run of verdicts arrives together. */
export const SETTLE_MS = 60_000
/** Release verdicts older than this are not listed: an answers file has no receipt, so age closes it. */
export const VERDICT_WINDOW_MS = 14 * 86_400_000

/** The most files one scan reads. Each read starts a helper process, so a scan that would need more reads the rest on later scans and says how many it put off. */
export const MAX_READS_PER_SCAN = 200

export type DirEntry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number; /** Bytes, for a file; absent when the listing gives none. */ size?: number }

export type ScanIo = {
  /** Entries of a directory; null when it cannot be listed. */
  list: (path: string) => Promise<DirEntry[] | null>
  /** Text of a regular file (never through a symbolic link); null when missing, unreadable or larger than `maxBytes`. */
  read: (path: string, maxBytes?: number) => Promise<string | null>
}

export type ScanEntry = {
  project: string
  /** Record path within the project, `.md`: the request, `roadmap/<id>.md` or `releases/<version>.md`. */
  rel: string
  /** Absent for a request. `idea`: a reviewer entry on a roadmap idea that no agent entry follows. `release`: release verdicts. */
  kind?: 'idea' | 'release'
  /**
   * `malformed` is an answer file that could not be read: a symbolic link or other non-regular
   * file, one over the size cap, or one that does not parse to the expected shape. It is listed as
   * "could not read" and never counted or collected.
   */
  state: ReportState
  /** From the report, the idea or the release; `''` when it has none. */
  title: string
  /**
   * Names the answer: a report's `completedAt`; for an idea the
   * reviewer entry's stamp; for a release the newest verdict's `at`. Null when there is no answer.
   */
  completedAt: string | null
  /** `idea` and `release`: when the answer was given, epoch ms (the idea file's mtime; the newest verdict's `at`). */
  atMs?: number
  /** `idea` and `release`: the answer in a few words, for a list row. */
  answer?: string
  counts: ReportSummary['counts']
  decisions: ReportSummary['decisions']
  /** Title from the request's frontmatter or first heading; read only when the report gives none. */
  requestTitle?: string
  /** When an unfinished request was opened (`.opened.json` openedAt, else file mtime), epoch ms; 0 when unknown. */
  sinceMs?: number
  /** A `.watch.json` next to the request: who claims to wait and the last heartbeat. */
  watch?: { agent: string; machine: string; heartbeatMs: number }
}

/** What a scan keeps of the small files beside a request: the request's own title, when it was opened, who is watching it. */
export type Marker =
  | { k: 'title'; title: string }
  | { k: 'opened'; /** `openedAt`, epoch ms; null when the file gives none. */ at: number | null }
  | { k: 'watch'; watch: { agent: string; machine: string; heartbeatMs: number } | null }

/**
 * Per file read (report, idea, release answers, request title, opened and watch markers): what the
 * file parsed to, for the size and mtime it was listed with. A file whose listed size and mtime
 * are unchanged is not read again. `s: null` = malformed, or nothing waiting.
 */
export type ScanCache = Record<string, { mtimeMs: number; size?: number; s: ReportSummary | IdeaSummary | VerdictSummary | Marker | null }>

/** When the answer was given, epoch ms; 0 when unknown. */
export function whenMs(e: Pick<ScanEntry, 'kind' | 'completedAt' | 'atMs'>): number {
  if (e.kind !== undefined) return e.atMs ?? 0
  const t = e.completedAt === null ? Number.NaN : Date.parse(e.completedAt)
  return Number.isNaN(t) ? 0 : t
}

/** One scan's reads: the cache it started with, the cache it leaves, and how many reads it may still make. */
type Ctx = { io: ScanIo; cache: ScanCache; next: ScanCache; budget: { left: number; skipped: number } }

/** `value`: read (now or on an earlier scan) and parsed. `unreadable`: the file could not be read at all (not regular, over the cap, gone). `later`: this scan has made all the reads it may; the file is read on a later one. */
type Got<T> = { got: 'value'; s: T | null } | { got: 'unreadable' } | { got: 'later' }

/**
 * One file, read at most once per scan and not at all when the cache holds it for the same size
 * and mtime. A fresh read counts against the scan's budget; with none left the file is put off
 * and counted. A file that could not be read is not cached.
 */
async function readOnce<T>(ctx: Ctx, path: string, file: Pick<DirEntry, 'mtimeMs' | 'size'> | undefined, maxBytes: number, held: (v: unknown) => T | null, parse: (text: string) => T | null): Promise<Got<T>> {
  const mtimeMs = file?.mtimeMs ?? 0
  const size = file?.size
  const prior = ctx.cache[path]
  if (prior !== undefined && prior.mtimeMs === mtimeMs && prior.size === size && (prior.s === null || held(prior.s) !== null)) {
    // Carried into the next cache, so an unchanged file is read once, not every other scan.
    ctx.next[path] = prior
    return { got: 'value', s: prior.s === null ? null : held(prior.s) }
  }
  const done = ctx.next[path]
  if (done !== undefined && done.mtimeMs === mtimeMs && done.size === size && (done.s === null || held(done.s) !== null)) return { got: 'value', s: done.s === null ? null : held(done.s) }
  if (ctx.budget.left <= 0) {
    ctx.budget.skipped++
    return { got: 'later' }
  }
  ctx.budget.left--
  const text = await ctx.io.read(path, maxBytes)
  if (text === null) return { got: 'unreadable' }
  const s = parse(text)
  ctx.next[path] = { mtimeMs, ...(size === undefined ? {} : { size }), s: s as ScanCache[string]['s'] }
  return { got: 'value', s }
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
/** A cached value read back as a report summary: anything a report parse left, which carries no `k`. */
const asReportSummary = (v: unknown): ReportSummary | null => (isObj(v) && !('k' in v) ? (v as ReportSummary) : null)
const asTitle = (v: unknown): Extract<Marker, { k: 'title' }> | null => (isObj(v) && v.k === 'title' && typeof v.title === 'string' ? { k: 'title', title: v.title } : null)
const asOpened = (v: unknown): Extract<Marker, { k: 'opened' }> | null => (isObj(v) && v.k === 'opened' && (v.at === null || (typeof v.at === 'number' && Number.isFinite(v.at))) ? { k: 'opened', at: v.at } : null)
const asWatch = (v: unknown): Extract<Marker, { k: 'watch' }> | null => {
  if (!isObj(v) || v.k !== 'watch') return null
  const w = v.watch
  if (w === null) return { k: 'watch', watch: null }
  if (!isObj(w) || typeof w.agent !== 'string' || typeof w.machine !== 'string' || typeof w.heartbeatMs !== 'number' || !Number.isFinite(w.heartbeatMs)) return null
  return { k: 'watch', watch: { agent: w.agent, machine: w.machine, heartbeatMs: w.heartbeatMs } }
}

/** A row for an answer file that could not be read. */
const unreadable = (project: string, rel: string, kind: 'idea' | 'release' | undefined, title: string): ScanEntry => ({
  project,
  rel,
  ...(kind === undefined ? {} : { kind }),
  state: 'malformed',
  title,
  completedAt: null,
  counts: emptyVerdicts(),
  decisions: { answered: 0, total: 0 },
})

/**
 * `<project>/roadmap/<id>.md` files whose last entry is the reviewer's. `order.md` and anything not
 * safely named are skipped; an idea file that is not a regular file, or cannot be read, is listed
 * as "could not read".
 */
async function scanIdeas(ctx: Ctx, folder: string, project: string, out: ScanEntry[], now: number | undefined): Promise<void> {
  const entries = await ctx.io.list(folder)
  if (entries === null) return
  for (const e of entries) {
    if (e.kind === 'dir' || !e.name.endsWith('.md') || e.name === 'order.md' || !isSafeSegment(e.name)) continue
    const got: Got<IdeaSummary> = e.kind !== 'file' ? { got: 'unreadable' } : await readOnce(ctx, `${folder}/${e.name}`, e, MAX_IDEA_BYTES, asIdeaSummary, text => {
      const reply = ideaReply(text)
      return reply === null ? null : summariseIdea(reply)
    })
    // Not read yet: not listed until it is.
    if (got.got === 'later') continue
    if (got.got === 'unreadable') {
      out.push(unreadable(project, `roadmap/${e.name}`, 'idea', e.name.replace(/\.md$/, '')))
      continue
    }
    const s = got.s
    if (s === null) continue
    // A file stamped in the future (beyond the skew) is not shown yet.
    if (now !== undefined && e.mtimeMs > now + SKEW_MS) continue
    out.push({
      project,
      rel: `roadmap/${e.name}`,
      kind: 'idea',
      state: 'waiting',
      title: s.title === '' ? e.name.replace(/\.md$/, '') : s.title,
      completedAt: s.stamp,
      atMs: e.mtimeMs,
      answer: s.answer,
      counts: emptyVerdicts(),
      decisions: { answered: 0, total: 0 },
    })
  }
}

/**
 * `<project>/releases/<version>.answers.json` files carrying at least one timed verdict. With
 * `now`, a set whose newest verdict is in the future, younger than `SETTLE_MS` or older than
 * `VERDICT_WINDOW_MS` is not listed. An answers file that is not a regular file, is over the cap or
 * does not parse to the expected shape is listed as "could not read".
 */
async function scanReleases(ctx: Ctx, folder: string, project: string, out: ScanEntry[], now: number | undefined): Promise<void> {
  const entries = await ctx.io.list(folder)
  if (entries === null) return
  const SUFFIX = '.answers.json'
  for (const e of entries) {
    if (e.kind === 'dir' || !e.name.endsWith(SUFFIX)) continue
    const version = e.name.slice(0, -SUFFIX.length)
    if (!isSafeSegment(`${version}.md`)) continue
    const got: Got<VerdictSummary> = e.kind !== 'file' ? { got: 'unreadable' } : await readOnce(ctx, `${folder}/${e.name}`, e, MAX_VERDICTS_BYTES, asVerdictSummary, text => {
      const verdicts = releaseVerdicts(text)
      return verdicts === null ? null : summariseVerdicts(verdicts)
    })
    // Not read yet: not listed until it is.
    if (got.got === 'later') continue
    const s = got.got === 'value' ? got.s : null
    if (s === null) {
      out.push(unreadable(project, `releases/${version}.md`, 'release', `${project} ${version} — release verdicts`))
      continue
    }
    if (s.stamp === null || isoTime(s.stamp) !== s.atMs) continue
    if (now !== undefined && (s.atMs > now + SKEW_MS || now - s.atMs < SETTLE_MS || now - s.atMs > VERDICT_WINDOW_MS)) continue
    out.push({
      project,
      rel: `releases/${version}.md`,
      kind: 'release',
      state: 'waiting',
      title: `${s.app === '' ? project : s.app} ${s.release === '' ? version : s.release} — release verdicts`,
      completedAt: s.stamp,
      atMs: s.atMs,
      answer: s.answer,
      counts: emptyVerdicts(),
      decisions: { answered: 0, total: 0 },
    })
  }
}

/** Folders never walked; a name carrying control, invisible or bidirectional characters is one of them. */
const SKIP_DIR = (name: string) => name.startsWith('.') || name === 'node_modules' || /\.(shots|images)$/.test(name) || !isPlainName(name)
const RESERVED = RESERVED_DIRS as readonly string[]

async function scanFolder(ctx: Ctx, root: string, folder: string, project: string, relDir: string, out: ScanEntry[], depth: number, now: number | undefined): Promise<void> {
  const entries = await ctx.io.list(folder)
  if (entries === null) return
  /** Regular files by name, each with the size and mtime it was listed with. */
  const files = new Map(entries.filter(e => e.kind === 'file').map(e => [e.name, e] as const))
  const names = new Set(files.keys())
  // A report that is a symbolic link (or any other non-regular file) is never read: it is listed as "could not read".
  const notRegular = new Set(entries.filter(e => e.kind === 'other' && e.name.endsWith('.report.json')).map(e => e.name))
  const bases = new Set<string>()
  for (const name of names) {
    if (name.endsWith('.report.json') || name.endsWith('.opened.json')) bases.add(baseOf(name))
  }
  for (const name of notRegular) bases.add(baseOf(name))
  for (const base of bases) {
    if (!isPlainName(base)) continue
    // Only requests count: the registry's classification (dated, outside releases/roadmap/threads/handoffs/_unfiled, not a note, entry or handoff).
    if (classifyRequestPath(`${root}/${project}/${relDir}${base}.md`, root) === null) continue
    const reportName = `${base}.report.json`
    const hasReport = names.has(reportName)
    const isCollected = names.has(`${base}.collected.json`) || names.has(`${base}.resolved.md`)
    const isOpened = names.has(`${base}.opened.json`)
    let known: ReportKnown = 'absent'
    let summary: ReportSummary | null = null
    if (notRegular.has(reportName) && !isCollected) known = 'malformed'
    else if (hasReport && !isCollected) {
      const got = await readOnce(ctx, `${folder}/${reportName}`, files.get(reportName), MAX_REPORT_BYTES, asReportSummary, text => {
        const parsed = parseJson(text)
        // A finished report in any other shape than the app writes is not an answer.
        return parsed === null || (isFinal(parsed) && !hasReportShape(parsed)) ? null : summarise(parsed)
      })
      // Not read yet: the request is not listed until its report is.
      if (got.got === 'later') continue
      // A report that could not be read (over the cap, behind a link, gone since the listing) is not cached.
      summary = got.got === 'value' ? got.s : null
      // A completion stamped in the future (beyond the skew) is not final yet.
      const isComplete = summary !== null && summary.completedAt !== null && (now === undefined || isValidCompletion(summary.completedAt, now))
      known = summary === null ? 'malformed' : isComplete ? 'final' : 'in-progress'
    }
    const state = stateOf(known, isCollected, isOpened)
    if (state === 'none' || state === 'collected') continue
    let asked: string | undefined
    const requestName = `${base}.md`
    if ((summary?.title ?? '') === '' && names.has(requestName)) {
      const got = await readOnce(ctx, `${folder}/${requestName}`, files.get(requestName), MAX_REQUEST_BYTES, asTitle, text => ({ k: 'title' as const, title: cleanLine(requestTitle(text)) }))
      const found = got.got === 'value' ? (got.s?.title ?? '') : ''
      if (found !== '') asked = found
    }
    let sinceMs = 0
    if (state === 'opened' || state === 'in-progress') {
      const openedName = `${base}.opened.json`
      if (isOpened) {
        const got = await readOnce(ctx, `${folder}/${openedName}`, files.get(openedName), MAX_MARKER_BYTES, asOpened, text => {
          const at = (parseJson(text) ?? {}).openedAt
          const parsed = typeof at === 'string' ? Date.parse(at) : Number.NaN
          return { k: 'opened' as const, at: Number.isNaN(parsed) ? null : parsed }
        })
        const at = got.got === 'value' ? (got.s?.at ?? null) : null
        sinceMs = at ?? files.get(openedName)?.mtimeMs ?? 0
      } else sinceMs = files.get(reportName)?.mtimeMs ?? 0
    }
    let watch: ScanEntry['watch']
    const watchName = `${base}.watch.json`
    if (names.has(watchName)) {
      const got = await readOnce(ctx, `${folder}/${watchName}`, files.get(watchName), MAX_MARKER_BYTES, asWatch, text => {
        const w = parseJson(text) ?? {}
        const beat = typeof w.heartbeatAt === 'string' ? Date.parse(w.heartbeatAt) : Number.NaN
        return { k: 'watch' as const, watch: Number.isNaN(beat) ? null : { agent: cleanLine(w.agent, 60) || 'an agent', machine: cleanLine(w.machine, 60) || 'unknown machine', heartbeatMs: beat } }
      })
      const found = got.got === 'value' ? (got.s?.watch ?? null) : null
      if (found !== null) watch = found
    }
    out.push({
      ...(watch === undefined ? {} : { watch }),
      project,
      rel: `${relDir}${base}.md`,
      ...(asked === undefined ? {} : { requestTitle: asked }),
      sinceMs,
      state,
      title: summary?.title ?? '',
      completedAt: known === 'final' ? (summary?.completedAt ?? null) : null,
      counts: summary?.counts ?? { pass: 0, partial: 0, fail: 0, skip: 0, unanswered: 0 },
      decisions: summary?.decisions ?? { answered: 0, total: 0 },
    })
  }
  if (depth === 0) {
    for (const e of entries) {
      // Only a real folder is walked: a symbolic link is listed as `other`.
      if (e.kind === 'dir' && e.name === 'roadmap') await scanIdeas(ctx, `${folder}/roadmap`, project, out, now)
      if (e.kind === 'dir' && e.name === 'releases') await scanReleases(ctx, `${folder}/releases`, project, out, now)
      if (e.kind !== 'dir' || SKIP_DIR(e.name) || RESERVED.includes(e.name)) continue
      await scanFolder(ctx, root, `${folder}/${e.name}`, project, `${relDir}${e.name}/`, out, 1, now)
    }
  }
}

/**
 * Lists every project folder under the root (one round folder level, plus `roadmap/` and
 * `releases/`), reads only the files whose listed size or mtime differs from the cache, and
 * returns the entries that are opened, in progress, waiting or unreadable, with the cache to keep.
 * It reads at most `maxReads` files: a record whose answer file it did not get to is left out of
 * the entries, and `unread` says how many reads were put off (they are made on later scans, as the
 * cache fills). With `now`, a report whose `completedAt` lies in the future counts as in progress.
 * Never throws.
 */
export async function scanRoot(io: ScanIo, root: string, cache: ScanCache, now?: number, maxReads: number = MAX_READS_PER_SCAN): Promise<{ entries: ScanEntry[]; cache: ScanCache; unread: number }> {
  const base = trimSlashes(root)
  const ctx: Ctx = { io, cache, next: {}, budget: { left: Number.isFinite(maxReads) && maxReads > 0 ? Math.floor(maxReads) : 0, skipped: 0 } }
  const out: ScanEntry[] = []
  try {
    const projects = (await io.list(base)) ?? []
    for (const p of projects) {
      if (p.kind !== 'dir' || SKIP_DIR(p.name) || RESERVED.includes(p.name)) continue
      await scanFolder(ctx, base, `${base}/${p.name}`, p.name, '', out, 0, now)
    }
  } catch {
    // A sync race or a vanished folder: return what was gathered.
  }
  return { entries: out, cache: ctx.next, unread: ctx.budget.skipped }
}
