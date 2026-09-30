import { expect, test } from 'vitest'
import { parseRequest } from '../../../../main/qa/parseRequest'
import { newReport } from '../../../../main/qa/report'
import type { QaReport, QaRequest } from '../../../../main/qa/types'
import {
  addObservation,
  addObservationScreenshot,
  addQuote,
  addScreenshot,
  answeredCount,
  applyVerdict,
  ensureItem,
  firstUnansweredId,
  linkNoteFile,
  markUnansweredWorks,
  nextObservationId,
  removeObservation,
  removeObservationScreenshot,
  removeQuote,
  removeScreenshot,
  setComment,
  setFlagComment,
  setObservationText,
  setQuoteComment,
  toggleFlag,
  trimSelection
} from '../runnerState'

const NOW = (): string => '2026-07-18T12:00:00.000Z'

function fixture(): { req: QaRequest; report: QaReport } {
  const req = parseRequest(
    `---
id: r1
title: Run one
---
## Alpha
**Steps**
- Open the title
**Expected**
- Title occupies the **right 70%**
- Sidebar carries only the logo

## Beta
**Steps**
- s
**Expected**
- e
`,
    '/qa/p/2026-07-18-run.md'
  )
  return { req, report: newReport(req, NOW) }
}

test('applyVerdict toggles off when the same verdict is re-applied', () => {
  const { report } = fixture()
  const passed = applyVerdict(report, 'alpha', 'pass')
  expect(passed.items[0].status).toBe('pass')
  const toggled = applyVerdict(passed, 'alpha', 'pass')
  expect(toggled.items[0].status).toBe('unanswered')
})

test('switching partial → fail keeps the flags (data survives the verdict change)', () => {
  const { req, report } = fixture()
  let r = applyVerdict(report, 'alpha', 'partial')
  r = toggleFlag(r, req, 'alpha', 0)
  expect(r.items[0].flagged).toHaveLength(1)
  const failed = applyVerdict(r, 'alpha', 'fail')
  expect(failed.items[0].status).toBe('fail')
  expect(failed.items[0].flagged).toHaveLength(1)
})

test('leaving partial/fail to pass keeps the flags in the report (UI hides them)', () => {
  const { req, report } = fixture()
  let r = applyVerdict(report, 'alpha', 'fail')
  r = toggleFlag(r, req, 'alpha', 1)
  const passed = applyVerdict(r, 'alpha', 'pass')
  expect(passed.items[0].flagged).toHaveLength(1)
})

test('toggleFlag stores the full bullet text and round-trips add/remove, losing the comment on unflag', () => {
  const { req, report } = fixture()
  let r = applyVerdict(report, 'alpha', 'partial')
  r = toggleFlag(r, req, 'alpha', 0)
  expect(r.items[0].flagged[0]).toEqual({
    expectedIndex: 0,
    text: 'Title occupies the **right 70%**',
    comment: ''
  })
  r = setFlagComment(r, 'alpha', 0, 'too wide')
  expect(r.items[0].flagged[0].comment).toBe('too wide')
  r = toggleFlag(r, req, 'alpha', 0) // unflag — comment is lost with the block
  expect(r.items[0].flagged).toHaveLength(0)
  r = toggleFlag(r, req, 'alpha', 0) // re-flag — comment starts empty again
  expect(r.items[0].flagged[0].comment).toBe('')
})

test('flags stay sorted by expectedIndex', () => {
  const { req, report } = fixture()
  let r = applyVerdict(report, 'alpha', 'partial')
  r = toggleFlag(r, req, 'alpha', 1)
  r = toggleFlag(r, req, 'alpha', 0)
  expect(r.items[0].flagged.map((f) => f.expectedIndex)).toEqual([0, 1])
})

test('addQuote runs the raw selection through trimSelection', () => {
  const { report } = fixture()
  const r = addQuote(report, 'alpha', 'pen the title', { before: 'O', after: '' })
  expect(r.items[0].quotes[0]).toEqual({ text: '…the title', comment: '' })
})

test('addQuote ignores whitespace-only selections', () => {
  const { report } = fixture()
  const r = addQuote(report, 'alpha', '   ', { before: '', after: '' })
  expect(r.items[0].quotes).toHaveLength(0)
})

