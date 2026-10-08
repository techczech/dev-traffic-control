import path from 'node:path'
import {
  ConfinementError,
  listConfined,
  readConfined,
  readConfinedText,
  recordRelative,
  recordTarget,
  renameConfinedExclusive
} from './confinedFs'
import { parseRequest } from './qa/parseRequest'
import {
  emptyReviewReport,
  CorruptReportError,
  finishRun as stampFinish,
  newReport,
  readReport,
  reconcile,
  reopenRun as clearStamp,
  reportPathFor,
  writeReport,
  writeReopenedReport
} from './qa/report'
import { nextShotPath, saveShot, shotsDirFor } from './qa/shots'
import { shotsFolderIsConfined } from './confinement'
import type { QaReport } from './qa/types'
import { REPORT_RECOVERY_MARKER, type OpenRunResult } from '../shared/ipc'

const pendingReportWrites = new Map<string, Promise<void>>()
const imageMediaTypes: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

async function readQueuedReport(reportPath: string, recordRoot?: string): Promise<QaReport | null> {
  const pending = pendingReportWrites.get(reportPath)
  if (pending) await pending.catch(() => undefined)
  return readReport(reportPath, recordRoot)
}

/** A request's own text, read through the confined file calls. */
async function readRequestText(requestPath: string, recordRoot?: string): Promise<string> {
  const target = await recordTarget(requestPath, recordRoot)
  return readConfinedText(target.root, target.rel)
}

export function queueReportWrite(reportPath: string, write: () => Promise<void>): Promise<void> {
  const previous = pendingReportWrites.get(reportPath) ?? Promise.resolve()
  const queued = previous.catch(() => undefined).then(write)
  pendingReportWrites.set(reportPath, queued)
  return queued.finally(() => {
    if (pendingReportWrites.get(reportPath) === queued) pendingReportWrites.delete(reportPath)
  })
}

export class ReportRecoveryError extends Error {
  readonly reportPath: string

  constructor(error: CorruptReportError) {
    super(
      `Refusing to change the invalid report at ${error.reportPath}. ` +
        'Use “Set aside and start fresh” to preserve the damaged file before creating a new report.'
    )
    this.name = 'ReportRecoveryError'
    this.reportPath = error.reportPath
  }
}

export class ReportRecoveryWriteError extends Error {
  readonly backupPath: string

  constructor(backupPath: string, cause: unknown) {
    super(
      `${REPORT_RECOVERY_MARKER}${path.basename(backupPath)}, but no new report exists yet. ` +
        'Retry to write the in-memory report.',
      { cause }
    )
    this.name = 'ReportRecoveryWriteError'
    this.backupPath = backupPath
  }
}

async function preserveCorruptReport<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof CorruptReportError) throw new ReportRecoveryError(error)
    throw error
  }
}

/**
 * Pure-ish IO over the contract library — no Electron imports. Timestamps
 * are injected as `now` so the wiring (index.ts) is the only place that reads
 * the wall clock. The report file is created lazily on the first save; opening
 * a run never writes, so a request nobody answered still reads as waiting.
 *
 * Every function takes the records folder as its last argument, `recordRoot`,
 * and reads and writes only through the confined file calls (confinedFs). The
 * IPC handlers always pass it; see `recordTarget` for what is checked when it
 * is left out.
 */

export async function openRun(
  requestPath: string,
  now: () => string,
  recordRoot?: string
): Promise<OpenRunResult> {
  const request = parseRequest(await readRequestText(requestPath, recordRoot), requestPath)
  let existing: QaReport | null
  try {
    existing = await readQueuedReport(reportPathFor(requestPath), recordRoot)
  } catch (error) {
    if (!(error instanceof CorruptReportError)) throw error
    const fresh =
      request.mode === 'doc-review' ? emptyReviewReport(request, now) : newReport(request, now)
    return {
      request,
      report: fresh,
      exists: true,
      corruptReport: { path: error.reportPath, message: error.message }
    }
  }
  if (!existing) {
    // A doc-review has no items — its report is the single 'document' item;
    // newReport would map req.items to nothing.
    const fresh =
      request.mode === 'doc-review' ? emptyReviewReport(request, now) : newReport(request, now)
    return { request, report: fresh, exists: false }
  }
  // verdicts survive by id; removed items flagged
  return { request, report: reconcile(request, existing), exists: true }
}

