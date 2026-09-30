import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

const atomicWriteControl = vi.hoisted(() => ({
  beforeWrite: null as null | ((filePath: string, payload: string) => Promise<void>)
}))

vi.mock('../qa/atomicWrite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../qa/atomicWrite')>()
  return {
    ...actual,
    atomicWrite: async (filePath: string, payload: string): Promise<void> => {
      if (atomicWriteControl.beforeWrite) {
        await atomicWriteControl.beforeWrite(filePath, payload)
      }
      return actual.atomicWrite(filePath, payload)
    }
  }
})

import { SettingsStore, defaultSettings } from '../settings'

const NOW = '2026-07-18T09:00:00.000Z'
const fixedNow = (): string => NOW
const temporaryDirectories: string[] = []

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function tmp(): Promise<string> {
  const dir = await temporaryDirectory('qa-settings-')
  return path.join(dir, 'settings.json')
}

afterEach(async () => {
  atomicWriteControl.beforeWrite = null
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe('SettingsStore', () => {
  test('getStartedRetired defaults to false, loads from an old file without it, and persists', async () => {
    expect(defaultSettings().getStartedRetired).toBe(false)
    const file = await tmp()
    const { keymap: _keymap, ...old } = defaultSettings()
    await writeFile(file, JSON.stringify({ settings: old, changelog: [] }))
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(store.get().getStartedRetired).toBe(false)
    await store.setTransactional('getStartedRetired', true)
    const reopened = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(reopened.get().getStartedRetired).toBe(true)
    await writeFile(file, JSON.stringify({ settings: { getStartedRetired: 'yes' }, changelog: [] }))
    expect(new SettingsStore(file, defaultSettings(), fixedNow).get().getStartedRetired).toBe(false)
  })

  test('a transactional set matching a queued projection waits for durable storage', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    const denied = Object.assign(new Error('write denied'), { code: 'EACCES' })
    let releaseWrite!: () => void
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve
    })
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    atomicWriteControl.beforeWrite = async () => {
      markWriteStarted()
      await writeReleased
      throw denied
    }

    store.set('qaRepoPath', '/records/new')
    const transactional = store.setTransactional('qaRepoPath', '/records/new')
    let resolved = false
    void transactional.then(
      () => {
        resolved = true
      },
      () => {}
    )

    await writeStarted
    await Promise.resolve()
    expect(resolved).toBe(false)

    releaseWrite()
    await expect(transactional).rejects.toBe(denied)
    expect(store.get().qaRepoPath).toBe(defaultSettings().qaRepoPath)
  })

  test('a failed plain set is handled, reported, and rolled back', async () => {
    const file = await tmp()
    const failures: Array<{ key: string; message: string }> = []
    const StoreWithFailureChannel = SettingsStore as unknown as new (
      path: string,
      defaults: ReturnType<typeof defaultSettings>,
      now: () => string,
      onWriteFailure: (failure: { key: string; message: string }) => void
    ) => SettingsStore
    const store = new StoreWithFailureChannel(file, defaultSettings(), fixedNow, (failure) =>
      failures.push(failure)
    )
    atomicWriteControl.beforeWrite = async () => {
      throw new Error('disk exploded')
    }

    store.set('dockBadge', false)
    await expect(store.pendingWrite).resolves.toBeUndefined()

    expect(store.get().dockBadge).toBe(true)
    expect(failures).toEqual([
      {
        key: 'dockBadge',
        message: expect.stringMatching(/could not save.*previous value/i)
      }
    ])
  })

  test('a set queued during a transactional write persists the final state and complete history', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    let releaseWrite!: () => void
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve
    })
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    let writes = 0
    atomicWriteControl.beforeWrite = async () => {
      writes += 1
      if (writes !== 1) return
      markWriteStarted()
      await writeReleased
    }

    const transactional = store.setTransactional('qaRepoPath', '/records/new')
    await writeStarted
    store.set('pinned', true)
    releaseWrite()
    await transactional
    await store.pendingWrite

    const persisted = JSON.parse(await readFile(file, 'utf8')) as {
      settings: ReturnType<typeof defaultSettings>
      changelog: unknown[]
    }
    expect(store.get()).toMatchObject({ qaRepoPath: '/records/new', pinned: true })
    expect(persisted.settings).toMatchObject({ qaRepoPath: '/records/new', pinned: true })
    expect(persisted.changelog).toEqual([
      {
        key: 'qaRepoPath',
        from: defaultSettings().qaRepoPath,
        to: '/records/new',
        at: NOW
      },
      { key: 'pinned', from: false, to: true, at: NOW }
    ])
  })

  test('a failed transactional write rolls memory back and leaves a handled write tail', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    const denied = Object.assign(new Error('write denied'), { code: 'EACCES' })
    atomicWriteControl.beforeWrite = async () => {
      throw denied
    }

    await expect(store.setTransactional('qaRepoPath', '/records/new')).rejects.toBe(denied)

    expect(store.get().qaRepoPath).toBe(defaultSettings().qaRepoPath)
    await expect(store.pendingWrite).resolves.toBeUndefined()
  })

  test('a transactional setting changes memory and disk only after its write succeeds', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    const oldPath = store.get().qaRepoPath

    const committed = await store.setTransactional('qaRepoPath', '/records/new')

    expect(committed.qaRepoPath).toBe('/records/new')
    expect(store.get().qaRepoPath).toBe('/records/new')
    const reopened = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(reopened.get().qaRepoPath).toBe('/records/new')
    expect(reopened.log()).toEqual([
      { key: 'qaRepoPath', from: oldPath, to: '/records/new', at: NOW }
    ])
  })
  test('returns defaults when the file is missing', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(store.get()).toEqual(defaultSettings())
    expect(store.get().qaRepoPath).toBe(path.join(homedir(), 'Documents', 'Dev Traffic Control'))
    expect(store.log()).toEqual([])
  })

  test('window feel defaults to a free narrow window (relief pass R1)', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(store.get().widthPreset).toBe('narrow')
    expect(store.get().windowMode).toBe('free')
  })

  test('request reading text size defaults and round-trips through the ordered plain-set chain', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(store.get()).toHaveProperty('readingTextSize', 'normal')

    store.set('readingTextSize', 'large')
    await store.pendingWrite

    const reopened = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(reopened.get()).toHaveProperty('readingTextSize', 'large')
    expect(reopened.log()).toContainEqual({
      key: 'readingTextSize',
      from: 'normal',
      to: 'large',
      at: NOW
    })
  })

  test('keymap stores user overrides only and persists them through the settings write path', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(store.get().keymap).toEqual({})

    store.set('keymap', { 'window.toggle-pin': 'Alt+P' })
    await store.pendingWrite

    const reopened = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(reopened.get().keymap).toEqual({ 'window.toggle-pin': 'Alt+P' })
    expect(reopened.log()).toContainEqual({
      key: 'keymap',
      from: {},
      to: { 'window.toggle-pin': 'Alt+P' },
      at: NOW
    })
  })

  test('get returns a deep copy whose keymap cannot mutate store state', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    store.set('keymap', { 'window.toggle-pin': 'Alt+P' })
    await store.pendingWrite

    const read = store.get()
    read.keymap['window.toggle-pin'] = 'Mod+P'
    read.keymap['app.settings'] = 'Mod+Comma'

    expect(store.get().keymap).toEqual({ 'window.toggle-pin': 'Alt+P' })
  })

  test('width preset and window mode persist and changelog (relief pass R1)', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    store.set('widthPreset', 'wide')
    store.set('windowMode', 'docked')
    await store.pendingWrite

    const reopened = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(reopened.get().widthPreset).toBe('wide')
    expect(reopened.get().windowMode).toBe('docked')
    expect(reopened.log()).toEqual([
      { key: 'widthPreset', from: 'narrow', to: 'wide', at: NOW },
      { key: 'windowMode', from: 'free', to: 'docked', at: NOW }
    ])
  })

  test('a changed set persists across a second construct', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    store.set('pinned', true)
    await store.pendingWrite

    const reopened = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(reopened.get().pinned).toBe(true)
    expect(reopened.log()).toHaveLength(1)
  })

  test('an unchanged set records nothing and writes nothing new', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    const before = store.get()
    const returned = store.set('pinned', false) // false is the default
    expect(returned).toEqual(before)
    expect(store.log()).toEqual([])
  })

  test('a changed set records a SettingsChange with from/to/at', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    store.set('pinned', true)
    await store.pendingWrite
    expect(store.log()).toEqual([{ key: 'pinned', from: false, to: true, at: NOW }])
  })

  test('a corrupt file falls back to defaults without throwing', async () => {
    const file = await tmp()
    await writeFile(file, '{ this is not json', 'utf8')
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(store.get()).toEqual(defaultSettings())
    expect(store.log()).toEqual([])
  })

  test('absent keys fall back to defaults while unknown setting values survive rewrites', async () => {
    const file = await tmp()
    const retiredChange = {
      key: 'retiredSetting',
      from: '/old',
      to: '/legacy',
      at: NOW
    }
    await writeFile(
      file,
      JSON.stringify({
        settings: { pinned: true, retiredSetting: '/legacy' },
        changelog: [retiredChange]
      }),
      'utf8'
    )
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(store.get().pinned).toBe(true)
    expect(store.get().appearance).toBe('light') // default for the absent key
    expect((store.get() as unknown as Record<string, unknown>).retiredSetting).toBe('/legacy')
    expect(store.log()).toEqual([retiredChange])

    store.set('dockBadge', false)
    await store.pendingWrite
    const persisted = JSON.parse(await readFile(file, 'utf8')) as {
      settings: Record<string, unknown>
    }
    expect(persisted.settings.retiredSetting).toBe('/legacy')
  })

  test('plain sets stamp their changelog entry when the queued write begins', async () => {
    const file = await tmp()
    let clock = '2026-08-01T10:00:00.000Z'
    const store = new SettingsStore(file, defaultSettings(), () => clock)

    store.set('pinned', true)
    clock = '2026-08-01T10:00:01.000Z'
    await store.pendingWrite

    expect(store.log()).toEqual([
      {
        key: 'pinned',
        from: false,
        to: true,
        at: '2026-08-01T10:00:01.000Z'
      }
    ])
  })

  test('flush waits for the latest queued settings write', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    let releaseWrite!: () => void
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    atomicWriteControl.beforeWrite = async () => writeReleased

    store.set('pinned', true)
    const flush = (store as unknown as { flush?: () => Promise<void> }).flush
    expect(typeof flush).toBe('function')
    let flushed = false
    void flush?.call(store).then(() => {
      flushed = true
    })
    await Promise.resolve()
    expect(flushed).toBe(false)

    releaseWrite()
    await flush?.call(store)
    expect(flushed).toBe(true)
  })

  test('shape-checks every stored setting and normalises null or garbage keymaps', async () => {
    const file = await tmp()
    await writeFile(
      file,
      JSON.stringify({
        settings: {
          ...defaultSettings(),
          dockBadge: 'yes',
          appearance: 'ultraviolet',
          keymap: null
        },
        changelog: []
      })
    )
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(store.get().dockBadge).toBe(true)
    expect(store.get().appearance).toBe('light')
    expect(store.get().keymap).toEqual({})
  })

  // Ticket 27: the verdict sheet remembers which way he last used.
  test('the verdict sheet layout defaults to one at a time and survives a relaunch', async () => {
    const file = await tmp()
    expect(defaultSettings().verdictLayout).toBe('one')
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    store.set('verdictLayout', 'all')
    await store.pendingWrite
    expect(new SettingsStore(file, defaultSettings(), fixedNow).get().verdictLayout).toBe('all')

    await writeFile(
      file,
      JSON.stringify({
        settings: { ...defaultSettings(), verdictLayout: 'sideways' },
        changelog: []
      })
    )
    expect(new SettingsStore(file, defaultSettings(), fixedNow).get().verdictLayout).toBe('one')
  })

  test('a retired setting change survives load and the next serialise', async () => {
    const file = await tmp()
    const retiredChange = {
      key: 'coordinationFolderPath',
      from: '/old-coordination',
      to: '/new-coordination',
      at: '2026-07-17T08:00:00.000Z'
    }
    await writeFile(
      file,
      JSON.stringify({
        settings: defaultSettings(),
        changelog: [retiredChange]
      }),
      'utf8'
    )

    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    store.set('pinned', true)
    await store.pendingWrite

    const persisted = JSON.parse(await readFile(file, 'utf8')) as {
      changelog: unknown[]
    }
    expect(persisted.changelog).toEqual([
      retiredChange,
      { key: 'pinned', from: false, to: true, at: NOW }
    ])
  })

  test('structurally invalid changelog entries are rejected', async () => {
    const file = await tmp()
    const validChange = { key: 'pinned', from: false, to: true, at: NOW }
    await writeFile(
      file,
      JSON.stringify({
        settings: defaultSettings(),
        changelog: [
          null,
          'not a change',
          { key: 'pinned' },
          { key: 42, from: false, to: true, at: NOW },
          { key: 'pinned', from: false, to: true, at: 42 },
          validChange
        ]
      }),
      'utf8'
    )

    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(store.log()).toEqual([validChange])
  })

  test('wasFreshlyCreated is true only when the file was absent at construct', async () => {
    const file = await tmp()
    const fresh = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(fresh.wasFreshlyCreated()).toBe(true)

    fresh.set('pinned', true)
    await fresh.pendingWrite

    const reopened = new SettingsStore(file, defaultSettings(), fixedNow)
    expect(reopened.wasFreshlyCreated()).toBe(false)
  })

  test('reset appends a reversal change and never deletes history', async () => {
    const file = await tmp()
    const store = new SettingsStore(file, defaultSettings(), fixedNow)
    store.set('dockBadge', false) // change away from the default (true)
    await store.pendingWrite
    // A reset is just the reverse set — the UI applies the entry's old value.
    store.set('dockBadge', true)
    await store.pendingWrite
    expect(store.get().dockBadge).toBe(true)
    expect(store.log()).toEqual([
      { key: 'dockBadge', from: true, to: false, at: NOW },
      { key: 'dockBadge', from: false, to: true, at: NOW }
    ])
  })
})
