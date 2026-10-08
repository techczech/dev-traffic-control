import type { SerializableRun } from '../../../shared/ipc'
import type { ItemStatus } from '../../../main/qa/types'

/** Leading `YYYY-MM-DD` of a request filename, or `''` when absent. */
function filenameDate(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const match = base.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

function validDateSource(value: string | undefined): string {
  if (!value) return ''
  return Number.isNaN(Date.parse(value)) ? '' : value
}

/**
 * The best real activity timestamp for a run row. Opening starts the report,
 * otherwise the request file mtime records when it was written. Day-granular
 * frontmatter and filename dates remain compatibility fallbacks.
 */
export function runAgeSource(run: SerializableRun): string {
  return (
    validDateSource(run.report?.startedAt) ||
    validDateSource(run.requestMtime) ||
    validDateSource(run.request.date) ||
    validDateSource(filenameDate(run.request.path))
  )
}

/** The label a run shows in lists — its request title. */
export function runLabel(run: SerializableRun): string {
  return run.request.title
}

/** A wall-clock `HH:MM` from an ISO timestamp; empty string when unparseable. */
export function formatClock(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** A review request renders with review vocabulary everywhere. */
export function isReviewRun(run: SerializableRun): boolean {
  return run.request.mode === 'doc-review'
}

/**
 * The disposition a DONE review displays — outcome wording, never the
 * wire enum: a finished review reads as a fact, not a button. The enum itself
 * stays pass|partial|fail|skip on disk.
 */
export function reviewOutcomeLabel(status: ItemStatus): string {
  switch (status) {
    case 'pass':
      return 'Approved'
    case 'partial':
      return 'Approved with changes'
    case 'fail':
      return 'Needs rework'
    default:
      // skip — and unanswered, which cannot survive Finish (Reading stamps skip).
      return 'Not reviewed'
  }
}

/** The action wording shown for a durable, unfinished review disposition. */
export function reviewDispositionLabel(status: ItemStatus): string {
  switch (status) {
    case 'pass':
      return 'Approve'
    case 'partial':
      return 'Approve with changes'
    case 'fail':
      return 'Needs rework'
    default:
      return 'Not reviewed'
  }
}

/** The verdict tallies a report summarises when a run is done. */
export function verdictCounts(statuses: string[]): {
  pass: number
  partial: number
  fail: number
  skip: number
} {
  return {
    pass: statuses.filter((s) => s === 'pass').length,
    partial: statuses.filter((s) => s === 'partial').length,
    fail: statuses.filter((s) => s === 'fail').length,
    skip: statuses.filter((s) => s === 'skip').length
  }
}
