import type {
  Observation,
  PictureMarkup,
  QaReport,
  QaRequest,
  ReportItem,
  Verdict
} from '../../../main/qa/types'

/**
 * Pure report transformations for the Runner — report in, report out, never
 * mutating the input. Every report change in the renderer flows through one of
 * these; components hold no ad-hoc report surgery (ADR-0006, M3 plan).
 */

function mapItem(r: QaReport, itemId: string, fn: (it: ReportItem) => ReportItem): QaReport {
  let changed = false
  const items = r.items.map((it) => {
    if (it.id !== itemId) return it
    changed = true
    return fn(it)
  })
  return changed ? { ...r, items } : r
}

/**
 * Set a verdict, or toggle it off (→ `unanswered`) when the same verdict is
 * re-applied. Flags and quotes are deliberately kept when leaving partial/fail:
 * the data survives in the report and the UI simply hides the blocks, so the
 * user can toggle back without losing work.
 */
export function applyVerdict(r: QaReport, itemId: string, v: Verdict): QaReport {
  return mapItem(r, itemId, (it) => ({
    ...it,
    status: it.status === v ? 'unanswered' : v
  }))
}

/**
 * Add a flag on an Expected bullet (storing its full bullet text) or remove the
 * existing one — removing takes its comment with it (documented behaviour).
 * Flags stay sorted by `expectedIndex`.
 */
export function toggleFlag(
  r: QaReport,
  req: QaRequest,
  itemId: string,
  expectedIndex: number
): QaReport {
  return mapItem(r, itemId, (it) => {
    const pos = it.flagged.findIndex((f) => f.expectedIndex === expectedIndex)
    if (pos > -1) {
      return { ...it, flagged: it.flagged.filter((_, i) => i !== pos) }
    }
    const reqItem = req.items.find((ri) => ri.id === itemId)
    const text = reqItem?.expected[expectedIndex] ?? ''
    const flagged = [...it.flagged, { expectedIndex, text, comment: '' }].sort(
      (a, b) => a.expectedIndex - b.expectedIndex
    )
    return { ...it, flagged }
  })
}

export function addQuote(
  r: QaReport,
  itemId: string,
  raw: string,
  context: { before: string; after: string }
): QaReport {
  const text = trimSelection(raw, context.before, context.after)
  if (!text) return r
  return mapItem(r, itemId, (it) => ({ ...it, quotes: [...it.quotes, { text, comment: '' }] }))
}

export function setFlagComment(
  r: QaReport,
  itemId: string,
  expectedIndex: number,
  comment: string
): QaReport {
  return mapItem(r, itemId, (it) => ({
    ...it,
    flagged: it.flagged.map((f) => (f.expectedIndex === expectedIndex ? { ...f, comment } : f))
  }))
}

export function setQuoteComment(
  r: QaReport,
  itemId: string,
  quoteIndex: number,
  comment: string
): QaReport {
  return mapItem(r, itemId, (it) => ({
    ...it,
    quotes: it.quotes.map((q, i) => (i === quoteIndex ? { ...q, comment } : q))
  }))
}

export function removeQuote(r: QaReport, itemId: string, quoteIndex: number): QaReport {
  return mapItem(r, itemId, (it) => ({
    ...it,
    quotes: it.quotes.filter((_, i) => i !== quoteIndex)
  }))
}

export function setComment(r: QaReport, itemId: string, comment: string): QaReport {
  return mapItem(r, itemId, (it) => ({ ...it, comment }))
}

export function addScreenshot(r: QaReport, itemId: string, relPath: string): QaReport {
  return mapItem(r, itemId, (it) =>
    it.screenshots.includes(relPath) ? it : { ...it, screenshots: [...it.screenshots, relPath] }
  )
}

export function removeScreenshot(r: QaReport, itemId: string, relPath: string): QaReport {
  return mapItem(r, itemId, (it) =>
    withoutMarkupOf(
      {
        ...it,
        screenshots: it.screenshots.filter((s) => s !== relPath)
      },
      relPath
    )
  )
}

/** A removed screenshot's marks go with it (ticket 30); the files stay on disk. */
function withoutMarkupOf<T extends { markups?: PictureMarkup[] }>(holder: T, picture: string): T {
  if (!holder.markups?.some((m) => m.picture === picture)) return holder
  const next: T = { ...holder, markups: holder.markups.filter((m) => m.picture !== picture) }
  if (next.markups?.length === 0) delete next.markups
  return next
}

