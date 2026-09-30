import type { QaReport, QuoteEntry, ReportItem, SectionMark, Verdict } from '../../../main/qa/types'
import type { DocBlock } from './richtext'
import { runsText } from './richtext'
import { trimSelection } from './runnerState'

/**
 * Pure state for the Reading surface (M7) — the review mirror of runnerState.
 * A review report has one item, `id: 'document'` (ADR-0007 §3): its `status`
 * is the Disposition, `quotes[]` the Ledger comments (with stable Marker
 * `number`s, ADR-0008 §3), `sectionMarks[]` the whole-section marks. Every
 * report change in Reading flows through a producer here; the maths that
 * places Markers and margin cards lives here too so it can be unit-tested
 * without a DOM.
 */

export const DOCUMENT_ITEM_ID = 'document'

/**
 * The flush-at-switch-boundary law (TallyBoard empty-outline lesson): when a
 * surface unmounts, a pending debounced save must FLUSH, never be cancelled —
 * otherwise the last 400 ms of edits silently never reach disk. Reading's
 * unmount cleanup delegates here so the decision is unit-testable (the
 * node-only test environment cannot mount/unmount a React tree).
 */
export function flushPendingSave(
  dirty: { current: boolean },
  report: { current: QaReport | null },
  save: (r: QaReport) => void
): void {
  if (dirty.current && report.current) {
    dirty.current = false
    save(report.current)
  }
}

/** The single review item; null on a malformed report (renderer stays calm). */
export function documentItem(r: QaReport): ReportItem | null {
  return r.items.find((it) => it.id === DOCUMENT_ITEM_ID) ?? null
}

function mapDocument(r: QaReport, fn: (it: ReportItem) => ReportItem): QaReport {
  let changed = false
  const items = r.items.map((it) => {
    if (it.id !== DOCUMENT_ITEM_ID) return it
    changed = true
    return fn(it)
  })
  return changed ? { ...r, items } : r
}

/**
 * The next Marker number: max of stored numbers + 1, never a reused id
 * (ADR-0008 §3 — removal never renumbers, so order alone cannot carry this).
 */
export function nextMarkerNumber(quotes: QuoteEntry[]): number {
  return quotes.reduce((max, q) => Math.max(max, q.number ?? 0), 0) + 1
}

/**
 * Quote a selection: word-boundary trim with honest ellipses (the v1 selection
 * law), section inherited from the anchor's nearest preceding H2/H3.
 */
export function addReviewQuote(
  r: QaReport,
  raw: string,
  context: { before: string; after: string },
  section: string | null
): QaReport {
  const text = trimSelection(raw, context.before, context.after)
  if (!text) return r
  return mapDocument(r, (it) => ({
    ...it,
    quotes: [
      ...it.quotes,
      { text, comment: '', section: section ?? undefined, number: nextMarkerNumber(it.quotes) }
    ]
  }))
}

/** Remove one Marker's entry; every other number is untouched (ADR-0008 §3). */
export function removeReviewQuote(r: QaReport, number: number): QaReport {
  return mapDocument(r, (it) => ({
    ...it,
    quotes: it.quotes.filter((q) => q.number !== number)
  }))
}

export function setReviewQuoteComment(r: QaReport, number: number, comment: string): QaReport {
  return mapDocument(r, (it) => ({
    ...it,
    quotes: it.quotes.map((q) => (q.number === number ? { ...q, comment } : q))
  }))
}

/** Toggle a whole-section needs-work mark; removal takes its comment with it. */
export function toggleSectionMark(r: QaReport, section: string): QaReport {
  return mapDocument(r, (it) => {
    const marks = it.sectionMarks ?? []
    const existing = marks.some((m) => m.section === section)
    return {
      ...it,
      sectionMarks: existing
        ? marks.filter((m) => m.section !== section)
        : [...marks, { section, comment: '' }]
    }
  })
}

