import { expect, test } from 'vitest'
import type { QaReport, QuoteEntry } from '../../../../main/qa/types'
import { parseDocBlocks } from '../richtext'
import {
  addReviewQuote,
  documentItem,
  flushPendingSave,
  layoutMarginTops,
  nextMarkerNumber,
  orderLedgerEntries,
  removeReviewQuote,
  resolveAnchors,
  setDecisionChoice,
  setDecisionComment,
  setDisposition,
  setReviewQuoteComment,
  setSectionMarkComment,
  textContainers,
  toggleSectionMark
} from '../reviewState'

function reviewReport(): QaReport {
  return {
    id: 'rev',
    title: 'Review',
    startedAt: '2026-07-19T10:00:00.000Z',
    noteFiles: [],
    items: [
      {
        id: 'document',
        title: 'Review',
        status: 'unanswered',
        comment: '',
        flagged: [],
        quotes: [],
        screenshots: []
      }
    ]
  }
}

const NO_CTX = { before: '', after: '' }

// ---- Marker numbering ----------------------------------------

test('marker numbers are stable chronological ids: max+1, never reused', () => {
  let r = reviewReport()
  r = addReviewQuote(r, 'alpha', NO_CTX, 'ctx')
  r = addReviewQuote(r, 'beta', NO_CTX, 'ctx')
  r = addReviewQuote(r, 'gamma', NO_CTX, 'ctx')
  expect(documentItem(r)!.quotes.map((q) => q.number)).toEqual([1, 2, 3])

  r = removeReviewQuote(r, 2)
  expect(documentItem(r)!.quotes.map((q) => q.number)).toEqual([1, 3])

  // The next quote takes the next number — 2 is never reused.
  r = addReviewQuote(r, 'delta', NO_CTX, 'ctx')
  expect(documentItem(r)!.quotes.map((q) => q.number)).toEqual([1, 3, 4])
})

test('nextMarkerNumber treats legacy entries without numbers as 0', () => {
  expect(nextMarkerNumber([])).toBe(1)
  expect(nextMarkerNumber([{ text: 'x', comment: '' }])).toBe(1)
  expect(nextMarkerNumber([{ text: 'x', comment: '', number: 7 }])).toBe(8)
})

test('addReviewQuote applies the selection trim law and stores the section', () => {
  let r = reviewReport()
  r = addReviewQuote(r, 'ected behaviour works we', { before: 'exp', after: 'll' }, 'plane')
  // Partial edge words snap inward; text continuing both sides → ellipses.
  const q = documentItem(r)!.quotes[0]
  expect(q.text).toBe('…behaviour works…')
  expect(q.section).toBe('plane')
  // A selection that trims to nothing adds no entry at all.
  expect(documentItem(addReviewQuote(reviewReport(), '   ', NO_CTX, null))!.quotes).toHaveLength(0)
})

test('quote comment edits target by number, removal touches no other entry', () => {
  let r = reviewReport()
  r = addReviewQuote(r, 'alpha one', NO_CTX, 'a')
  r = addReviewQuote(r, 'beta two', NO_CTX, 'b')
  r = setReviewQuoteComment(r, 2, 'second')
  expect(documentItem(r)!.quotes.map((q) => q.comment)).toEqual(['', 'second'])
  r = removeReviewQuote(r, 1)
  expect(documentItem(r)!.quotes).toEqual([
    { text: 'beta two', comment: 'second', section: 'b', number: 2 }
  ])
})

// ---- Section marks ----------------------------------------------------------

test('section marks toggle per section and carry their own comment', () => {
  let r = reviewReport()
  r = toggleSectionMark(r, 'roles')
  expect(documentItem(r)!.sectionMarks).toEqual([{ section: 'roles', comment: '' }])
  r = setSectionMarkComment(r, 'roles', 'no worked example')
  expect(documentItem(r)!.sectionMarks![0].comment).toBe('no worked example')
  r = toggleSectionMark(r, 'roles')
  expect(documentItem(r)!.sectionMarks).toEqual([])
})

