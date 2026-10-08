import { expect, test } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scanQaRepo } from '../scan'
import { emptyReviewReport, finishRun, writeReport } from '../report'

const NOW = () => '2026-07-19T12:00:00.000Z'

const REVIEW = `---
id: review-sharing-plan
title: Sharing plan
kind: doc-review
source: plans/sharing-plan.md
commit: 346dbcc
---

## Motivation

Why the layer exists.

## Open questions

- one
`

// Broken YAML (unquoted multiline intro) but two good items — the salvage case.
const SALVAGED = `---
id: export-check-020
title: Export check
intro: Checks for the export sheet. Work through the
menu flows first.
gate: 4
---

## A
**Steps**
- s
**Expected**
- e

## B
**Steps**
- s
**Expected**
- e
`

test('doc-review + salvaged requests flow through scan with status transitions; fields survive to the snapshot', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-repo-'))
  await mkdir(path.join(root, 'windmill-desktop'), { recursive: true })
  const reviewPath = path.join(root, 'windmill-desktop', '2026-07-19-review-sharing-plan.md')
  await writeFile(reviewPath, REVIEW)
  await writeFile(path.join(root, 'windmill-desktop', '2026-01-19-export-check-0.2.0.md'), SALVAGED)

  // waiting: no report yet
  let { runs } = await scanQaRepo(root)
  const review = () => runs.find((r) => r.request.labels.kind === 'doc-review')!
  expect(review().status).toBe('waiting')
  expect(review().request.degraded).toBe(false)
  expect(review().request.items).toEqual([])
  const salvaged = runs.find((r) => r.request.fmSalvaged)!
  expect(salvaged.request.degraded).toBe(false)
  expect(salvaged.request.items).toHaveLength(2)

  // in-progress: report exists, no stamp
  const report = emptyReviewReport(review().request, NOW)
  await writeReport(reviewPath.replace(/\.md$/, '.report.json'), report)
  ;({ runs } = await scanQaRepo(root))
  expect(review().status).toBe('in-progress')
  expect(review().report?.items[0].id).toBe('document')

  // done: Finish run stamps completedAt
  await writeReport(reviewPath.replace(/\.md$/, '.report.json'), finishRun(report, NOW))
  ;({ runs } = await scanQaRepo(root))
  expect(review().status).toBe('done')

  // QaService embeds runs verbatim (qaService.ts scan()) and IPC structured-clones
  // them — prove nothing new gets stripped on the way to the renderer.
  const wired = JSON.parse(JSON.stringify(runs)) as typeof runs
  const wiredReview = wired.find((r) => r.request.labels.kind === 'doc-review')!
  expect(wiredReview.request.document?.headings.map((h) => h.id)).toEqual([
    'motivation',
    'open-questions'
  ])
  expect(wiredReview.request.document?.bodyMarkdown).toContain('Why the layer exists.')
  expect(wired.find((r) => r.request.fmSalvaged)).toBeTruthy()
})
