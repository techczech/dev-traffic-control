import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bootstrapUserData, resolveUserDataOverride } from '../bootstrapUserData'
import { defaultSettings } from '../settings'

const temporaryParents: string[] = []

async function userDataDirs(): Promise<{ legacy: string; current: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), 'dtc-bootstrap-user-data-'))
  temporaryParents.push(parent)
  return {
    legacy: path.join(parent, 'qa-probe'),
    current: path.join(parent, 'dev-traffic-control')
  }
}

async function seedLegacyState(legacy: string): Promise<void> {
  await mkdir(legacy, { recursive: true })
  await Promise.all([
    writeFile(
      path.join(legacy, 'settings.json'),
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
      path.join(legacy, 'ticks.json'),
      JSON.stringify({
        'run-one': { 'check-one': { steps: [0, 2], expected: [1] } }
      })
    ),
    writeFile(
      path.join(legacy, 'inbox-state.json'),
      JSON.stringify({ seen: ['run-one'], archived: ['run-old'] })
    ),
    writeFile(
      path.join(legacy, 'reading-progress.json'),
      JSON.stringify({
        'redforge/review.md': {
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
  test('migrates real legacy files before constructing any store', async () => {
    vi.stubEnv('DTC_USER_DATA', '')
    vi.stubEnv('QA_SCOUT_USER_DATA', '')
    const { legacy, current } = await userDataDirs()
    await seedLegacyState(legacy)

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
    expect(readingProgressStore.get('redforge/review.md')?.sectionSlug).toBe('journey-2')
    expect(viewStateStore.get().rightPanels).toEqual({
      'run:/records/custom/project/request.md': 'inspector'
    })
    expect(store.log().some((entry) => entry.key === 'rightPanels')).toBe(false)
  })

  test('an explicit DTC_USER_DATA path starts with isolated state', async () => {
    const { legacy, current } = await userDataDirs()
    await seedLegacyState(legacy)
    vi.stubEnv('DTC_USER_DATA', current)
    vi.stubEnv('QA_SCOUT_USER_DATA', '')

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

  test('the legacy QA_SCOUT_USER_DATA override also starts with isolated state', async () => {
    const { legacy, current } = await userDataDirs()
    await seedLegacyState(legacy)
    vi.stubEnv('DTC_USER_DATA', undefined)
    vi.stubEnv('QA_SCOUT_USER_DATA', current)

    const { store, ticksStore, inboxStore } = bootstrapUserData(current)

    expect(store.get()).toEqual(defaultSettings())
    expect(ticksStore.get('run-one')).toEqual({})
    expect(inboxStore.get()).toEqual({ seen: [], archived: [] })
  })

  test('an empty DTC_USER_DATA falls through to the legacy override', async () => {
    const { legacy, current } = await userDataDirs()
    await seedLegacyState(legacy)
    vi.stubEnv('DTC_USER_DATA', '')
    vi.stubEnv('QA_SCOUT_USER_DATA', current)

    expect(resolveUserDataOverride(process.env)).toBe(current)
    const { store, ticksStore, inboxStore } = bootstrapUserData(current)

    expect(store.get()).toEqual(defaultSettings())
    expect(ticksStore.get('run-one')).toEqual({})
    expect(inboxStore.get()).toEqual({ seen: [], archived: [] })
  })
})