// ---- Disposition ------------------------------------------------------------

test('disposition follows the v1 toggle law on the document item', () => {
  let r = reviewReport()
  r = setDisposition(r, 'partial')
  expect(documentItem(r)!.status).toBe('partial')
  r = setDisposition(r, 'partial')
  expect(documentItem(r)!.status).toBe('unanswered')
  r = setDisposition(r, 'pass')
  r = setDisposition(r, 'fail')
  expect(documentItem(r)!.status).toBe('fail')
})

// ---- Decision toggles -------------------------------------------------------

test('decision choice upserts by id and toggles off when the same option is re-picked', () => {
  let r = reviewReport()
  r = setDecisionChoice(r, 'layout', 'Adopt the layout?', 'Left')
  expect(documentItem(r)!.decisions).toEqual([
    { id: 'layout', question: 'Adopt the layout?', choice: 'Left' }
  ])
  // A different option replaces the pick.
  r = setDecisionChoice(r, 'layout', 'Adopt the layout?', 'Right')
  expect(documentItem(r)!.decisions![0].choice).toBe('Right')
  // Re-picking the current option clears it (the disposition toggle law).
  r = setDecisionChoice(r, 'layout', 'Adopt the layout?', 'Right')
  expect(documentItem(r)!.decisions![0].choice).toBe('')
})

test('decision comment upserts alongside the pick and keeps both fields', () => {
  let r = reviewReport()
  r = setDecisionComment(r, 'layout', 'Adopt the layout?', 'prefer the wider gutter')
  expect(documentItem(r)!.decisions).toEqual([
    { id: 'layout', question: 'Adopt the layout?', choice: '', comment: 'prefer the wider gutter' }
  ])
  r = setDecisionChoice(r, 'layout', 'Adopt the layout?', 'Approve')
  const d = documentItem(r)!.decisions![0]
  expect(d.choice).toBe('Approve')
  expect(d.comment).toBe('prefer the wider gutter')
})

// ---- Flush at the switch boundary ---------------------------------------

test('flushPendingSave: a dirty pending report FLUSHES on unmount, never cancels', () => {
  const saved: QaReport[] = []
  const dirty = { current: true }
  const report = { current: reviewReport() }
  flushPendingSave(dirty, report, (r) => saved.push(r))
  expect(saved).toEqual([report.current])
  expect(dirty.current).toBe(false)
})

test('flushPendingSave: clean state or a missing report saves nothing', () => {
  const saved: QaReport[] = []
  flushPendingSave({ current: false }, { current: reviewReport() }, (r) => saved.push(r))
  flushPendingSave({ current: true }, { current: null }, (r) => saved.push(r))
  expect(saved).toEqual([])
})

// ---- Containers + anchor resolution ------------------------------------

const BODY = [
  '# Title',
  '',
  'Preamble before any section.',
  '',
  '## Context',
  '',
  'The churn goes into the curated history. The churn returns.',
  '',
  '- first bullet with a needle',
  '  - nested needle',
  '',
  '## Decision',
  '',
  '```',
  'a fenced needle',
  '```'
].join('\n')

function containersOf(body = BODY): ReturnType<typeof textContainers> {
  return textContainers(parseDocBlocks(body))
}

test('textContainers: every text block is addressable and carries its section', () => {
  const cs = containersOf()
  expect(cs.map((c) => [c.path, c.section, c.text])).toEqual([
    ['0', null, 'Title'],
    ['1', null, 'Preamble before any section.'],
    ['2', 'context', 'Context'],
    ['3', 'context', 'The churn goes into the curated history. The churn returns.'],
    ['4.0', 'context', 'first bullet with a needle'],
    ['4.0.0', 'context', 'nested needle'],
    ['5', 'decision', 'Decision'],
    ['6', 'decision', 'a fenced needle']
  ])
})

