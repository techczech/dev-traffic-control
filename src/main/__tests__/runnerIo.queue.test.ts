import { expect, test, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const writeGate = vi.hoisted(() => ({
  blockNext: false,
  failNext: false,
  entered: false,
  release: null as (() => void) | null
}))

vi.mock('../qa/atomicWrite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../qa/atomicWrite')>()
  return {
    atomicWrite: async (filePath: string, data: string): Promise<void> => {
      if (writeGate.blockNext) {
        writeGate.blockNext = false
        writeGate.entered = true
        await new Promise<void>((resolve) => {
          writeGate.release = resolve
        })
      }
      if (writeGate.failNext) {
        writeGate.failNext = false
        throw new Error('rigged report write failure')
      }
      await actual.atomicWrite(filePath, data)
    }
  }
})

import { linkNoteToReport } from '../noteIo'
import { openRun, save } from '../runnerIo'
import { readReport, reportPathFor } from '../qa/report'

const NOW = (): string => '2026-07-26T12:00:00.000Z'

async function requestPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-runner-queue-'))
  const request = path.join(dir, 'light.md')
  await writeFile(
    request,
    `---
id: light
title: Light
mode: light
---
## Check one
It appears inline.
`
  )
  return request
}

test('openRun waits for the pending write on the same report path before reading', async () => {
  const pathToRequest = await requestPath()
  const first = await openRun(pathToRequest, NOW)
  await save(pathToRequest, first.report)

  const partial = {
    ...first.report,
    items: first.report.items.map((item) => ({ ...item, status: 'partial' as const }))
  }
  writeGate.blockNext = true
  writeGate.entered = false
  writeGate.release = null
  const pendingSave = save(pathToRequest, partial)
  while (!writeGate.entered) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  let openSettled = false
  const pendingOpen = openRun(pathToRequest, NOW).then((value) => {
    openSettled = true
    return value
  })
  await new Promise((resolve) => setTimeout(resolve, 10))

  const settledBeforeRelease = openSettled
  const release = Reflect.get(writeGate, 'release') as (() => void) | null
  release?.()
  await pendingSave
  const opened = await pendingOpen
  expect(settledBeforeRelease).toBe(false)
  expect(opened.report.items[0].status).toBe('partial')
})

test('linkNoteToReport queues its read-modify-write behind a pending report save', async () => {
  const pathToRequest = await requestPath()
  const first = await openRun(pathToRequest, NOW)
  await save(pathToRequest, first.report)

  const partial = {
    ...first.report,
    items: first.report.items.map((item) => ({ ...item, status: 'partial' as const }))
  }
  writeGate.blockNext = true
  writeGate.entered = false
  writeGate.release = null
  const pendingSave = save(pathToRequest, partial)
  while (!writeGate.entered) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  let linkSettled = false
  const pendingLink = linkNoteToReport(pathToRequest, '2026-07-26-note-observation.md').then(() => {
    linkSettled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 10))

  const settledBeforeRelease = linkSettled
  const release = Reflect.get(writeGate, 'release') as (() => void) | null
  release?.()
  await pendingSave
  await pendingLink
  const persisted = await readReport(reportPathFor(pathToRequest))

  expect(settledBeforeRelease).toBe(false)
  expect(persisted?.items[0].status).toBe('partial')
  expect(persisted?.noteFiles).toEqual(['2026-07-26-note-observation.md'])
})

test('openRun reads the last good report when a concurrent queued write fails', async () => {
  const pathToRequest = await requestPath()
  const first = await openRun(pathToRequest, NOW)
  const saved = {
    ...first.report,
    items: first.report.items.map((item) => ({ ...item, status: 'pass' as const }))
  }
  await save(pathToRequest, saved)

  const failed = {
    ...saved,
    items: saved.items.map((item) => ({ ...item, status: 'fail' as const }))
  }
  writeGate.blockNext = true
  writeGate.failNext = true
  writeGate.entered = false
  writeGate.release = null
  const writeFailure = save(pathToRequest, failed).catch((error: unknown) => error)
  while (!writeGate.entered) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const pendingOpen = openRun(pathToRequest, NOW)
  await new Promise((resolve) => setTimeout(resolve, 10))
  const release = Reflect.get(writeGate, 'release') as (() => void) | null
  release?.()

  await expect(writeFailure).resolves.toBeInstanceOf(Error)
  await expect(pendingOpen).resolves.toMatchObject({
    exists: true,
    report: { items: [{ status: 'pass' }] }
  })
})
