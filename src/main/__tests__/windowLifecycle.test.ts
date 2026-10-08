import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createEnsureWindowAndRaiseHandler,
  finaliseNewWindowState,
  reconcileWindowToWorkArea,
  resetWindowPosition,
  reviseWindowMinimums,
  windowGeometryForCreation
} from '../windowLifecycle'
import { WindowManager, type ManagedWindow } from '../windowManager'
import { DEFAULT_WINDOW_HEIGHT, NARROW_WIDTH, type WindowBounds } from '../windowLayout'
import { ViewStateStore, type WindowLayoutPreferences } from '../viewState'

const DEFAULT_LAYOUT = { pinned: false, widthPreset: 'narrow', windowMode: 'free' } as const
const LARGE_WORK_AREA: WindowBounds = { x: 0, y: 24, width: 1440, height: 876 }
const TINY_WORK_AREA: WindowBounds = { x: 0, y: 0, width: 300, height: 400 }
const CASCADE_OFFSET = 28

function visiblyDistinct(first: WindowBounds, second: WindowBounds): boolean {
  return (
    Math.abs(first.x - second.x) >= CASCADE_OFFSET ||
    Math.abs(first.y - second.y) >= CASCADE_OFFSET ||
    Math.abs(first.width - second.width) >= CASCADE_OFFSET ||
    Math.abs(first.height - second.height) >= CASCADE_OFFSET
  )
}

function visiblePlacementExists(source: WindowBounds, workArea: WindowBounds): boolean {
  const sizes = [
    { width: source.width, height: source.height },
    {
      width: Math.min(NARROW_WIDTH, workArea.width),
      height: Math.min(DEFAULT_WINDOW_HEIGHT, workArea.height)
    }
  ]
  return sizes.some(({ width, height }) => {
    const maxX = workArea.x + workArea.width - width
    const maxY = workArea.y + workArea.height - height
    return (
      Math.abs(width - source.width) >= CASCADE_OFFSET ||
      Math.abs(height - source.height) >= CASCADE_OFFSET ||
      Math.max(Math.abs(workArea.x - source.x), Math.abs(maxX - source.x)) >= CASCADE_OFFSET ||
      Math.max(Math.abs(workArea.y - source.y), Math.abs(maxY - source.y)) >= CASCADE_OFFSET
    )
  })
}

function criticalPositions(start: number, extent: number): number[] {
  const end = start + extent
  return [
    ...new Set([
      start,
      start + 1,
      start + 8,
      start + 27,
      start + 28,
      end - 28,
      end - 27,
      end - 8,
      end - 1,
      end
    ])
  ].filter((position) => position >= start && position <= end)
}

class FakeWindow implements ManagedWindow {
  private readonly listeners = new Map<string, Array<() => void>>()
  minimums: Array<{ width: number; height: number }> = []

  constructor(
    readonly name: string,
    private bounds: WindowBounds
  ) {}

  isDestroyed(): boolean {
    return false
  }

  getBounds(): WindowBounds {
    return { ...this.bounds }
  }

  setBounds(bounds: WindowBounds): void {
    this.bounds = { ...bounds }
  }

  setMinimumSize(width: number, height: number): void {
    this.minimums.push({ width, height })
  }

