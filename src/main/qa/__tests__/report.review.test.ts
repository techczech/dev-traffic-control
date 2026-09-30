import { expect, test } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseRequest } from '../parseRequest'
import {
  emptyReviewReport,
  finishRun,
  newReport,
  readReport,
  reconcile,
  reopenRun,
  runStatus,
  writeReport
} from '../report'

const NOW = () => '2026-07-19T12:00:00.000Z'

const REVIEW_REQ = parseRequest(
  `---
id: review-skills-prd
title: Skills layer PRD
app: WordForge
kind: doc-review
source: docs/plans/skills-prd.md
commit: 346dbcc
---

## Motivation

Why the layer exists.

## Open questions

- one
`,
  '/qa/wordforge-desktop/2026-07-19-review-skills-prd.md'
)

const TEST_REQ = parseRequest(
  `---
id: r1
title: Run one
---
## Alpha
**Steps**
- s
**Expected**
- e
`,
  '/qa/p/2026-07-19-run.md'
)

test('emptyReviewReport: the document is one unanswered item', () => {
  const r = emptyReviewReport(REVIEW_REQ, NOW)
  expect(r.id).toBe('review-skills-prd')
  expect(r.startedAt).toBe(NOW())
  expect(r.items).toHaveLength(1)
  expect(r.items[0]).toEqual({
    id: 'document',
    title: 'Skills layer PRD',
    status: 'unanswered',
    comment: '',
    flagged: [],
    quotes: [],
    screenshots: []
  })
  expect('sectionMarks' in r.items[0]).toBe(false)
})

test('sectioned quotes + sectionMarks round-trip save/load/reconcile intact, stable order', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  const p = path.join(dir, 'x.report.json')
  const r = emptyReviewReport(REVIEW_REQ, NOW)
  r.items[0].status = 'partial' // Approve with changes
  r.items[0].quotes = [
    { text: 'Why the layer exists.', comment: 'motivation is thin', section: 'motivation' },
    { text: 'one', comment: 'answer this first', section: 'open-questions' }
  ]
  r.items[0].sectionMarks = [{ section: 'open-questions', comment: 'restructure as a table' }]
  await writeReport(p, r)
  const back = await readReport(p)
  expect(back?.items[0].quotes).toEqual(r.items[0].quotes)
  expect(back?.items[0].sectionMarks).toEqual(r.items[0].sectionMarks)
  const merged = reconcile(REVIEW_REQ, back!)
  const doc = merged.items.find((i) => i.id === 'document')
  expect(doc?.quotes).toEqual(r.items[0].quotes)
  expect(doc?.sectionMarks).toEqual(r.items[0].sectionMarks)
  expect(doc?.status).toBe('partial')
  // The doc-review branch reconciles against the synthetic 'document'
  // skeleton, never the request's empty items list.
  expect(doc?.removed).toBeUndefined()
  expect(merged.items).toHaveLength(1)
})

test('old-shape test-run report untouched by (de)serialisation — no new keys appear', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  const p = path.join(dir, 'x.report.json')
  const r = newReport(TEST_REQ, NOW)
  r.items[0].status = 'pass'
  r.items[0].quotes = [{ text: 'e', comment: 'fine' }]
  await writeReport(p, r)
  const back = await readReport(p)
  expect(back).toEqual(r)
  expect('sectionMarks' in back!.items[0]).toBe(false)
  expect('section' in back!.items[0].quotes[0]).toBe(false)
})

test('finishRun/reopenRun and the empty-over-nonempty guard behave unchanged on a review report', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  const p = path.join(dir, 'x.report.json')
  const r = emptyReviewReport(REVIEW_REQ, NOW)
  r.items[0].status = 'skip' // Not reviewed
  await writeReport(p, r)
  const done = finishRun(r, NOW)
  expect(done.completedAt).toBe(NOW())
  expect(runStatus(done)).toBe('done')
  expect(runStatus(reopenRun(done))).toBe('in-progress')
  await expect(writeReport(p, { ...r, items: [] })).rejects.toThrow(/refusing/i)
})
