import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { ViewStateStore } from '../viewState'
import { REMEMBERED_PROJECT_SURFACES } from '../../shared/windowScope'

const DEFAULT_LAYOUT = { pinned: false, widthPreset: 'narrow', windowMode: 'free' } as const

describe('ViewStateStore', () => {
  test('persists the receipt boundary once and never moves it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    const store = new ViewStateStore(file)

    expect(store.ensureReceiptsStartAt('2026-08-03T10:00:00.000Z')).toBe('2026-08-03T10:00:00.000Z')
    await store.flush()
    expect(store.ensureReceiptsStartAt('2026-08-04T10:00:00.000Z')).toBe('2026-08-03T10:00:00.000Z')
    expect(new ViewStateStore(file).getReceiptsStartAt()).toBe('2026-08-03T10:00:00.000Z')
  })
  // Ticket 27: the Dock button's last place is remembered across launches.
  test('remembers the last dock place across launches and ignores a malformed one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    const store = new ViewStateStore(file)
    expect(store.getDockPlace()).toBeNull()

    store.setDockPlace({ edge: 'left', displayId: 69733378 })
    await store.flush()
    expect(new ViewStateStore(file).getDockPlace()).toEqual({ edge: 'left', displayId: 69733378 })

    await writeFile(file, JSON.stringify({ windows: [], dockPlace: { edge: 'top', displayId: 1 } }))
    expect(new ViewStateStore(file).getDockPlace()).toBeNull()
  })

  test('exposes the pending write through flush', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const store = new ViewStateStore(path.join(dir, 'view-state.json'))
    store.setRightPanels({ 'run:/one.md': 'inspector' })
    const flush = (store as unknown as { flush?: () => Promise<void> }).flush

    expect(typeof flush).toBe('function')
    await flush?.call(store)
  })

  test('persists panel memory without a settings changelog', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    const store = new ViewStateStore(file)
    store.setRightPanels({ 'run:/one.md': 'ledger' })
    await store.pendingWrite

    expect(new ViewStateStore(file).get().rightPanels).toEqual({ 'run:/one.md': 'ledger' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      windows: [
        {
          slot: 'window-1',
          layout: DEFAULT_LAYOUT,
          rightPanels: { 'run:/one.md': 'ledger' }
        }
      ]
    })
  })

  test('window bounds and layout persist and restore by stable slot', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    const store = new ViewStateStore(file)
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    store.ensureWindow('window-2', { pinned: true, widthPreset: 'wide', windowMode: 'free' })
    store.setWindowBounds('window-1', { x: 40, y: 60, width: 720, height: 640 })
    store.setWindowBounds('window-2', { x: 880, y: 24, width: 460, height: 876 })
    await store.flush()

    const restored = new ViewStateStore(file).listWindows()
    expect(restored).toEqual([
      {
        slot: 'window-1',
        bounds: { x: 40, y: 60, width: 720, height: 640 },
        layout: DEFAULT_LAYOUT,
        rightPanels: {}
      },
      {
        slot: 'window-2',
        bounds: { x: 880, y: 24, width: 460, height: 876 },
        layout: { pinned: true, widthPreset: 'wide', windowMode: 'free' },
        rightPanels: {}
      }
    ])
  })

  test('panel memory is independent between window slots', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const store = new ViewStateStore(path.join(dir, 'view-state.json'))
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    store.ensureWindow('window-2', DEFAULT_LAYOUT)

    store.setRightPanels({ 'run:/one.md': 'inspector' }, 'window-1')
    store.setRightPanels({ 'run:/two.md': 'ledger' }, 'window-2')

    expect(store.get('window-1').rightPanels).toEqual({ 'run:/one.md': 'inspector' })
    expect(store.get('window-2').rightPanels).toEqual({ 'run:/two.md': 'ledger' })
  })

  test('legacy panel state joins the first slot without overriding its restored layout', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    await writeFile(file, JSON.stringify({ rightPanels: { 'run:/legacy.md': 'inspector' } }))
    const store = new ViewStateStore(file)

    store.ensureWindow('window-1', { pinned: true, widthPreset: 'wide', windowMode: 'docked' })

    expect(store.getWindow('window-1')).toEqual({
      slot: 'window-1',
      layout: { pinned: true, widthPreset: 'wide', windowMode: 'docked' },
      rightPanels: { 'run:/legacy.md': 'inspector' }
    })
  })

  test('settings-file panel migration waits for the first slot layout', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const store = new ViewStateStore(path.join(dir, 'view-state.json'))
    store.migrateRightPanels({ 'run:/settings-legacy.md': 'ledger' })

    expect(store.get().rightPanels).toEqual({ 'run:/settings-legacy.md': 'ledger' })
    store.ensureWindow('window-1', { pinned: true, widthPreset: 'wide', windowMode: 'docked' })

    expect(store.getWindow('window-1')).toEqual({
      slot: 'window-1',
      layout: { pinned: true, widthPreset: 'wide', windowMode: 'docked' },
      rightPanels: { 'run:/settings-legacy.md': 'ledger' }
    })
  })

  test('two windows on two projects are still on them after a restart', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    const store = new ViewStateStore(file)
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    store.ensureWindow('window-2', DEFAULT_LAYOUT)

    store.setWindowScope('window-1', { kind: 'project', slug: 'wordforge' })
    store.setWindowScope('window-2', { kind: 'project', slug: 'tallyboard' })
    await store.flush()

    const restored = new ViewStateStore(file)
    expect(restored.getWindowScope('window-1').scope).toEqual({
      kind: 'project',
      slug: 'wordforge'
    })
    expect(restored.getWindowScope('window-2').scope).toEqual({
      kind: 'project',
      slug: 'tallyboard'
    })
  })

  test('never scoped, All projects and a named project stay three distinct states', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    const store = new ViewStateStore(file)
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    store.ensureWindow('window-2', DEFAULT_LAYOUT)
    store.ensureWindow('window-3', DEFAULT_LAYOUT)

    store.setWindowScope('window-2', { kind: 'all' })
    store.setWindowScope('window-3', { kind: 'project', slug: 'redforge' })
    await store.flush()

    const persisted = JSON.parse(await readFile(file, 'utf8')) as {
      windows: Array<Record<string, unknown>>
    }
    expect('scope' in persisted.windows[0]).toBe(false)
    expect(persisted.windows[1].scope).toEqual({ kind: 'all' })
    expect(persisted.windows[2].scope).toEqual({ kind: 'project', slug: 'redforge' })

    const restored = new ViewStateStore(file)
    expect(restored.getWindowScope('window-1').scope).toBeUndefined()
    expect(restored.getWindowScope('window-2').scope).toEqual({ kind: 'all' })
    expect(restored.getWindowScope('window-3').scope).toEqual({
      kind: 'project',
      slug: 'redforge'
    })
  })

  test('the landing surface is filed per project, only under a project scope', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    const store = new ViewStateStore(file)

    store.setWindowScope('window-1', { kind: 'project', slug: 'wordforge' })
    store.rememberSurfaceInScope('window-1', 'releases')
    store.setWindowScope('window-1', { kind: 'project', slug: 'tallyboard' })
    store.rememberSurfaceInScope('window-1', 'roadmap')
    store.setWindowScope('window-1', { kind: 'all' })
    store.rememberSurfaceInScope('window-1', 'inbox')
    await store.flush()

    const restored = new ViewStateStore(file).getWindowScope('window-1')
    expect(restored.lastSurfaceByProject).toEqual({
      wordforge: 'releases',
      tallyboard: 'roadmap'
    })
  })

  test('the remembered landing surfaces are capped, dropping the least recent', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    const store = new ViewStateStore(file)

    for (let index = 0; index < REMEMBERED_PROJECT_SURFACES + 4; index += 1) {
      store.setWindowScope('window-1', { kind: 'project', slug: `project-${index}` })
      store.rememberSurfaceInScope('window-1', 'releases')
    }
    await store.flush()

    // Capped where it is written, not only where it is read back: an
    // unbounded map in a persisted file is a slow leak.
    const live = store.getWindowScope('window-1').lastSurfaceByProject
    const onDisk = (
      JSON.parse(await readFile(file, 'utf8')) as {
        windows: Array<{ lastSurfaceByProject?: Record<string, string> }>
      }
    ).windows[0].lastSurfaceByProject
    const remembered = new ViewStateStore(file).getWindowScope('window-1').lastSurfaceByProject

    for (const map of [live, onDisk, remembered]) {
      expect(Object.keys(map ?? {})).toHaveLength(REMEMBERED_PROJECT_SURFACES)
      expect(map?.['project-0']).toBeUndefined()
      expect(map?.[`project-${REMEMBERED_PROJECT_SURFACES + 3}`]).toBe('releases')
    }
  })

  test('a corrupt scope is dropped rather than restored as a scope', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dtc-view-state-'))
    const file = path.join(dir, 'view-state.json')
    await writeFile(
      file,
      JSON.stringify({
        windows: [
          {
            slot: 'window-1',
            layout: DEFAULT_LAYOUT,
            rightPanels: {},
            scope: { kind: 'project' },
            lastSurfaceByProject: { wordforge: 7 }
          }
        ]
      })
    )

    const restored = new ViewStateStore(file).getWindowScope('window-1')
    expect(restored.scope).toBeUndefined()
    expect(restored.lastSurfaceByProject).toEqual({})
  })

  test('renderer panel toggles use view-state IPC and never the settings changelog path', async () => {
    const source = await readFile(
      new URL('../../renderer/src/state/app.tsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain('window.qa.setRightPanels(rightPanels)')
    expect(source).not.toContain("changeSetting('rightPanels'")
  })
})
