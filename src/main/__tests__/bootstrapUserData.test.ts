import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bootstrapUserData, resolveUserDataOverride } from '../bootstrapUserData'
import { defaultSettings } from '../settings'

const temporaryParents: string[] = []

async function userDataDir(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'dtc-bootstrap-user-data-'))
  temporaryParents.push(parent)
  return path.join(parent, 'dev-traffic-control')
}

async function seedState(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(
      path.join(directory, 'settings.json'),
      JSON.stringify({
        settings: {
          ...defaultSettings(),
          qaRepoPath: '/records/custom',
          pinned: true,
          rightPanels: { 'run:/records/custom/project/request.md': 'inspector' }
        },
        changelog: [{ key: 'pinned', from: false, to: true, at: '2026-07-01T10:00:00.000Z' }]
      })
    ),
    writeFile(
      path.join(directory, 'ticks.json'),
      JSON.stringify({
        'run-one': { 'check-one': { steps: [0, 2], expected: [1] } }
      })
    ),
    writeFile(
      path.join(directory, 'inbox-state.json'),
      JSON.stringify({ seen: ['run-one'], archived: ['run-old'] })
    ),
    writeFile(
      path.join(directory, 'reading-progress.json'),
      JSON.stringify({
        'harbour/review.md': {
          sectionSlug: 'journey-2',
          sectionIndex: 1,
          sectionCount: 4,
          updatedAt: '2026-08-07T01:45:00.000Z'
        }
      })
    )
  ])
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    temporaryParents.splice(0).map((parent) => rm(parent, { recursive: true, force: true }))
  )
})

describe('bootstrapUserData', () => {
  test('every store reads the state already in the folder', async () => {
    const current = await userDataDir()
    await seedState(current)

    const { store, ticksStore, inboxStore, readingProgressStore, viewStateStore } =
      bootstrapUserData(current)

    expect(store.get().pinned).toBe(true)
    expect(store.get().qaRepoPath).toBe('/records/custom')
    expect(store.log()).toEqual([
      { key: 'pinned', from: false, to: true, at: '2026-07-01T10:00:00.000Z' }
    ])
    expect(ticksStore.get('run-one')).toEqual({
      'check-one': { steps: [0, 2], expected: [1] }
    })
    expect(inboxStore.get()).toEqual({ seen: ['run-one'], archived: ['run-old'] })
    expect(readingProgressStore.get('harbour/review.md')?.sectionSlug).toBe('journey-2')
    expect(viewStateStore.get().rightPanels).toEqual({
      'run:/records/custom/project/request.md': 'inspector'
    })
    expect(store.log().some((entry) => entry.key === 'rightPanels')).toBe(false)
  })

  test('an empty folder starts with default state and writes nothing', async () => {
    const current = await userDataDir()

    const { store, ticksStore, inboxStore } = bootstrapUserData(current)

    expect(store.get()).toEqual(defaultSettings())
    expect(store.log()).toEqual([])
    expect(ticksStore.get('run-one')).toEqual({})
    expect(inboxStore.get()).toEqual({ seen: [], archived: [] })
    await expect(stat(path.join(current, 'settings.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(stat(path.join(current, 'ticks.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(path.join(current, 'inbox-state.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  test('DTC_USER_DATA names the override folder; empty or unset means none', () => {
    expect(resolveUserDataOverride({ DTC_USER_DATA: '/tmp/state' })).toBe('/tmp/state')
    expect(resolveUserDataOverride({ DTC_USER_DATA: '' })).toBeUndefined()
    expect(resolveUserDataOverride({})).toBeUndefined()
  })
})