  on(event: string, listener: () => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  focusForTest(): void {
    for (const listener of this.listeners.get('focus') ?? []) listener()
  }
}

async function harness(): Promise<{ store: ViewStateStore; manager: WindowManager<FakeWindow> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dtc-window-lifecycle-'))
  const store = new ViewStateStore(path.join(dir, 'view-state.json'))
  return { store, manager: new WindowManager(store) }
}

describe('window lifecycle composition', () => {
  test('the shared route-back handler reopens the preserved slot when no window exists', () => {
    const created: string[] = []
    const raised: string[] = []
    const handler = createEnsureWindowAndRaiseHandler<string, string>({
      focusTarget: () => null,
      reopenSlot: () => 'window-1',
      createWindow: (slot) => created.push(slot),
      raiseWindow: (window) => raised.push(window)
    })

    handler()

    expect(created).toEqual(['window-1'])
    expect(raised).toEqual([])
  })

  test('the shared route-back handler raises the existing window without creating another', () => {
    const created: string[] = []
    const raised: string[] = []
    const handler = createEnsureWindowAndRaiseHandler<string, string>({
      focusTarget: () => 'existing-window',
      reopenSlot: () => 'window-1',
      createWindow: (slot) => created.push(slot),
      raiseWindow: (window) => raised.push(window)
    })

    handler()

    expect(created).toEqual([])
    expect(raised).toEqual(['existing-window'])
  })

  test('first-launch geometry and minimums both fit the target tiny display', () => {
    expect(windowGeometryForCreation(undefined, TINY_WORK_AREA)).toEqual({
      bounds: { width: 300, height: 400 },
      minimumSize: { minWidth: 300, minHeight: 400 }
    })
  })

  test('moving from a tiny display to a large display restores the designed minimums', () => {
    const win = new FakeWindow('moving', { x: 0, y: 0, width: 300, height: 400 })
    const workAreaForBounds = (bounds: WindowBounds): WindowBounds =>
      bounds.x < 1000 ? TINY_WORK_AREA : { ...LARGE_WORK_AREA, x: 1000 }

    reviseWindowMinimums(win, workAreaForBounds)
    win.setBounds({ x: 1100, y: 24, width: 460, height: 600 })
    reviseWindowMinimums(win, workAreaForBounds)

    expect(win.minimums).toEqual([
      { width: 300, height: 400 },
      { width: 420, height: 560 }
    ])
  })

  test('display reconciliation confines an unplugged-display window and revises its minimums', () => {
    const remainingDisplay = { x: 0, y: 24, width: 1440, height: 876 }
    const win = new FakeWindow('unplugged', { x: 1800, y: 100, width: 860, height: 700 })

    reconcileWindowToWorkArea(win, remainingDisplay)

    expect(win.getBounds()).toEqual({ x: 580, y: 100, width: 860, height: 700 })
    expect(win.minimums).toEqual([{ width: 420, height: 560 }])
  })

  test('reset changes only the invoking window layout and geometry', async () => {
    const { store, manager } = await harness()
    const invokingLayout = { pinned: true, widthPreset: 'wide', windowMode: 'docked' } as const
    const otherLayout = { pinned: false, widthPreset: 'wide', windowMode: 'free' } as const
    store.ensureWindow('window-1', invokingLayout)
    store.ensureWindow('window-2', otherLayout)
    const invoking = new FakeWindow('invoking', { x: 980, y: 24, width: 460, height: 876 })
    const other = new FakeWindow('focused-elsewhere', { x: 20, y: 40, width: 860, height: 700 })
    manager.register(invoking, 'window-1')
    manager.register(other, 'window-2')
    other.focusForTest()

    resetWindowPosition(invoking, LARGE_WORK_AREA, manager, DEFAULT_LAYOUT)

    expect(invoking.getBounds()).toEqual({ x: 490, y: 72, width: 460, height: 780 })
    expect(store.getWindow('window-1')?.layout).toEqual({
      pinned: true,
      widthPreset: 'narrow',
      windowMode: 'free'
    })
    expect(other.getBounds()).toEqual({ x: 20, y: 40, width: 860, height: 700 })
    expect(store.getWindow('window-2')?.layout).toEqual(otherLayout)
  })

  test('new-window persistence stores the final post-sanitise bounds', async () => {
    const { store, manager } = await harness()
    const sourceLayout = { pinned: true, widthPreset: 'narrow', windowMode: 'docked' } as const
    store.ensureWindow('window-1', sourceLayout)
    const source = new FakeWindow('source', { x: 980, y: 24, width: 460, height: 876 })
    manager.register(source, 'window-1')
    source.focusForTest()

    const next = finaliseNewWindowState(
      manager.newWindowState(DEFAULT_LAYOUT, LARGE_WORK_AREA),
      LARGE_WORK_AREA
    )
    const slot = manager.createSlot(next.layout as WindowLayoutPreferences, next.bounds)

    expect(slot.bounds).toEqual({ x: 952, y: 24, width: 460, height: 876 })
    expect(store.getWindow(slot.slot)?.bounds).toEqual(slot.bounds)
  })

  test('full-work-area pinned windows compose to distinct cascaded construction bounds', async () => {
    const { store, manager } = await harness()
    const sourceLayout = { pinned: true, widthPreset: 'wide', windowMode: 'free' } as const
    store.ensureWindow('window-1', sourceLayout)
    const source = new FakeWindow('source', LARGE_WORK_AREA)
    manager.register(source, 'window-1')
    source.focusForTest()

    const constructionBounds: WindowBounds[] = []
    for (let press = 0; press < 2; press += 1) {
      const next = finaliseNewWindowState(
        manager.newWindowState(DEFAULT_LAYOUT, LARGE_WORK_AREA),
        LARGE_WORK_AREA
      )
      const geometry = windowGeometryForCreation(next.bounds, LARGE_WORK_AREA)

      expect(next.layout).toEqual({
        pinned: true,
        widthPreset: 'narrow',
        windowMode: 'free'
      })
      expect(next.preventPinnedOverlap).toBeUndefined()
      expect(geometry.bounds).toEqual(
        press === 0
          ? { x: 980, y: 120, width: NARROW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }
          : { x: 952, y: 92, width: NARROW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }
      )

      const bounds = geometry.bounds as WindowBounds
      constructionBounds.push(bounds)
      const slot = manager.createSlot(next.layout, bounds)
      const created = new FakeWindow(`created-${press}`, bounds)
      manager.register(created, slot.slot)
      created.focusForTest()
    }

    expect(constructionBounds[0]).not.toEqual(LARGE_WORK_AREA)
    expect(constructionBounds[1]).not.toEqual(constructionBounds[0])
  })

  test('post-sanitise cascade is distinct or unpinned only when no valid placement exists', async () => {
    const { store, manager } = await harness()
    const sourceLayout = { pinned: true, widthPreset: 'narrow', windowMode: 'free' } as const
    store.ensureWindow('window-1', sourceLayout)
    const sourceWindow = new FakeWindow('source', LARGE_WORK_AREA)
    manager.register(sourceWindow, 'window-1')
    sourceWindow.focusForTest()
    const workAreas = [
      { x: 0, y: 0, width: 488, height: 808 },
      { x: -500, y: 20, width: 500, height: 820 },
      { x: 100, y: -200, width: 515, height: 835 },
      { x: 0, y: 24, width: 800, height: 900 },
      LARGE_WORK_AREA
    ]

    for (const workArea of workAreas) {
      const widths = [
        ...new Set([420, 460, workArea.width - 28, workArea.width - 27, workArea.width])
      ].filter((width) => width > 0 && width <= workArea.width)
      const heights = [
        ...new Set([560, 780, workArea.height - 28, workArea.height - 27, workArea.height])
      ].filter((height) => height > 0 && height <= workArea.height)
      for (const width of widths) {
        for (const height of heights) {
          for (const x of criticalPositions(workArea.x, workArea.width - width)) {
            for (const y of criticalPositions(workArea.y, workArea.height - height)) {
              const source = { x, y, width, height }
              sourceWindow.setBounds(source)
              const next = finaliseNewWindowState(
                manager.newWindowState(DEFAULT_LAYOUT, workArea),
                workArea
              )
              const finalBounds = windowGeometryForCreation(next.bounds, workArea)
                .bounds as WindowBounds
              const distinct = visiblyDistinct(finalBounds, source)

              expect(
                distinct ||
                  (next.preventPinnedOverlap === true && !visiblePlacementExists(source, workArea))
              ).toBe(true)
              if (!distinct) expect(next.layout.pinned).toBe(false)
            }
          }
        }
      }
    }
  })
})
