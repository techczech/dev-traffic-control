import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const atomicWrites = vi.hoisted(() => [] as Array<{ path: string; data: string }>)

vi.mock('../atomicWrite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../atomicWrite')>()
  return {
    atomicWrite: async (filePath: string, data: string): Promise<void> => {
      atomicWrites.push({ path: filePath, data })
      await actual.atomicWrite(filePath, data)
    }
  }
})

import {
  archiveHandoff,
  handoffSidecarPathFor,
  markHandoffPickedUp,
  readHandoffSidecar
} from '../handoffs'

const temporaryDirectories: string[] = []

async function handoffFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dtc-handoff-state-'))
  temporaryDirectories.push(root)
  const handoffPath = path.join(root, 'project', 'handoffs', '2026-07-30-example-handoff.md')
  await mkdir(path.dirname(handoffPath), { recursive: true })
  await writeFile(handoffPath, '# Example handoff\n')
  return handoffPath
}

afterEach(async () => {
  atomicWrites.splice(0)
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('handoff state writes', () => {
  test('Copy atomically stamps pickedUpAt without touching the handoff or archive timestamp', async () => {
    const handoffPath = await handoffFixture()
    const sidecarPath = handoffSidecarPathFor(handoffPath)
    const archivedAt = '2026-07-29T08:00:00.000Z'
    await writeFile(sidecarPath, JSON.stringify({ pickedUpAt: null, archivedAt }))
    const originalHandoff = await readFile(handoffPath, 'utf8')
    const pickedUpAt = '2026-07-30T09:12:00.000Z'

    const state = await markHandoffPickedUp(handoffPath, () => pickedUpAt)

    expect(state).toEqual({ pickedUpAt, archivedAt })
    expect(await readHandoffSidecar(handoffPath)).toEqual(state)
    expect(await readFile(handoffPath, 'utf8')).toBe(originalHandoff)
    expect(atomicWrites).toEqual([
      { path: sidecarPath, data: `${JSON.stringify(state, null, 2)}\n` }
    ])
    expect((await readdir(path.dirname(sidecarPath))).filter((n) => n.includes('.tmp-'))).toEqual(
      []
    )
  })

  test('Archive atomically stamps archivedAt without losing pickedUpAt', async () => {
    const handoffPath = await handoffFixture()
    const sidecarPath = handoffSidecarPathFor(handoffPath)
    const pickedUpAt = '2026-07-30T09:12:00.000Z'
    await writeFile(sidecarPath, JSON.stringify({ pickedUpAt, archivedAt: null }))
    const archivedAt = '2026-07-30T11:20:00.000Z'

    const state = await archiveHandoff(handoffPath, () => archivedAt)

    expect(state).toEqual({ pickedUpAt, archivedAt })
    expect(await readHandoffSidecar(handoffPath)).toEqual(state)
    expect(atomicWrites).toEqual([
      { path: sidecarPath, data: `${JSON.stringify(state, null, 2)}\n` }
    ])
  })
})