test('quote and comment setters are immutable — the input report is untouched', () => {
  const { report } = fixture()
  const withQuote = addQuote(report, 'alpha', 'hello world', { before: '', after: '' })
  const commented = setQuoteComment(withQuote, 'alpha', 0, 'note')
  expect(withQuote.items[0].quotes[0].comment).toBe('') // original object untouched
  expect(commented.items[0].quotes[0].comment).toBe('note')
  expect(commented).not.toBe(withQuote)
  expect(commented.items[0]).not.toBe(withQuote.items[0])
})

test('setComment sets the general per-item comment', () => {
  const { report } = fixture()
  const r = setComment(report, 'beta', 'looks good')
  expect(r.items[1].comment).toBe('looks good')
  expect(report.items[1].comment).toBe('') // immutable
})

test('removeQuote drops a quote block with its comment', () => {
  const { report } = fixture()
  let r = addQuote(report, 'alpha', 'one two', { before: '', after: '' })
  r = addQuote(r, 'alpha', 'three four', { before: '', after: '' })
  r = removeQuote(r, 'alpha', 0)
  expect(r.items[0].quotes.map((q) => q.text)).toEqual(['three four'])
})

test('screenshots add without duplicates and remove by path', () => {
  const { report } = fixture()
  let r = addScreenshot(report, 'alpha', 'run.shots/alpha-1.png')
  r = addScreenshot(r, 'alpha', 'run.shots/alpha-1.png') // duplicate ignored
  expect(r.items[0].screenshots).toEqual(['run.shots/alpha-1.png'])
  r = removeScreenshot(r, 'alpha', 'run.shots/alpha-1.png')
  expect(r.items[0].screenshots).toEqual([])
})

test('linkNoteFile records a note path once', () => {
  const { report } = fixture()
  let r = linkNoteFile(report, '2026-07-18-note-x.md')
  r = linkNoteFile(r, '2026-07-18-note-x.md')
  expect(r.noteFiles).toEqual(['2026-07-18-note-x.md'])
})

test('answeredCount and firstUnansweredId track progress, skipping removed items', () => {
  const { report } = fixture()
  expect(answeredCount(report)).toBe(0)
  expect(firstUnansweredId(report)).toBe('alpha')
  const r = applyVerdict(report, 'alpha', 'pass')
  expect(answeredCount(r)).toBe(1)
  expect(firstUnansweredId(r)).toBe('beta')
  const done = applyVerdict(r, 'beta', 'skip')
  expect(answeredCount(done)).toBe(2)
  expect(firstUnansweredId(done)).toBeNull()
})

test('removed items are excluded from counts and resume targeting', () => {
  const { report } = fixture()
  const withRemoved: QaReport = {
    ...report,
    items: [
      { ...report.items[0], status: 'pass' },
      { ...report.items[1], status: 'fail', removed: true }
    ]
  }
  expect(answeredCount(withRemoved)).toBe(1)
  expect(firstUnansweredId(withRemoved)).toBeNull()
})

test('ensureItem appends one blank report item and is idempotent', () => {
  const { report } = fixture()
  const added = ensureItem(report, 'also-export-sheet', 'Try the export sheet')
  expect(added.items.at(-1)).toEqual({
    id: 'also-export-sheet',
    title: 'Try the export sheet',
    status: 'unanswered',
    comment: '',
    flagged: [],
    quotes: [],
    screenshots: []
  })
  expect(ensureItem(added, 'also-export-sheet', 'Different title')).toBe(added)
  expect(report.items).toHaveLength(2)
})

test('nextObservationId honours both the high-water mark and surviving observation ids', () => {
  const { report } = fixture()
  expect(nextObservationId(report)).toBe('obs-1')
  expect(
    nextObservationId({
      ...report,
      observationSeq: 4,
      observations: [
        { id: 'obs-2', text: '', screenshots: [] },
        { id: 'obs-7', text: '', screenshots: [] },
        { id: 'hand-written', text: '', screenshots: [] }
      ]
    })
  ).toBe('obs-8')
})