function quote(number: number, text: string, section: string | null): QuoteEntry {
  return { text, comment: '', section: section ?? undefined, number }
}

test('resolveAnchors: first match within the quote section, offsets exact', () => {
  const anchors = resolveAnchors(containersOf(), [quote(1, 'The churn', 'context')])
  expect(anchors.get(1)).toEqual({ path: '3', start: 0, end: 9 })
})

test('resolveAnchors: an identical later quote claims the next occurrence, never overlapping', () => {
  const anchors = resolveAnchors(containersOf(), [
    quote(1, 'The churn', 'context'),
    quote(2, 'The churn', 'context')
  ])
  expect(anchors.get(1)).toEqual({ path: '3', start: 0, end: 9 })
  expect(anchors.get(2)).toEqual({ path: '3', start: 41, end: 50 })
})

test('resolveAnchors: ellipses are stripped and whitespace differences tolerated', () => {
  const anchors = resolveAnchors(containersOf(), [
    quote(1, '…churn goes into…', 'context'),
    quote(2, 'nested  needle', 'context')
  ])
  expect(anchors.get(1)).toEqual({ path: '3', start: 4, end: 19 })
  expect(anchors.get(2)).toEqual({ path: '4.0.0', start: 0, end: 13 })
})

test('resolveAnchors: section-less preamble quotes and fenced-code quotes anchor too', () => {
  const anchors = resolveAnchors(containersOf(), [
    quote(1, 'Preamble before', null),
    quote(2, 'fenced needle', 'decision')
  ])
  expect(anchors.get(1)).toEqual({ path: '1', start: 0, end: 15 })
  expect(anchors.get(2)).toEqual({ path: '6', start: 2, end: 15 })
})

test('resolveAnchors: no match resolves to null — the heading-fallback signal', () => {
  const anchors = resolveAnchors(containersOf(), [
    quote(1, 'text that was edited away', 'context'),
    quote(2, 'The churn', 'decision') // right text, wrong section — stays in its section
  ])
  expect(anchors.get(1)).toBeNull()
  expect(anchors.get(2)).toBeNull()
})

// ---- Ledger ordering ---------------------------------------------------------

test('orderLedgerEntries: document order, heading fallback at its section, quotes before marks on a tie', () => {
  const cs = containersOf()
  const quotes = [
    quote(3, 'nested needle', 'context'),
    quote(1, 'fenced needle', 'decision'),
    quote(2, 'vanished text', 'context') // fallback → context heading
  ]
  const marks = [
    { section: 'decision', comment: '' },
    { section: 'context', comment: '' }
  ]
  const anchors = resolveAnchors(cs, quotes)
  const keys = orderLedgerEntries(quotes, marks, cs, anchors).map((e) => e.key)
  // The decision mark anchors at its heading, which precedes the fenced code.
  expect(keys).toEqual(['c2', 'sm-context', 'c3', 'sm-decision', 'c1'])
})

// ---- Margin layout maths ------------------------------------------------

test('layoutMarginTops: cards sit at their anchor when free', () => {
  expect(
    layoutMarginTops(
      [
        { anchorTop: 100, height: 60 },
        { anchorTop: 300, height: 40 }
      ],
      50
    )
  ).toEqual([98, 298])
})

test('layoutMarginTops: overlapping cards push down with a visible gap', () => {
  expect(
    layoutMarginTops(
      [
        { anchorTop: 100, height: 60 },
        { anchorTop: 110, height: 40 },
        { anchorTop: 120, height: 30 }
      ],
      50
    )
  ).toEqual([98, 168, 218])
})

test('layoutMarginTops: the first card never rises above the header line', () => {
  expect(layoutMarginTops([{ anchorTop: 4, height: 30 }], 50)).toEqual([50])
})

test('layoutMarginTops: an empty ledger lays out nothing', () => {
  expect(layoutMarginTops([], 50)).toEqual([])
})
