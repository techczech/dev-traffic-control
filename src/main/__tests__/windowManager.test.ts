import { describe, expect, test } from 'vitest'
import { WindowManager, type ManagedWindow } from '../windowManager'
import { sanitiseRestoredBounds, type WindowBounds } from '../windowLayout'
import { ViewStateStore } from '../viewState'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DEFAULT_LAYOUT = { pinned: false, widthPreset: 'narrow', windowMode: 'free' } as const
const CASCADE_OFFSET = 28
const WORK_AREA: WindowBounds = { x: 0, y: 24, width: 1440, height: 876 }

class FakeWindow implements ManagedWindow {
  private readonly listeners = new Map<string, Array<() => void>>()
  destroyed = false

  constructor(
    readonly name: string,
    private bounds = { x: 10, y: 20, width: 460, height: 780 }
  ) {}

  isDestroyed(): boolean {
    return this.destroyed
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.bounds }
  }

  setTestBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = { ...bounds }
    this.emit('move')
    this.emit('resize')
  }

  on(event: string, listener: () => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  focusForTest(): void {
    this.emit('focus')
  }

  closeForTest(): void {
    this.emit('close')
    this.destroyed = true
    this.emit('closed')
  }

  private emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }
}

async function harness(): Promise<{ store: ViewStateStore; manager: WindowManager<FakeWindow> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dtc-window-manager-'))
  const store = new ViewStateStore(path.join(dir, 'view-state.json'))
  return { store, manager: new WindowManager(store) }
}

