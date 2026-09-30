import { readFile } from 'node:fs/promises'
import { atomicWrite } from './atomicWrite'
import { isInsideRequestPath } from '../../shared/insideRequestPath'
import type { QaReport, QaRequest, ReportItem, RunStatus } from './types'

export function reportPathFor(requestPath: string): string {
  return requestPath.replace(/\.md$/, '.report.json')
}

export class CorruptReportError extends Error {
  constructor(
    readonly reportPath: string,
    readonly reason: string
  ) {
    super(`Could not read the report: ${reason}`)
  }
}

export function newReport(req: QaRequest, now: () => string): QaReport {
  return {
    id: req.id,
    title: req.title,
    app: req.app,
    version: req.version,
    build: req.build,
    startedAt: now(),
    noteFiles: [],
    ...(req.mode === 'light' ? { mode: 'light' as const } : {}),
    items: req.items.map((it) => blankItem(it.id, it.title))
  }
}

function blankItem(id: string, title: string): ReportItem {
  return { id, title, status: 'unanswered', comment: '', flagged: [], quotes: [], screenshots: [] }
}

// A review report has exactly one item — the document (ADR-0007 §3). Mirrors
// newReport, whose map over req.items yields nothing for a doc-review request.
export function emptyReviewReport(req: QaRequest, now: () => string): QaReport {
  return { ...newReport(req, now), items: [blankItem('document', req.title)] }
}

export async function readReport(p: string): Promise<QaReport | null> {
  let raw: string
  try {
    raw = await readFile(p, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CorruptReportError(p, 'the file is not valid JSON')
  }
  try {
    assertQaReport(parsed)
  } catch (error) {
    throw new CorruptReportError(p, error instanceof Error ? error.message : 'the shape is invalid')
  }
  return parsed
}

export async function writeReport(p: string, r: QaReport): Promise<void> {
  await guardedWriteReport(p, r, false)
}

/** The only write path allowed to clear a completion stamp. */
export async function writeReopenedReport(p: string, r: QaReport): Promise<void> {
  await guardedWriteReport(p, r, true)
}

async function guardedWriteReport(p: string, r: QaReport, explicitReopen: boolean): Promise<void> {
  assertQaReport(r)
  const existing = await readReport(p)
  if (existing?.completedAt && !r.completedAt && !explicitReopen) {
    throw new Error(`refusing to overwrite completed report with in-progress report: ${p}`)
  }
  if (r.items.length === 0) {
    if (existing && existing.items.length > 0) {
      throw new Error(`refusing to overwrite non-empty report with empty items: ${p}`)
    }
  }
  await atomicWrite(p, JSON.stringify(r, null, 2) + '\n')
}

const ITEM_STATUSES = new Set(['pass', 'partial', 'fail', 'skip', 'unanswered'])

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid QaReport: ${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringField(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`Invalid QaReport: ${field} must be a string`)
}

function optionalString(value: unknown, field: string): void {
  if (value !== undefined) stringField(value, field)
}

function stringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Invalid QaReport: ${field} must be an array of strings`)
  }
}

function objectArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`Invalid QaReport: ${field} must be an array`)
  return value.map((entry, index) => record(entry, `${field}[${index}]`))
}

function fraction(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid QaReport: ${field} must be a number from 0 to 1`)
  }
}

function markPoint(value: unknown, field: string): void {
  const point = record(value, field)
  fraction(point.x, `${field}.x`)
  fraction(point.y, `${field}.y`)
}

/** A path relative to the request folder that cannot climb out of it. */
function relativePath(value: unknown, field: string): void {
  stringField(value, field)
  if (!isInsideRequestPath(value)) {
    throw new Error(`Invalid QaReport: ${field} must be a path inside the request folder`)
  }
}

/** Marked-up pictures (ticket 30): additive and optional wherever they appear. */
function validateMarkups(value: unknown, field: string): void {
  for (const [markupIndex, markup] of objectArray(value, field).entries()) {
    const at = `${field}[${markupIndex}]`
    relativePath(markup.picture, `${at}.picture`)
    relativePath(markup.marked, `${at}.marked`)
    optionalString(markup.option, `${at}.option`)
    if (markup.notes !== undefined && markup.notes !== 'picture' && markup.notes !== 'list') {
      throw new Error(`Invalid QaReport: ${at}.notes must be picture or list`)
    }
    const numbers = new Set<number>()
    for (const [markIndex, mark] of objectArray(markup.marks, `${at}.marks`).entries()) {
      const m = `${at}.marks[${markIndex}]`
      if (typeof mark.n !== 'number' || !Number.isInteger(mark.n) || mark.n < 1) {
        throw new Error(`Invalid QaReport: ${m}.n must be a whole number from 1`)
      }
      if (numbers.has(mark.n)) throw new Error(`Invalid QaReport: ${m}.n repeats a number`)
      numbers.add(mark.n)
      stringField(mark.text, `${m}.text`)
      if (mark.shape === 'box') {
        const box = record(mark.box, `${m}.box`)
        for (const key of ['x', 'y', 'w', 'h']) fraction(box[key], `${m}.box.${key}`)
      } else if (mark.shape === 'arrow') {
        markPoint(mark.from, `${m}.from`)
        markPoint(mark.to, `${m}.to`)
      } else if (mark.shape === 'text') {
        markPoint(mark.at, `${m}.at`)
      } else {
        throw new Error(`Invalid QaReport: ${m}.shape must be box, arrow or text`)
      }
    }
  }
}