/** Materialise a parked item only when the reviewer chooses to test it. */
export function ensureItem(r: QaReport, id: string, title: string): QaReport {
  if (r.items.some((item) => item.id === id)) return r
  return {
    ...r,
    items: [
      ...r.items,
      {
        id,
        title,
        status: 'unanswered',
        comment: '',
        flagged: [],
        quotes: [],
        screenshots: []
      }
    ]
  }
}

export function nextObservationId(r: QaReport): string {
  const highestSurviving = (r.observations ?? []).reduce((highest, observation) => {
    const match = observation.id.match(/^obs-(\d+)$/)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  return `obs-${Math.max(r.observationSeq ?? 0, highestSurviving) + 1}`
}

export function addObservation(r: QaReport): QaReport {
  const id = nextObservationId(r)
  const sequence = Number(id.slice('obs-'.length))
  return {
    ...r,
    observationSeq: sequence,
    observations: [...(r.observations ?? []), { id, text: '', screenshots: [] }]
  }
}

function mapObservation(
  r: QaReport,
  observationId: string,
  fn: (observation: Observation) => Observation
): QaReport {
  let changed = false
  const observations = (r.observations ?? []).map((observation) => {
    if (observation.id !== observationId) return observation
    const next = fn(observation)
    if (next !== observation) changed = true
    return next
  })
  return changed ? { ...r, observations } : r
}

export function setObservationText(r: QaReport, id: string, text: string): QaReport {
  return mapObservation(r, id, (observation) =>
    observation.text === text ? observation : { ...observation, text }
  )
}

export function removeObservation(r: QaReport, id: string): QaReport {
  const observations = (r.observations ?? []).filter((observation) => observation.id !== id)
  return observations.length === (r.observations ?? []).length ? r : { ...r, observations }
}

export function addObservationScreenshot(r: QaReport, id: string, relPath: string): QaReport {
  return mapObservation(r, id, (observation) =>
    observation.screenshots.includes(relPath)
      ? observation
      : { ...observation, screenshots: [...observation.screenshots, relPath] }
  )
}

export function removeObservationScreenshot(r: QaReport, id: string, relPath: string): QaReport {
  return mapObservation(r, id, (observation) => {
    if (!observation.screenshots.includes(relPath)) return observation
    return withoutMarkupOf(
      {
        ...observation,
        screenshots: observation.screenshots.filter((screenshot) => screenshot !== relPath)
      },
      relPath
    )
  })
}

/** Resolve only untouched, live checks; parked materialisations stay optional. */
export function markUnansweredWorks(r: QaReport, exclude: Set<string>): QaReport {
  let changed = false
  const items = r.items.map((item) => {
    if (item.removed || item.status !== 'unanswered' || exclude.has(item.id)) return item
    changed = true
    return { ...item, status: 'pass' as const }
  })
  return changed ? { ...r, items } : r
}

export function linkNoteFile(r: QaReport, relPath: string): QaReport {
  if (r.noteFiles.includes(relPath)) return r
  return { ...r, noteFiles: [...r.noteFiles, relPath] }
}

/** Answered = a non-removed item that carries a verdict. */
export function answeredCount(r: QaReport): number {
  return r.items.filter((it) => !it.removed && it.status !== 'unanswered').length
}

/** The first non-removed item still awaiting a verdict, or null when all answered. */
export function firstUnansweredId(r: QaReport): string | null {
  const it = r.items.find((i) => !i.removed && i.status === 'unanswered')
  return it ? it.id : null
}

/**
 * Snap a raw text selection to word boundaries and mark continuation with
 * honest ellipses: a leading `…` iff real text precedes the snapped selection
 * in the bullet, a trailing `…` iff real text follows it (ADR-0006 taste rule
 * 4 — never mid-word cuts). Port of the mockup's selection behaviour.
 */
export function trimSelection(raw: string, before: string, after: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  if (!s) return s
  // Drop partial edge words: if the selection starts/ends mid-word, snap inward.
  if (/\S$/.test(before) && /^\S/.test(s)) s = s.replace(/^\S+\s*/, '')
  if (/^\S/.test(after) && /\S$/.test(s)) s = s.replace(/\s*\S+$/, '')
  s = s.trim()
  if (!s) return s
  const lead = before.trim() ? '…' : ''
  const trail = after.trim() ? '…' : ''
  return `${lead}${s}${trail}`.replace(/^……/, '…').replace(/……$/, '…')
}
