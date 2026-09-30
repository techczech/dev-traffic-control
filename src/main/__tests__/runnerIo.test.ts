import { afterEach, expect, test, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const reportWriteControl = vi.hoisted(() => ({
  failure: null as Error | null
}))

vi.mock('../qa/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../qa/report')>()
  return {
    ...actual,
    writeReport: async (...args: Parameters<typeof actual.writeReport>): Promise<void> => {
      if (reportWriteControl.failure) {
        const failure = reportWriteControl.failure
        reportWriteControl.failure = null
        throw failure
      }
      return actual.writeReport(...args)
    }
  }
})

import {
  openRun,
  save,
  finish,
  reopen,
  setAsideCorruptReport,
  recoverCorruptReport,
  storeShot,
  readShotDataUrl
} from '../runnerIo'
import { reportPathFor } from '../qa/report'
import type { QaReport } from '../qa/types'

const NOW = (): string => '2026-07-18T12:00:00.000Z'
const LATER = (): string => '2026-07-18T13:30:00.000Z'
const tempDirs: string[] = []

const REQUEST = `---
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
`

async function tempRequest(body = REQUEST): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-runio-'))
  tempDirs.push(dir)
  const p = path.join(dir, '2026-07-18-run.md')
  await writeFile(p, body)
  return p
}