export function setSectionMarkComment(r: QaReport, section: string, comment: string): QaReport {
  return mapDocument(r, (it) => ({
    ...it,
    sectionMarks: (it.sectionMarks ?? []).map((m) =>
      m.section === section ? { ...m, comment } : m
    )
  }))
}

/**
 * Set the Disposition, or toggle it off (→ `unanswered`) when the same one is
 * re-applied — the v1 toggle law, same enum on the wire (ADR-0007 §2).
 */
export function setDisposition(r: QaReport, v: Verdict): QaReport {
  return mapDocument(r, (it) => ({
    ...it,
    status: it.status === v ? 'unanswered' : v
  }))
}

/**
 * The document item's own `comment` field — the report round-trips it, but
 * until the Finish-review sheet's final-comments box nothing wrote it for a
 * review. Empty text clears it; a report with no document item is left alone.
 */
export function setDocumentComment(r: QaReport, text: string): QaReport {
  return mapDocument(r, (it) => ({ ...it, comment: text }))
}

/**
 * Pick a decision option (upsert into `decisions[]` by id); re-picking the same
 * option toggles it back off to `''`, mirroring the disposition toggle law. The
 * question snapshot is (re)written each time so the record is self-describing.
 */
export function setDecisionChoice(
  r: QaReport,
  id: string,
  question: string,
  choice: string
): QaReport {
  return mapDocument(r, (it) => {
    const decisions = it.decisions ?? []
    const existing = decisions.find((d) => d.id === id)
    if (existing) {
      const next = existing.choice === choice ? '' : choice
      return {
        ...it,
        decisions: decisions.map((d) => (d.id === id ? { ...d, question, choice: next } : d))
      }
    }
    return { ...it, decisions: [...decisions, { id, question, choice }] }
  })
}

/** Set a decision's optional comment (upsert; the pick may still be empty). */
export function setDecisionComment(
  r: QaReport,
  id: string,
  question: string,
  comment: string
): QaReport {
  return mapDocument(r, (it) => {
    const decisions = it.decisions ?? []
    const existing = decisions.find((d) => d.id === id)
    if (existing) {
      return {
        ...it,
        decisions: decisions.map((d) => (d.id === id ? { ...d, question, comment } : d))
      }
    }
    return { ...it, decisions: [...decisions, { id, question, choice: '', comment }] }
  })
}

// ---------------------------------------------------------------------------
// Anchor resolution (M7 T4). Rendered text is addressed as flat "containers"
// — one per paragraph, heading, list item, sub-item or code block — each
// carrying the section it falls under. A quote anchors at the first
// string-match of its text inside its section's containers; no match (should
// not happen — the Snapshot is immutable) falls back to a chip at the section
// heading.

export interface TextContainer {
  path: string // "blockIndex[.itemIndex[.subIndex]]" — stable render address
  section: string | null // nearest preceding (or own) H2/H3 id; null before any
  text: string // the plain text a reader sees (runs concatenated)
}

/** Flatten parsed blocks into the anchor-addressable text containers. */
export function textContainers(blocks: DocBlock[]): TextContainer[] {
  const out: TextContainer[] = []
  let section: string | null = null
  blocks.forEach((b, i) => {
    if (b.kind === 'heading') section = b.id
    if (b.kind === 'title' || b.kind === 'heading' || b.kind === 'para') {
      out.push({ path: String(i), section, text: runsText(b.runs) })
    } else if (b.kind === 'code') {
      out.push({ path: String(i), section, text: b.text })
    } else if (b.kind === 'list') {
      b.items.forEach((item, j) => {
        out.push({ path: `${i}.${j}`, section, text: runsText(item.runs) })
        item.sub?.items.forEach((subRuns, k) => {
          out.push({ path: `${i}.${j}.${k}`, section, text: runsText(subRuns) })
        })
      })
    }
    // table / image / embed / decision carry no quotable text — no container.
  })
  return out
}

