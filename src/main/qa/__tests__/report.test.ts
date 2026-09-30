import { expect, test } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
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
  reportPathFor,
  runStatus,
  writeReport,
  writeReopenedReport
} from '../report'

const NOW = (): string => '2026-07-18T12:00:00.000Z'
const REQ = parseRequest(
  `---
id: r1
title: Run one
---
## Alpha
**Steps**
- s
**Expected**
- e1
- e2

## Beta
**Steps**
- s
**Expected**
- e
`,
  '/qa/p/2026-07-18-run.md'
)

test('reportPathFor swaps extension', () => {
  expect(reportPathFor('/qa/p/2026-07-18-run.md')).toBe('/qa/p/2026-07-18-run.report.json')
})

test('newReport: one unanswered item per request item', () => {
  const r = newReport(REQ, NOW)
  expect(r.items.map((i) => i.status)).toEqual(['unanswered', 'unanswered'])
  expect(r.startedAt).toBe(NOW())
  expect(r.completedAt).toBeUndefined()
})

test('newReport: a light request is stamped and parked items never become report items', () => {
  const req = parseRequest(
    `---
id: light
title: Light run
---
## Main check
Try the main check.

## Also worth checking
- Optional check
`,
    '/qa/p/light.md'
  )
  const r = newReport(req, NOW)

  expect(r.mode).toBe('light')
  expect(r.items.map((item) => item.id)).toEqual(['main-check'])
  expect(r.items.some((item) => item.id.startsWith('also-'))).toBe(false)
})

test('round-trips through disk atomically', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  const p = path.join(dir, 'x.report.json')
  const r = newReport(REQ, NOW)
  r.items[0].status = 'partial'
  r.items[0].flagged = [{ expectedIndex: 1, text: 'e2', comment: 'four seconds' }]
  await writeReport(p, r)
  const back = await readReport(p)
  expect(back?.items[0].flagged[0]).toEqual({
    expectedIndex: 1,
    text: 'e2',
    comment: 'four seconds'
  })
})

test('readReport: missing → null; corrupt JSON is rejected', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  expect(await readReport(path.join(dir, 'nope.report.json'))).toBeNull()
  const bad = path.join(dir, 'bad.report.json')
  await writeFile(bad, '{not json')
  await expect(readReport(bad)).rejects.toThrow(/not valid json/i)
})

test('readReport rejects valid JSON that is not a QaReport', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  const malformed = path.join(dir, 'malformed.report.json')
  await writeFile(
    malformed,
    JSON.stringify({ id: 'x', title: 'Missing items', startedAt: 'now', noteFiles: [] })
  )

  await expect(readReport(malformed)).rejects.toThrow(/items/i)
})

test('writeReport rejects a renderer object that is not a QaReport', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  const malformed = {
    id: 'x',
    title: 'Missing items',
    startedAt: 'now',
    noteFiles: []
  } as never

  await expect(writeReport(path.join(dir, 'malformed.report.json'), malformed)).rejects.toThrow(
    /items/i
  )
})

test('empty-over-nonempty guard: refuses to clobber answers with an empty report', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  const p = path.join(dir, 'x.report.json')
  const full = newReport(REQ, NOW)
  full.items[0].status = 'pass'
  await writeReport(p, full)
  await expect(writeReport(p, { ...full, items: [] })).rejects.toThrow(/refusing/i)
  expect((await readReport(p))?.items).toHaveLength(2)
})

test('writeReport saves observations on a zero-item report but still refuses to flatten items', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  const emptyPath = path.join(dir, 'empty.report.json')
  const empty = { ...newReport({ ...REQ, items: [] }, NOW), items: [] }
  await writeReport(emptyPath, empty)

  const observed = {
    ...empty,
    observations: [{ id: 'obs-1', text: 'The export dialog was slow.', screenshots: [] }]
  }
  await writeReport(emptyPath, observed)
  expect((await readReport(emptyPath))?.observations).toEqual(observed.observations)

  const fullPath = path.join(dir, 'full.report.json')
  const full = newReport(REQ, NOW)
  await writeReport(fullPath, full)
  await expect(writeReport(fullPath, empty)).rejects.toThrow(/refusing/i)
  await expect(writeReport(fullPath, observed)).rejects.toThrow(/refusing/i)
  expect((await readReport(fullPath))?.items).toHaveLength(2)
})