export async function setAsideCorruptReport(
  requestPath: string,
  now: () => string = () => new Date().toISOString(),
  recordRoot?: string
): Promise<string> {
  const source = reportPathFor(requestPath)
  const target = await recordTarget(source, recordRoot)
  const stamp = now().replace(/[-:.Z]/g, '')
  const stem = source.replace(/\.report\.json$/, `.report.corrupt-${stamp}`)
  for (let suffix = 0; ; suffix += 1) {
    const destination = `${stem}${suffix ? `-${suffix}` : ''}.json`
    try {
      await renameConfinedExclusive(target.root, target.rel, path.basename(destination))
      return destination
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
}

export async function recoverCorruptReport(
  requestPath: string,
  report: QaReport,
  now: () => string = () => new Date().toISOString(),
  recordRoot?: string
): Promise<string> {
  const reportPath = reportPathFor(requestPath)
  let backup = ''
  await queueReportWrite(reportPath, async () => {
    backup = await setAsideCorruptReport(requestPath, now, recordRoot)
    try {
      await writeReport(reportPath, report, recordRoot)
    } catch (error) {
      throw new ReportRecoveryWriteError(backup, error)
    }
  })
  return backup
}

export async function save(
  requestPath: string,
  report: QaReport,
  recordRoot?: string
): Promise<{ savedAt: string }> {
  const reportPath = reportPathFor(requestPath)
  await queueReportWrite(reportPath, () =>
    preserveCorruptReport(() => writeReport(reportPath, report, recordRoot))
  )
  return { savedAt: new Date().toISOString() }
}

export async function finish(
  requestPath: string,
  report: QaReport,
  now: () => string,
  recordRoot?: string
): Promise<QaReport> {
  const stamped = stampFinish(report, now)
  const reportPath = reportPathFor(requestPath)
  await queueReportWrite(reportPath, () =>
    preserveCorruptReport(() => writeReport(reportPath, stamped, recordRoot))
  )
  return stamped
}

export async function reopen(requestPath: string, recordRoot?: string): Promise<QaReport> {
  const reportPath = reportPathFor(requestPath)
  let cleared: QaReport | null = null
  await queueReportWrite(reportPath, async () => {
    const existing = await preserveCorruptReport(() => readReport(reportPath, recordRoot))
    if (!existing) throw new Error(`no report to reopen: ${requestPath}`)
    cleared = clearStamp(existing)
    await writeReopenedReport(reportPath, cleared, recordRoot)
  })
  if (!cleared) throw new Error(`no report to reopen: ${requestPath}`)
  return cleared
}

/**
 * The screenshot target ids a run can name: the request's own items (a
 * doc-review's single synthetic 'document' item), plus light-run observation
 * ids, which the renderer mints (`obs-<n>`) before any report holds them.
 */
function shotItemIds(requestPath: string, raw: string): Set<string> {
  const request = parseRequest(raw, requestPath)
  const ids = new Set(request.items.map((item) => item.id))
  if (request.mode === 'doc-review') ids.add('document')
  return ids
}

/**
 * Store a run screenshot in `<request>.shots/`. `requestPath` must already be
 * the authoritative scanned request. The item id must be one of the request's
 * own ids (or a light-run observation id), and an existing shots folder must be
 * a real folder inside the record root; anything else throws before a byte is
 * written.
 */
export async function storeShot(
  recordRoot: string,
  requestPath: string,
  itemId: unknown,
  png: Buffer
): Promise<string> {
  if (
    typeof itemId !== 'string' ||
    !(
      shotItemIds(requestPath, await readRequestText(requestPath, recordRoot)).has(itemId) ||
      /^obs-\d+$/.test(itemId)
    )
  ) {
    throw new Error('screenshot target is not an item of this request')
  }
  const dir = shotsDirFor(requestPath.replace(/\.md$/, ''))
  if (!(await shotsFolderIsConfined(recordRoot, dir))) {
    throw new Error('screenshot folder is outside the record root')
  }
  let existing: string[] = []
  try {
    existing = (await listConfined(recordRoot, await recordRelative(recordRoot, dir))).map(
      (entry) => entry.name
    )
  } catch (error) {
    // The first shot creates the folder; any other failure is a refusal.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const abs = await saveShot(nextShotPath(dir, itemId, existing), png, recordRoot)
  return path.relative(path.dirname(requestPath), abs) // e.g. "x.shots/item-1.png"
}

/**
 * One picture of a run as a `data:` URL. `relPath` is relative to the
 * request's folder and must stay below it; the file is read through the
 * confined file calls, so neither it nor a folder on the way may be a link.
 */
export async function readShotDataUrl(
  requestPath: string,
  relPath: string,
  recordRoot?: string
): Promise<string> {
  const runFolder = path.dirname(requestPath)
  const candidate = path.resolve(runFolder, relPath)
  const below = path.relative(runFolder, candidate)
  if (below === '' || below.startsWith('..') || path.isAbsolute(below)) {
    throw new Error('shot path escapes run folder')
  }
  const root = recordRoot ?? runFolder
  let data: Buffer
  try {
    data = await readConfined(root, await recordRelative(root, candidate))
  } catch (error) {
    if (error instanceof ConfinementError) throw new Error('shot path escapes run folder')
    throw error
  }
  const mediaType = imageMediaTypes[path.extname(candidate).toLowerCase()] ?? 'image/png'
  return `data:${mediaType};base64,${data.toString('base64')}`
}
