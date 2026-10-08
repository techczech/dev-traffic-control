/** Report parsing and state classification. Never throws. */

import { cleanLine } from './sanitise'

/** The most bytes read of one report; a larger one is treated as unreadable. */
export const MAX_REPORT_BYTES = 2 * 1024 * 1024
/** The most bytes read of a request file, for its title only; a larger one gives no title. */
export const MAX_REQUEST_BYTES = 1024 * 1024
/** The most bytes read of an `.opened.json` or `.watch.json`. */
export const MAX_MARKER_BYTES = 64 * 1024

export type Verdicts = { pass: number; partial: number; fail: number; skip: number; unanswered: number }

export type ReportState = 'none' | 'opened' | 'in-progress' | 'waiting' | 'collected' | 'malformed'

export type ReportFacts = {
  /** Text of `<base>.report.json`; null when the file is absent or could not be read. */
  reportText: string | null
  /** `<base>.collected.json` or `<base>.resolved.md` exists. */
  isCollected: boolean
  /** `<base>.opened.json` exists. */
  isOpened: boolean
}

type Json = Record<string, unknown>

export function parseJson(text: string | null): Json | null {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
  } catch {
    return null
  }
}

/** Clock skew allowed between the machine the app runs on and this one. */
export const SKEW_MS = 5 * 60_000

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

/** Epoch ms of an ISO-8601 timestamp with date, time and zone; null for anything else. */
export function isoTime(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO.test(value)) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

/**
 * Whether a `completedAt` counts as a real completion: an ISO-8601 timestamp, not later than
 * now plus five minutes' skew, and not earlier than the request was filed (when that is known).
 */
export function isValidCompletion(completedAt: unknown, now: number, filedAt?: number): boolean {
  const t = isoTime(completedAt)
  if (t === null || t > now + SKEW_MS) return false
  return filedAt === undefined || t >= filedAt
}

/** Final by its shape: `completedAt` is an ISO-8601 timestamp. Time checks are `isValidCompletion`'s. */
export function isFinal(report: Json): boolean {
  return isoTime(report.completedAt) !== null
}

/**
 * The shape a finished report must have before it counts as an answer: `items` is a list of
 * objects, and `observations`, when present, is a list. Anything else is shown as "could not read".
 */
export function hasReportShape(report: Json): boolean {
  if (!Array.isArray(report.items) || !report.items.every(i => i !== null && typeof i === 'object' && !Array.isArray(i))) return false
  return report.observations === undefined || Array.isArray(report.observations)
}

export type ReportKnown = 'absent' | 'malformed' | 'in-progress' | 'final'

/** The state table, from what is known of the report file. */
export function stateOf(known: ReportKnown, isCollected: boolean, isOpened: boolean): ReportState {
  if (isCollected) return 'collected'
  if (known === 'absent') return isOpened ? 'opened' : 'none'
  if (known === 'malformed') return 'malformed'
  return known === 'final' ? 'waiting' : 'in-progress'
}

/**
 * Where a request stands. A half-written or malformed report is `malformed`: listed as
 * "could not read", never counted, never an error. A collected or resolved request is closed whatever else exists.
 */
export function classifyReport(facts: ReportFacts): ReportState {
  const report = facts.reportText === null ? null : parseJson(facts.reportText)
  const known: ReportKnown = facts.reportText === null ? 'absent' : report === null ? 'malformed' : isFinal(report) ? 'final' : 'in-progress'
  return stateOf(known, facts.isCollected, facts.isOpened)
}

export function emptyVerdicts(): Verdicts {
  return { pass: 0, partial: 0, fail: 0, skip: 0, unanswered: 0 }
}

function itemsOf(report: Json): Json[] {
  const items = report.items
  if (!Array.isArray(items)) return []
  return items.filter((i): i is Json => i !== null && typeof i === 'object' && !Array.isArray(i) && (i as Json).removed !== true)
}

export function verdictCounts(report: Json): Verdicts {
  const counts = emptyVerdicts()
  for (const item of itemsOf(report)) {
    const s = item.status
    if (s === 'pass' || s === 'partial' || s === 'fail' || s === 'skip') counts[s]++
    else counts.unanswered++
  }
  return counts
}

function decisionsOf(item: Json): Json[] {
  const d = item.decisions
  return Array.isArray(d) ? d.filter((x): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x)) : []
}

/** Doc-review decisions live under `items[*].decisions`, never at the top level. */
export function decisionCounts(report: Json): { answered: number; total: number } {
  let answered = 0
  let total = 0
  for (const item of itemsOf(report)) {
    for (const d of decisionsOf(item)) {
      total++
      if (typeof d.choice === 'string' && d.choice !== '') answered++
    }
  }
  return { answered, total }
}

/** What a scan keeps of a parsed report. */
export type ReportSummary = {
  title: string
  completedAt: string | null
  counts: Verdicts
  decisions: { answered: number; total: number }
}

export function summarise(report: Json): ReportSummary {
  return {
    title: cleanLine(report.title),
    completedAt: isFinal(report) ? (report.completedAt as string) : null,
    counts: verdictCounts(report),
    decisions: decisionCounts(report),
  }
}

/** Title of a request: frontmatter `title`, else the first heading. */
export function requestTitle(markdown: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  if (fm !== null) {
    const t = /^title:\s*(.+?)\s*$/m.exec(fm[1] as string)
    if (t !== null) return (t[1] as string).replace(/^(["'])(.*)\1$/, '$2')
  }
  const body = fm === null ? markdown : markdown.slice(fm[0].length)
  const h = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(body)
  return h === null ? null : (h[1] as string)
}

export { itemsOf, decisionsOf }