export interface AnchorSpot {
  path: string
  start: number // character offsets into the container's plain text
  end: number
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Place every quote: first whitespace-tolerant match of its (ellipsis-stripped)
 * text within its section's containers, in document order, skipping ranges an
 * earlier Marker already claimed. `null` = no match → heading fallback chip.
 * Resolution runs in Marker-number order so placement is deterministic.
 */
export function resolveAnchors(
  containers: TextContainer[],
  quotes: QuoteEntry[]
): Map<number, AnchorSpot | null> {
  const out = new Map<number, AnchorSpot | null>()
  const claimed = new Map<string, [number, number][]>()
  const sorted = [...quotes].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  for (const q of sorted) {
    const needle = (q.text ?? '').replace(/^…/, '').replace(/…$/, '').trim()
    let spot: AnchorSpot | null = null
    if (needle) {
      const re = new RegExp(needle.split(/\s+/).map(escapeRe).join('\\s+'), 'g')
      outer: for (const c of containers) {
        if ((q.section ?? null) !== c.section) continue
        const taken = claimed.get(c.path) ?? []
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(c.text)) !== null) {
          const start = m.index
          const end = start + m[0].length
          if (!taken.some(([s, e]) => start < e && end > s)) {
            spot = { path: c.path, start, end }
            taken.push([start, end])
            claimed.set(c.path, taken)
            break outer
          }
          if (m[0].length === 0) re.lastIndex++ // safety: never loop in place
        }
      }
    }
    out.set(q.number ?? 0, spot)
  }
  return out
}

// ---------------------------------------------------------------------------
// Ledger ordering + margin layout (M7 T5).

export type LedgerEntry =
  | { key: string; kind: 'quote'; quote: QuoteEntry }
  | { key: string; kind: 'mark'; mark: SectionMark }

/**
 * Ledger entries in document order: quotes at their anchor position (heading
 * position when unresolved), section marks at their heading; quotes before
 * marks on a tie (the hi-fi's stable sort by anchor y).
 */
export function orderLedgerEntries(
  quotes: QuoteEntry[],
  marks: SectionMark[],
  containers: TextContainer[],
  anchors: Map<number, AnchorSpot | null>
): LedgerEntry[] {
  const pathIndex = new Map(containers.map((c, i) => [c.path, i]))
  const sectionIndex = (section: string | null): number => {
    const i = containers.findIndex((c) => c.section === section)
    return i === -1 ? 0 : i
  }
  const entries: { entry: LedgerEntry; pos: [number, number, number] }[] = []
  for (const q of quotes) {
    const spot = anchors.get(q.number ?? 0) ?? null
    const pos: [number, number, number] = spot
      ? [pathIndex.get(spot.path) ?? 0, spot.start, 0]
      : [sectionIndex(q.section ?? null), -1, 0]
    entries.push({ entry: { key: `c${q.number ?? 0}`, kind: 'quote', quote: q }, pos })
  }
  for (const m of marks) {
    entries.push({
      entry: { key: `sm-${m.section}`, kind: 'mark', mark: m },
      pos: [sectionIndex(m.section), -1, 1]
    })
  }
  entries.sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2])
  return entries.map((e) => e.entry)
}

/**
 * Margin stacking (ADR-0008 §5): each card wants to sit at its anchor
 * (anchorTop − 2); cards never overlap, so a card pushed by its predecessor
 * starts below it with a visible gap. Entries arrive in document order.
 * Returns the resolved top for each card.
 */
export function layoutMarginTops(
  entries: { anchorTop: number; height: number }[],
  minTop: number,
  gap = 10
): number[] {
  const tops: number[] = []
  let prevBottom = minTop
  for (const e of entries) {
    const top = Math.max(e.anchorTop - 2, prevBottom)
    tops.push(top)
    prevBottom = top + e.height + gap
  }
  return tops
}