function validateReportItem(value: unknown, index: number): void {
  const item = record(value, `items[${index}]`)
  stringField(item.id, `items[${index}].id`)
  stringField(item.title, `items[${index}].title`)
  if (typeof item.status !== 'string' || !ITEM_STATUSES.has(item.status)) {
    throw new Error(`Invalid QaReport: items[${index}].status is invalid`)
  }
  stringField(item.comment, `items[${index}].comment`)
  stringArray(item.screenshots, `items[${index}].screenshots`)

  for (const [flagIndex, flag] of objectArray(item.flagged, `items[${index}].flagged`).entries()) {
    if (typeof flag.expectedIndex !== 'number') {
      throw new Error(
        `Invalid QaReport: items[${index}].flagged[${flagIndex}].expectedIndex must be a number`
      )
    }
    stringField(flag.text, `items[${index}].flagged[${flagIndex}].text`)
    stringField(flag.comment, `items[${index}].flagged[${flagIndex}].comment`)
  }
  for (const [quoteIndex, quote] of objectArray(item.quotes, `items[${index}].quotes`).entries()) {
    stringField(quote.text, `items[${index}].quotes[${quoteIndex}].text`)
    stringField(quote.comment, `items[${index}].quotes[${quoteIndex}].comment`)
    optionalString(quote.section, `items[${index}].quotes[${quoteIndex}].section`)
    if (quote.number !== undefined && typeof quote.number !== 'number') {
      throw new Error(`Invalid QaReport: items[${index}].quotes[${quoteIndex}].number is invalid`)
    }
  }
  if (item.sectionMarks !== undefined) {
    for (const [markIndex, mark] of objectArray(
      item.sectionMarks,
      `items[${index}].sectionMarks`
    ).entries()) {
      stringField(mark.section, `items[${index}].sectionMarks[${markIndex}].section`)
      stringField(mark.comment, `items[${index}].sectionMarks[${markIndex}].comment`)
    }
  }
  if (item.decisions !== undefined) {
    for (const [decisionIndex, decision] of objectArray(
      item.decisions,
      `items[${index}].decisions`
    ).entries()) {
      stringField(decision.id, `items[${index}].decisions[${decisionIndex}].id`)
      stringField(decision.question, `items[${index}].decisions[${decisionIndex}].question`)
      stringField(decision.choice, `items[${index}].decisions[${decisionIndex}].choice`)
      optionalString(decision.comment, `items[${index}].decisions[${decisionIndex}].comment`)
      if (decision.markups !== undefined) {
        validateMarkups(decision.markups, `items[${index}].decisions[${decisionIndex}].markups`)
      }
    }
  }
  if (item.markups !== undefined) validateMarkups(item.markups, `items[${index}].markups`)
  if (item.removed !== undefined && typeof item.removed !== 'boolean') {
    throw new Error(`Invalid QaReport: items[${index}].removed must be a boolean`)
  }
}

/** Runtime boundary for both disk JSON and renderer-supplied report objects. */
export function assertQaReport(value: unknown): asserts value is QaReport {
  const report = record(value, 'report')
  stringField(report.id, 'id')
  stringField(report.title, 'title')
  stringField(report.startedAt, 'startedAt')
  optionalString(report.app, 'app')
  optionalString(report.version, 'version')
  optionalString(report.build, 'build')
  optionalString(report.completedAt, 'completedAt')
  stringArray(report.noteFiles, 'noteFiles')
  if (!Array.isArray(report.items)) throw new Error('Invalid QaReport: items must be an array')
  report.items.forEach(validateReportItem)
  if (report.mode !== undefined && report.mode !== 'light') {
    throw new Error('Invalid QaReport: mode must be light when present')
  }
  if (report.observationSeq !== undefined && typeof report.observationSeq !== 'number') {
    throw new Error('Invalid QaReport: observationSeq must be a number')
  }
  if (report.observations !== undefined) {
    for (const [index, observation] of objectArray(report.observations, 'observations').entries()) {
      stringField(observation.id, `observations[${index}].id`)
      stringField(observation.text, `observations[${index}].text`)
      stringArray(observation.screenshots, `observations[${index}].screenshots`)
      if (observation.markups !== undefined) {
        validateMarkups(observation.markups, `observations[${index}].markups`)
      }
    }
  }
}

export function reconcile(req: QaRequest, old: QaReport): QaReport {
  // A doc-review request has no items, but its report's single 'document'
  // item is the disposition — reconciling against [] would mark it removed.
  const expected = req.mode === 'doc-review' ? [{ id: 'document', title: req.title }] : req.items
  const parkedIds = new Set(req.parked.map((item) => item.id))
  const byId = new Map(old.items.map((i) => [i.id, i]))
  const items: ReportItem[] = expected.map((it) => {
    const prev = byId.get(it.id)
    byId.delete(it.id)
    return prev ? { ...prev, title: it.title, removed: undefined } : blankItem(it.id, it.title)
  })
  for (const gone of byId.values()) {
    items.push(parkedIds.has(gone.id) ? gone : { ...gone, removed: true })
  }
  return {
    ...old,
    title: req.title,
    mode: req.mode === 'light' ? 'light' : old.mode,
    items
  }
}

export function finishRun(r: QaReport, now: () => string): QaReport {
  return { ...r, completedAt: now() }
}

export function reopenRun(r: QaReport): QaReport {
  const reopened = { ...r }
  delete reopened.completedAt
  return reopened
}

export function runStatus(report: QaReport | null): RunStatus {
  if (!report) return 'waiting'
  return report.completedAt ? 'done' : 'in-progress'
}