afterEach(async () => {
  reportWriteControl.failure = null
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('openRun without a report: fresh report, exists false, no file written', async () => {
  const reqPath = await tempRequest()
  const { request, report, exists } = await openRun(reqPath, NOW)
  expect(exists).toBe(false)
  expect(request.title).toBe('Run one')
  expect(report.startedAt).toBe(NOW())
  expect(report.items.map((i) => i.status)).toEqual(['unanswered', 'unanswered'])
  // Opening must never create the report file (ADR-0003 lazy create).
  expect(existsSync(reportPathFor(reqPath))).toBe(false)
})

test('a corrupt report opens as recoverable state and can be set aside without data loss', async () => {
  const reqPath = await tempRequest()
  const reportPath = reportPathFor(reqPath)
  const corruptBytes = '{\n<<<<<<< HEAD\n'
  await writeFile(reportPath, corruptBytes)

  const opened = await openRun(reqPath, NOW)
  expect(opened.corruptReport?.path).toBe(reportPath)
  expect(opened.corruptReport?.message).toMatch(/could not read/i)

  const backup = await setAsideCorruptReport(reqPath, () => '2026-08-01T12:34:56.789Z')
  expect(backup).toMatch(/\.report\.corrupt-20260801T123456789\.json$/)
  expect(await readFile(backup, 'utf8')).toBe(corruptBytes)
  expect(existsSync(reportPath)).toBe(false)

  const fresh = await openRun(reqPath, NOW)
  expect(fresh.corruptReport).toBeUndefined()
  expect(fresh.exists).toBe(false)
})

test('openRun with a report: reconciles by id, keeps verdicts, flags vanished items removed', async () => {
  const reqPath = await tempRequest()
  const first = await openRun(reqPath, NOW)
  first.report.items[0].status = 'fail'
  first.report.items[0].comment = 'broken'
  await save(reqPath, first.report)

  // Regenerate the request: Alpha stays, Beta gone, Gamma new.
  await writeFile(
    reqPath,
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
`
  )
  const { report, exists } = await openRun(reqPath, NOW)
  expect(exists).toBe(true)
  expect(report.items.find((i) => i.id === 'alpha')?.status).toBe('fail')
  expect(report.items.find((i) => i.id === 'gamma')?.status).toBe('unanswered')
  const beta = report.items.find((i) => i.id === 'beta')
  expect(beta?.removed).toBe(true)
})

const REVIEW_REQUEST = `---
id: rev1
title: Review one
kind: doc-review
source: docs/adr/0001-example.md
commit: abc1234
---
# The document

## Context

Some context prose.
`

test('openRun on a doc-review without a report: single document item, no file written', async () => {
  const reqPath = await tempRequest(REVIEW_REQUEST)
  const { request, report, exists } = await openRun(reqPath, NOW)
  expect(exists).toBe(false)
  expect(request.document?.headings.map((h) => h.id)).toEqual(['context'])
  expect(report.items).toHaveLength(1)
  expect(report.items[0].id).toBe('document')
  expect(report.items[0].title).toBe('Review one')
  expect(report.items[0].status).toBe('unanswered')
  expect(existsSync(reportPathFor(reqPath))).toBe(false)
})

test('openRun uses normalised mode when the doc-review kind has mixed case', async () => {
  const reqPath = await tempRequest(REVIEW_REQUEST.replace('kind: doc-review', 'kind: Doc-Review'))
  const { request, report } = await openRun(reqPath, NOW)
  expect(request.mode).toBe('doc-review')
  expect(request.labels.kind).toBe('Doc-Review')
  expect(report.items.map((item) => item.id)).toEqual(['document'])
})

test('openRun on a doc-review with a report: document item survives reconcile, never removed', async () => {
  const reqPath = await tempRequest(REVIEW_REQUEST)
  const first = await openRun(reqPath, NOW)
  first.report.items[0].status = 'partial'
  first.report.items[0].quotes.push({
    text: 'Some context',
    comment: 'why',
    section: 'context',
    number: 1
  })
  await save(reqPath, first.report)
  const { report, exists } = await openRun(reqPath, NOW)
  expect(exists).toBe(true)
  expect(report.items).toHaveLength(1)
  expect(report.items[0].removed).toBeUndefined()
  expect(report.items[0].status).toBe('partial')
  expect(report.items[0].quotes[0].number).toBe(1)
})

test('finish stamps completedAt with the injected now and persists', async () => {
  const reqPath = await tempRequest()
  const { report } = await openRun(reqPath, NOW)
  const stamped = await finish(reqPath, report, LATER)
  expect(stamped.completedAt).toBe(LATER())
  const onDisk = JSON.parse(await readFile(reportPathFor(reqPath), 'utf8'))
  expect(onDisk.completedAt).toBe(LATER())
})

test('reopen clears the stamp and persists', async () => {
  const reqPath = await tempRequest()
  const { report } = await openRun(reqPath, NOW)
  await finish(reqPath, report, LATER)
  const cleared = await reopen(reqPath)
  expect(cleared.completedAt).toBeUndefined()
  const onDisk = JSON.parse(await readFile(reportPathFor(reqPath), 'utf8'))
  expect(onDisk.completedAt).toBeUndefined()
})

test('reopen without a report throws', async () => {
  const reqPath = await tempRequest()
  await expect(reopen(reqPath)).rejects.toThrow(/no report/i)
})

test('ordinary report mutations refuse an invalid on-disk report and name the recovery route', async () => {
  const reqPath = await tempRequest()
  const reportPath = reportPathFor(reqPath)
  const { report } = await openRun(reqPath, NOW)
  const corrupt = '{"items":'
  await writeFile(reportPath, corrupt)

  for (const mutation of [
    () => save(reqPath, report),
    () => finish(reqPath, report, LATER),
    () => reopen(reqPath)
  ]) {
    await expect(mutation()).rejects.toThrow(/set aside and start fresh/i)
    expect(await readFile(reportPath, 'utf8')).toBe(corrupt)
  }
})

test('mid-run recovery sets aside corrupt bytes and writes the in-memory report fresh', async () => {
  const reqPath = await tempRequest()
  const reportPath = reportPathFor(reqPath)
  const { report } = await openRun(reqPath, NOW)
  report.items[0].status = 'fail'
  report.items[0].comment = 'My in-memory finding'
  const corrupt = '{\n<<<<<<< agent\n'
  await writeFile(reportPath, corrupt)

  const backup = await recoverCorruptReport(reqPath, report, () => '2026-08-01T12:34:56.789Z')

  expect(await readFile(backup, 'utf8')).toBe(corrupt)
  const saved = JSON.parse(await readFile(reportPath, 'utf8')) as QaReport
  expect(saved.items[0]).toMatchObject({ status: 'fail', comment: 'My in-memory finding' })
})

test('mid-run recovery remains ordered after a refused queued save', async () => {
  const reqPath = await tempRequest()
  const reportPath = reportPathFor(reqPath)
  const { report } = await openRun(reqPath, NOW)
  report.items[0].comment = 'Preserve this answer'
  const corrupt = '{"items":'
  await writeFile(reportPath, corrupt)

  await expect(save(reqPath, report)).rejects.toThrow(/set aside and start fresh/i)
  const backup = await recoverCorruptReport(reqPath, report, () => '2026-08-01T13:00:00.000Z')

  expect(await readFile(backup, 'utf8')).toBe(corrupt)
  expect(JSON.parse(await readFile(reportPath, 'utf8')).items[0].comment).toBe(
    'Preserve this answer'
  )
})

test('a failed fresh write reports that the damaged report was already set aside', async () => {
  const reqPath = await tempRequest()
  const reportPath = reportPathFor(reqPath)
  const { report } = await openRun(reqPath, NOW)
  report.items[0].comment = 'Keep this in memory'
  const corrupt = '{\n<<<<<<< agent\n'
  await writeFile(reportPath, corrupt)
  reportWriteControl.failure = new Error('disk full')

  await expect(
    recoverCorruptReport(reqPath, report, () => '2026-08-01T14:00:00.000Z')
  ).rejects.toThrow(
    /damaged report was set aside to .*\.report\.corrupt-20260801T140000000\.json.*no new report exists yet/i
  )

  expect(existsSync(reportPath)).toBe(false)
  const backup = (await readdir(path.dirname(reportPath))).find((name) =>
    name.includes('.report.corrupt-20260801T140000000.json')
  )
  expect(backup).toBeTruthy()
  expect(await readFile(path.join(path.dirname(reportPath), backup!), 'utf8')).toBe(corrupt)

  await save(reqPath, report)
  expect(JSON.parse(await readFile(reportPath, 'utf8')).items[0].comment).toBe(
    'Keep this in memory'
  )
})

test('storeShot names sequentially and returns a run-folder-relative path', async () => {
  const reqPath = await tempRequest()
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const rel1 = await storeShot(path.dirname(reqPath), reqPath, 'alpha', png)
  const rel2 = await storeShot(path.dirname(reqPath), reqPath, 'alpha', png)
  expect(rel1).toBe(path.join('2026-07-18-run.shots', 'alpha-1.png'))
  expect(rel2).toBe(path.join('2026-07-18-run.shots', 'alpha-2.png'))
  const dir = path.join(path.dirname(reqPath), '2026-07-18-run.shots')
  expect((await readdir(dir)).sort()).toEqual(['alpha-1.png', 'alpha-2.png'])
})

test("storeShot accepts only the request's own item ids and never writes outside the run folder", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'qa-runio-shot-id-'))
  tempDirs.push(parent)
  const root = path.join(parent, '_REC')
  const reqPath = path.join(root, 'demo', 'round-1', '2026-07-18-run.md')
  await mkdir(path.dirname(reqPath), { recursive: true })
  await writeFile(reqPath, REQUEST)
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  for (const itemId of ['../../../escaped', '../../escaped', 'gamma', 'a.b', '.*', 42]) {
    await expect(storeShot(root, reqPath, itemId, png)).rejects.toThrow()
  }
  expect(await readdir(parent)).toEqual(['_REC'])
  expect(await readdir(path.join(root, 'demo'))).toEqual(['round-1'])
  expect(await readdir(path.dirname(reqPath))).toEqual(['2026-07-18-run.md'])

  expect(await storeShot(root, reqPath, 'beta', png)).toBe(
    path.join('2026-07-18-run.shots', 'beta-1.png')
  )
  expect(await storeShot(root, reqPath, 'obs-3', png)).toBe(
    path.join('2026-07-18-run.shots', 'obs-3-1.png')
  )
})

test('storeShot refuses a symlinked shots folder, outside the root or within it', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'qa-runio-shot-dir-'))
  tempDirs.push(parent)
  const root = path.join(parent, '_REC')
  const outside = path.join(parent, 'elsewhere')
  const reqPath = path.join(root, 'demo', '2026-07-18-run.md')
  await mkdir(path.dirname(reqPath), { recursive: true })
  await mkdir(outside)
  await writeFile(reqPath, REQUEST)
  const shots = path.join(root, 'demo', '2026-07-18-run.shots')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  await symlink(outside, shots)
  await expect(storeShot(root, reqPath, 'alpha', png)).rejects.toThrow(/outside the record root/)
  expect(await readdir(outside)).toEqual([])

  await rm(shots)
  const inside = path.join(root, 'demo', 'other')
  await mkdir(inside)
  await symlink(inside, shots)
  await expect(storeShot(root, reqPath, 'alpha', png)).rejects.toThrow(/outside the record root/)
  expect(await readdir(inside)).toEqual([])
})

test('a doc-review request takes its single document screenshot target', async () => {
  const reqPath = await tempRequest(REVIEW_REQUEST)
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  expect(await storeShot(path.dirname(reqPath), reqPath, 'document', png)).toMatch(
    /document-1\.png$/
  )
})

test('readShotDataUrl keeps the PNG screenshot data URL unchanged', async () => {
  const reqPath = await tempRequest()
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7])
  const rel = await storeShot(path.dirname(reqPath), reqPath, 'alpha', png)
  const url = await readShotDataUrl(reqPath, rel)
  expect(url).toBe(`data:image/png;base64,${png.toString('base64')}`)
})

test('readShotDataUrl derives supported media types and falls back to PNG', async () => {
  const reqPath = await tempRequest()
  const bytes = Buffer.from('image bytes')
  const cases = [
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['image.webp', 'image/webp'],
    ['animation.gif', 'image/gif'],
    ['diagram.svg', 'image/svg+xml'],
    ['unknown.bmp', 'image/png']
  ] as const

  for (const [filename, mediaType] of cases) {
    await writeFile(path.join(path.dirname(reqPath), filename), bytes)
    await expect(readShotDataUrl(reqPath, filename)).resolves.toBe(
      `data:${mediaType};base64,${bytes.toString('base64')}`
    )
  }
})

test('readShotDataUrl refuses a path escaping the request directory', async () => {
  const reqPath = await tempRequest()
  await expect(readShotDataUrl(reqPath, '../escape.png')).rejects.toThrow(/escapes run folder/)
})

test('readShotDataUrl refuses an existing file outside the request directory', async () => {
  const reqPath = await tempRequest()
  const outsideDir = await mkdtemp(path.join(tmpdir(), 'qa-runio-outside-'))
  tempDirs.push(outsideDir)
  const outsidePath = path.join(outsideDir, 'outside.png')
  await writeFile(outsidePath, Buffer.from('private bytes'))

  await expect(
    readShotDataUrl(reqPath, path.relative(path.dirname(reqPath), outsidePath))
  ).rejects.toThrow(/escapes run folder/)
})

test('readShotDataUrl refuses a symlinked file outside the request directory', async () => {
  const reqPath = await tempRequest()
  const outsideDir = await mkdtemp(path.join(tmpdir(), 'qa-runio-outside-'))
  tempDirs.push(outsideDir)
  const outsidePath = path.join(outsideDir, 'private.png')
  await writeFile(outsidePath, Buffer.from('private bytes'))
  await symlink(outsidePath, path.join(path.dirname(reqPath), 'linked.png'))

  await expect(readShotDataUrl(reqPath, 'linked.png')).rejects.toThrow(/escapes run folder/)
})

test('readShotDataUrl refuses a symlinked directory outside the request directory', async () => {
  const reqPath = await tempRequest()
  const outsideDir = await mkdtemp(path.join(tmpdir(), 'qa-runio-outside-'))
  tempDirs.push(outsideDir)
  await writeFile(path.join(outsideDir, 'private.png'), Buffer.from('private bytes'))
  await symlink(outsideDir, path.join(path.dirname(reqPath), 'up'))

  await expect(readShotDataUrl(reqPath, 'up/private.png')).rejects.toThrow(/escapes run folder/)
})