test('writeReport never lets an unstamped autosave overwrite a completed report', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-'))
  const p = path.join(dir, 'completed.report.json')
  const inProgress = newReport(REQ, NOW)
  const completed = finishRun(inProgress, NOW)
  await writeReport(p, completed)

  await expect(writeReport(p, inProgress)).rejects.toThrow(
    /refusing to overwrite completed report/i
  )
  expect((await readReport(p))?.completedAt).toBe(NOW())

  const reopened = reopenRun(completed)
  await writeReopenedReport(p, reopened)
  expect((await readReport(p))?.completedAt).toBeUndefined()
})

test('reconcile: verdicts survive by id, new items unanswered, gone items flagged removed', () => {
  const old = newReport(REQ, NOW)
  old.items[0].status = 'fail'
  old.items[0].comment = 'broken'
  const regenerated = parseRequest(
    `---
id: r1
title: Run one v2
---
## Alpha
**Steps**
- s
**Expected**
- e1
## Gamma
**Steps**
- s
**Expected**
- e
`,
    '/qa/p/2026-07-18-run.md'
  )
  const merged = reconcile(regenerated, old)
  expect(merged.items.find((i) => i.id === 'alpha')?.status).toBe('fail')
  expect(merged.items.find((i) => i.id === 'gamma')?.status).toBe('unanswered')
  const beta = merged.items.find((i) => i.id === 'beta')
  expect(beta?.removed).toBe(true)
  expect(beta?.status).toBe('unanswered') // was never answered
})

test('reconcile keeps an answered parked item and marks a genuinely vanished item removed', () => {
  const old = newReport(REQ, NOW)
  old.items[0].status = 'fail'
  old.items.push({
    id: 'also-optional-check',
    title: 'Optional check',
    status: 'pass',
    comment: '',
    flagged: [],
    quotes: [],
    screenshots: []
  })
  const regenerated = parseRequest(
    `---
id: r1
title: Run one v2
---
## Beta
Try beta.

## Also worth checking
- Optional check
`,
    '/qa/p/2026-07-18-run.md'
  )

  const merged = reconcile(regenerated, old)
  const parked = merged.items.find((item) => item.id === 'also-optional-check')
  expect(parked?.status).toBe('pass')
  expect(parked?.removed).toBeUndefined()
  expect(merged.items.find((item) => item.id === 'alpha')?.removed).toBe(true)
})

test('reconcile uses normalised doc-review mode despite kind label casing', () => {
  const request = {
    ...REQ,
    title: 'Document review',
    mode: 'doc-review' as const,
    labels: { kind: 'Doc-Review' },
    items: [],
    document: { headings: [], bodyMarkdown: '# Document review' }
  }
  const old = emptyReviewReport(request, NOW)
  old.items[0].status = 'partial'

  const merged = reconcile(request, old)

  expect(merged.items).toHaveLength(1)
  expect(merged.items[0]).toMatchObject({
    id: 'document',
    status: 'partial',
    removed: undefined
  })
})

test('reconcile preserves run-level observations untouched', () => {
  const old = {
    ...newReport(REQ, NOW),
    observations: [
      { id: 'obs-3', text: 'A separate rough edge.', screenshots: ['run.shots/obs-3-1.png'] }
    ]
  }

  const merged = reconcile(REQ, old)
  expect(merged.observations).toBe(old.observations)
})

test('finish/reopen stamp lifecycle and derived status', () => {
  const r = newReport(REQ, NOW)
  expect(runStatus(null)).toBe('waiting')
  expect(runStatus(r)).toBe('in-progress')
  const done = finishRun(r, NOW)
  expect(done.completedAt).toBe(NOW())
  expect(runStatus(done)).toBe('done')
  expect(runStatus(reopenRun(done))).toBe('in-progress')
})