describe('WindowManager', () => {
  test('new-window layout comes from the focused window, then the first live window', async () => {
    const { store, manager } = await harness()
    const firstLayout = { pinned: true, widthPreset: 'wide', windowMode: 'free' } as const
    const secondLayout = { pinned: false, widthPreset: 'narrow', windowMode: 'docked' } as const
    store.ensureWindow('window-1', firstLayout)
    store.ensureWindow('window-2', secondLayout)
    const first = new FakeWindow('first')
    const second = new FakeWindow('second')
    manager.register(first, 'window-1')
    manager.register(second, 'window-2')
    const layoutForNewWindow = (
      manager as unknown as {
        layoutForNewWindow?: (fallback: typeof DEFAULT_LAYOUT) => typeof DEFAULT_LAYOUT
      }
    ).layoutForNewWindow

    expect(layoutForNewWindow?.call(manager, DEFAULT_LAYOUT)).toEqual(firstLayout)

    second.focusForTest()
    expect(layoutForNewWindow?.call(manager, DEFAULT_LAYOUT)).toEqual({
      ...secondLayout,
      windowMode: 'free'
    })
  })

  test('each registered window owns independent WindowLayoutState memory', async () => {
    const { store, manager } = await harness()
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    store.ensureWindow('window-2', DEFAULT_LAYOUT)
    const first = new FakeWindow('first')
    const second = new FakeWindow('second')
    manager.register(first, 'window-1')
    manager.register(second, 'window-2')

    manager.layoutFor(first)?.dock(first.getBounds(), { x: 0, y: 0, width: 1440, height: 900 })
    manager.setLayout(first, { pinned: true, widthPreset: 'wide', windowMode: 'free' })

    expect(manager.layoutFor(first)?.preDockBounds).toEqual(first.getBounds())
    expect(manager.layoutFor(second)?.preDockBounds).toBeNull()
    expect(store.getWindow('window-1')?.layout).toEqual({
      pinned: true,
      widthPreset: 'wide',
      windowMode: 'free'
    })
    expect(store.getWindow('window-2')?.layout).toEqual(DEFAULT_LAYOUT)
  })

  test('closing the last window preserves its restore slot', async () => {
    const { store, manager } = await harness()
    const restoredLayout = { pinned: true, widthPreset: 'wide', windowMode: 'docked' } as const
    store.ensureWindow('window-1', restoredLayout)
    store.setRightPanels({ 'run:/review.md': 'ledger' }, 'window-1')
    const win = new FakeWindow('only', { x: 980, y: 24, width: 460, height: 876 })
    manager.register(win, 'window-1')

    win.closeForTest()

    expect(manager.liveWindows()).toEqual([])
    expect(store.listWindows()).toEqual([
      {
        slot: 'window-1',
        bounds: { x: 980, y: 24, width: 460, height: 876 },
        layout: restoredLayout,
        rightPanels: { 'run:/review.md': 'ledger' }
      }
    ])
    const reopenSlot = (
      manager as unknown as {
        reopenSlot?: (fallback: typeof DEFAULT_LAYOUT) => {
          slot: string
          layout: typeof DEFAULT_LAYOUT
        }
      }
    ).reopenSlot
    expect(reopenSlot?.call(manager, DEFAULT_LAYOUT)).toEqual({
      slot: 'window-1',
      bounds: { x: 980, y: 24, width: 460, height: 876 },
      layout: restoredLayout,
      rightPanels: { 'run:/review.md': 'ledger' }
    })
  })

  test('closing a non-last window removes only its restore slot', async () => {
    const { store, manager } = await harness()
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    store.ensureWindow('window-2', DEFAULT_LAYOUT)
    const first = new FakeWindow('first')
    const second = new FakeWindow('second')
    manager.register(first, 'window-1')
    manager.register(second, 'window-2')

    first.closeForTest()

    expect(store.listWindows().map((window) => window.slot)).toEqual(['window-2'])
  })

  test('quitting preserves every restore slot while windows close', async () => {
    const { store, manager } = await harness()
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    store.ensureWindow('window-2', DEFAULT_LAYOUT)
    const first = new FakeWindow('first')
    const second = new FakeWindow('second')
    manager.register(first, 'window-1')
    manager.register(second, 'window-2')

    manager.beginQuit()
    first.closeForTest()
    second.closeForTest()

    expect(store.listWindows().map((window) => window.slot)).toEqual(['window-1', 'window-2'])
  })

  test('move and resize events persist the final bounds for relaunch', async () => {
    const { store, manager } = await harness()
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    const win = new FakeWindow('only')
    manager.register(win, 'window-1')

    win.setTestBounds({ x: 90, y: 110, width: 860, height: 700 })
    await store.flush()

    expect(store.getWindow('window-1')?.bounds).toEqual({
      x: 90,
      y: 110,
      width: 860,
      height: 700
    })
  })

  test('new windows inherit pin and width but open free at a visible post-sanitise offset', async () => {
    const { store, manager } = await harness()
    const dockedLayout = { pinned: true, widthPreset: 'wide', windowMode: 'docked' } as const
    store.ensureWindow('window-1', dockedLayout)
    const focused = new FakeWindow('focused', { x: 980, y: 24, width: 460, height: 876 })
    manager.register(focused, 'window-1')
    focused.focusForTest()

    const next = manager.newWindowState(DEFAULT_LAYOUT, WORK_AREA)
    const finalBounds = sanitiseRestoredBounds(next.bounds!, WORK_AREA)

    expect(next.layout).toEqual({ pinned: true, widthPreset: 'wide', windowMode: 'free' })
    expect(finalBounds).toEqual({ x: 952, y: 24, width: 460, height: 876 })
    expect(next).toEqual({
      layout: { pinned: true, widthPreset: 'wide', windowMode: 'free' },
      bounds: { x: 952, y: 24, width: 460, height: 876 }
    })
  })

  test('new free windows also use the cascade offset', async () => {
    const { store, manager } = await harness()
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    const focused = new FakeWindow('focused', { x: 40, y: 60, width: 700, height: 640 })
    manager.register(focused, 'window-1')

    expect(manager.newWindowState(DEFAULT_LAYOUT, WORK_AREA)).toEqual({
      layout: DEFAULT_LAYOUT,
      bounds: { x: 68, y: 88, width: 700, height: 640 }
    })
  })

  test('the composed cascade stays visibly distinct at every edge and corner', async () => {
    const { store, manager } = await harness()
    store.ensureWindow('window-1', DEFAULT_LAYOUT)
    const focused = new FakeWindow('focused')
    manager.register(focused, 'window-1')
    focused.focusForTest()

    const width = 460
    const height = 640
    const maxX = WORK_AREA.x + WORK_AREA.width - width
    const maxY = WORK_AREA.y + WORK_AREA.height - height
    const xs = [WORK_AREA.x, WORK_AREA.x + 10, Math.round(maxX / 2), maxX - 10, maxX]
    const ys = [
      WORK_AREA.y,
      WORK_AREA.y + 10,
      Math.round((WORK_AREA.y + maxY) / 2),
      maxY - 10,
      maxY
    ]

    for (const x of xs) {
      for (const y of ys) {
        const source = { x, y, width, height }
        focused.setTestBounds(source)
        const next = manager.newWindowState(DEFAULT_LAYOUT, WORK_AREA)
        const finalBounds = sanitiseRestoredBounds(next.bounds!, WORK_AREA)!

        expect(finalBounds.x).toBeGreaterThanOrEqual(WORK_AREA.x)
        expect(finalBounds.y).toBeGreaterThanOrEqual(WORK_AREA.y)
        expect(finalBounds.x + finalBounds.width).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width)
        expect(finalBounds.y + finalBounds.height).toBeLessThanOrEqual(
          WORK_AREA.y + WORK_AREA.height
        )
        expect(
          Math.abs(finalBounds.x - source.x) >= CASCADE_OFFSET ||
            Math.abs(finalBounds.y - source.y) >= CASCADE_OFFSET
        ).toBe(true)
      }
    }
  })

  test('the composed cascade offsets docked and full-height windows horizontally', async () => {
    const { store, manager } = await harness()
    store.ensureWindow('window-1', {
      pinned: true,
      widthPreset: 'narrow',
      windowMode: 'docked'
    })
    const source = { x: 980, y: 24, width: 460, height: 876 }
    const focused = new FakeWindow('focused', source)
    manager.register(focused, 'window-1')
    focused.focusForTest()

    const next = manager.newWindowState(DEFAULT_LAYOUT, WORK_AREA)
    const finalBounds = sanitiseRestoredBounds(next.bounds!, WORK_AREA)!

    expect(finalBounds).toEqual({ ...source, x: source.x - CASCADE_OFFSET })
    expect(next.layout).toEqual({ pinned: true, widthPreset: 'narrow', windowMode: 'free' })
  })

  test('a full-work-area source falls back to a pinned narrow far-edge cascade', async () => {
    const { store, manager } = await harness()
    store.ensureWindow('window-1', {
      pinned: true,
      widthPreset: 'narrow',
      windowMode: 'docked'
    })
    const source = new FakeWindow('source', WORK_AREA)
    manager.register(source, 'window-1')
    source.focusForTest()

    const next = manager.newWindowState(DEFAULT_LAYOUT, WORK_AREA)
    const finalBounds = sanitiseRestoredBounds(next.bounds!, WORK_AREA)

    expect(finalBounds).toEqual({ x: 980, y: 120, width: 460, height: 780 })
    expect(next.layout).toEqual({ pinned: true, widthPreset: 'narrow', windowMode: 'free' })
    expect(next.preventPinnedOverlap).toBeUndefined()
  })

  test('the named 488-515 by 808-835 dead band uses a genuinely distinct fallback', async () => {
    const { store, manager } = await harness()
    const workArea = { x: 0, y: 0, width: 515, height: 835 }
    const sourceBounds = { x: 1, y: 8, width: 487, height: 807 }
    store.ensureWindow('window-1', {
      pinned: true,
      widthPreset: 'narrow',
      windowMode: 'free'
    })
    const source = new FakeWindow('source', sourceBounds)
    manager.register(source, 'window-1')
    source.focusForTest()

    const next = manager.newWindowState(DEFAULT_LAYOUT, workArea)
    const finalBounds = sanitiseRestoredBounds(next.bounds!, workArea)!

    expect(
      Math.abs(finalBounds.x - sourceBounds.x) >= CASCADE_OFFSET ||
        Math.abs(finalBounds.y - sourceBounds.y) >= CASCADE_OFFSET ||
        Math.abs(finalBounds.width - sourceBounds.width) >= CASCADE_OFFSET ||
        Math.abs(finalBounds.height - sourceBounds.height) >= CASCADE_OFFSET
    ).toBe(true)
    expect(next.preventPinnedOverlap).toBeUndefined()
  })

  test('an unavoidable tiny-work-area overlap still does not inherit pinning', async () => {
    const { store, manager } = await harness()
    store.ensureWindow('window-1', {
      pinned: true,
      widthPreset: 'narrow',
      windowMode: 'docked'
    })
    const tinyWorkArea = { x: 0, y: 0, width: 300, height: 400 }
    const source = new FakeWindow('source', tinyWorkArea)
    manager.register(source, 'window-1')
    source.focusForTest()

    const next = manager.newWindowState(DEFAULT_LAYOUT, tinyWorkArea)
    const finalBounds = sanitiseRestoredBounds(next.bounds!, tinyWorkArea)

    expect(finalBounds).toEqual(tinyWorkArea)
    expect(next.layout).toEqual({ pinned: false, widthPreset: 'narrow', windowMode: 'free' })
    expect(next.preventPinnedOverlap).toBe(true)
  })

  test('never hands out a slot a live window is already using', async () => {
    // 0.21.0-alpha.3: a dtc:// link opened a second window, the allocator read
    // only the persisted list, and the new window was handed the slot the open
    // window was on. The next setWindowScope on that slot changed the project
    // of the window the reviewer was reading — breaking the rule that a link never
    // touches a window that already exists.
    const { store, manager } = await harness()
    const open = new FakeWindow('open')
    manager.register(open, 'window-1')

    // No persisted record for it — not yet written, or pruned. Reality is that
    // window-1 is occupied and only the live windows know it.
    expect(store.listWindows()).toHaveLength(0)

    const created = manager.createSlot(DEFAULT_LAYOUT)

    expect(created.slot).not.toBe('window-1')
    expect(manager.liveSlots()).toContain('window-1')
  })
})