test('addObservation records its id in observationSeq so removing the highest id never reuses it', () => {
  const { report } = fixture()
  const first = addObservation(report)
  const second = addObservation(first)
  expect(second.observationSeq).toBe(2)
  expect(second.observations?.map((observation) => observation.id)).toEqual(['obs-1', 'obs-2'])

  const removed = removeObservation(second, 'obs-2')
  const third = addObservation(removed)
  expect(third.observationSeq).toBe(3)
  expect(third.observations?.map((observation) => observation.id)).toEqual(['obs-1', 'obs-3'])
})

test('setObservationText updates only the named observation without mutating the report', () => {
  const { report } = fixture()
  const added = addObservation(addObservation(report))
  const changed = setObservationText(added, 'obs-2', 'The first open felt slow.')
  expect(changed.observations?.map((observation) => observation.text)).toEqual([
    '',
    'The first open felt slow.'
  ])
  expect(added.observations?.[1].text).toBe('')
  expect(setObservationText(changed, 'missing', 'ignored')).toBe(changed)
})

test('observation screenshots add idempotently and remove by path', () => {
  const { report } = fixture()
  let changed = addObservation(report)
  changed = addObservationScreenshot(changed, 'obs-1', 'run.shots/obs-1-1.png')
  const duplicate = addObservationScreenshot(changed, 'obs-1', 'run.shots/obs-1-1.png')
  expect(duplicate).toBe(changed)
  expect(duplicate.observations?.[0].screenshots).toEqual(['run.shots/obs-1-1.png'])

  const removed = removeObservationScreenshot(duplicate, 'obs-1', 'run.shots/obs-1-1.png')
  expect(removed.observations?.[0].screenshots).toEqual([])
})

test('removeObservation drops only the named observation', () => {
  const { report } = fixture()
  const added = addObservation(addObservation(report))
  const removed = removeObservation(added, 'obs-1')
  expect(removed.observations?.map((observation) => observation.id)).toEqual(['obs-2'])
  expect(removeObservation(removed, 'missing')).toBe(removed)
})

test('markUnansweredWorks passes eligible items without touching verdicts, removed or excluded items', () => {
  const { report } = fixture()
  const withParked = ensureItem(report, 'also-export-sheet', 'Try the export sheet')
  const prepared: QaReport = {
    ...withParked,
    items: [
      { ...withParked.items[0], status: 'fail' },
      { ...withParked.items[1], removed: true },
      withParked.items[2]
    ]
  }
  const changed = markUnansweredWorks(prepared, new Set(['also-export-sheet']))
  expect(changed.items.map((item) => item.status)).toEqual(['fail', 'unanswered', 'unanswered'])

  const eligible: QaReport = {
    ...prepared,
    items: prepared.items.map((item, index) => (index === 1 ? { ...item, removed: false } : item))
  }
  expect(markUnansweredWorks(eligible, new Set(['also-export-sheet'])).items[1].status).toBe('pass')
})

// --- trimSelection: word-boundary snap + honest ellipses (ADR-0006 taste rule 4) ---

test('trimSelection: a clean full-bullet selection carries no ellipses', () => {
  expect(trimSelection('Title occupies the right 70%', '', '')).toBe('Title occupies the right 70%')
})

test('trimSelection: mid-word start snaps inward and gains a leading ellipsis', () => {
  // "Open the title", selection begins inside "Open" → before ends in a word char.
  expect(trimSelection('pen the title', 'O', '')).toBe('…the title')
})

test('trimSelection: mid-word at both ends snaps both and carries both ellipses', () => {
  // "Open the titles" → select "pen the title" from "O|pen … title|s".
  expect(trimSelection('pen the title', 'O', 's')).toBe('…the…')
})

test('trimSelection: text after a clean word boundary still adds a trailing ellipsis', () => {
  // selection is a whole word but more of the bullet follows it.
  expect(trimSelection('Title', '', ' occupies the right 70%')).toBe('Title…')
})

test('trimSelection: leading ellipsis iff real text precedes the snapped selection', () => {
  expect(trimSelection('the title', 'Open ', '')).toBe('…the title')
})

test('trimSelection: whitespace-only selection collapses to empty', () => {
  expect(trimSelection('   ', 'x', 'y')).toBe('')
})

test('trimSelection: internal whitespace is normalised to single spaces', () => {
  expect(trimSelection('a   b\n c', '', '')).toBe('a b c')
})
