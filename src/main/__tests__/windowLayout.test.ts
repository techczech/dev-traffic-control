import { describe, expect, test } from 'vitest'
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  NARROW_WIDTH,
  WindowLayoutState,
  settingsForDock,
  type WindowBounds
} from '../windowLayout'
import * as windowLayout from '../windowLayout'

const WORK_AREA: WindowBounds = { x: 0, y: 24, width: 1440, height: 876 }

describe('dock-to-side window layout', () => {
  test('sanitises absurd restored bounds into the nearest display work area', () => {
    const sanitise = (
      windowLayout as unknown as {
        sanitiseRestoredBounds?: (
          bounds: WindowBounds,
          workArea: WindowBounds
        ) => WindowBounds | undefined
      }
    ).sanitiseRestoredBounds

    expect(
      sanitise?.({ x: -50_000, y: -20_000, width: 100_000, height: 80_000 }, WORK_AREA)
    ).toEqual({ x: 0, y: 24, width: 1440, height: 876 })
  })

  test('falls back when restored bounds cannot be sanitised', () => {
    const sanitise = (
      windowLayout as unknown as {
        sanitiseRestoredBounds?: (
          bounds: WindowBounds,
          workArea: WindowBounds
        ) => WindowBounds | undefined
      }
    ).sanitiseRestoredBounds

    expect(sanitise?.({ x: Number.NaN, y: 20, width: 460, height: 780 }, WORK_AREA)).toBeUndefined()
  })

  test('relaxes minimum enforcement to preserve a tiny display work area', () => {
    const minimums = (
      windowLayout as unknown as {
        minimumWindowSize?: (bounds?: WindowBounds) => { minWidth: number; minHeight: number }
      }
    ).minimumWindowSize

    expect(minimums?.({ x: 0, y: 0, width: 300, height: 400 })).toEqual({
      minWidth: 300,
      minHeight: 400
    })
    expect(minimums?.()).toEqual({ minWidth: MIN_WINDOW_WIDTH, minHeight: MIN_WINDOW_HEIGHT })
  })

  test('centres the default window size inside the selected work area', () => {
    const centre = (
      windowLayout as unknown as {
        centredDefaultBounds?: (workArea: WindowBounds) => WindowBounds | undefined
      }
    ).centredDefaultBounds

    expect(centre?.({ x: 1440, y: 24, width: 1920, height: 1056 })).toEqual({
      x: 2170,
      y: 162,
      width: 460,
      height: 780
    })
  })

  test('docking makes the window narrow and preserves its previous bounds', () => {
    const layout = new WindowLayoutState()
    const original = { x: 160, y: 120, width: 760, height: 640 }

    expect(layout.dock(original, WORK_AREA)).toEqual({
      x: 1440 - NARROW_WIDTH,
      y: 24,
      width: NARROW_WIDTH,
      height: 876
    })
    expect(layout.preDockBounds).toEqual(original)
  })

  // Ticket 27: the pin is whether it stays on top, the dock is where it goes.
  test('docking selects narrow and docked and leaves the pin exactly as it was', () => {
    expect(settingsForDock({ pinned: false, widthPreset: 'wide', windowMode: 'free' })).toEqual({
      pinned: false,
      widthPreset: 'narrow',
      windowMode: 'docked'
    })
    expect(settingsForDock({ pinned: true, widthPreset: 'narrow', windowMode: 'free' })).toEqual({
      pinned: true,
      widthPreset: 'narrow',
      windowMode: 'docked'
    })
  })

  test('a docked window re-snaps to the left edge when that is the last dock place', () => {
    const layout = new WindowLayoutState()
    const original = { x: 400, y: 120, width: 760, height: 640 }
    const narrow = layout.dock(original, WORK_AREA, 'left')

    expect(narrow).toEqual({ x: 0, y: 24, width: NARROW_WIDTH, height: 876 })
    expect(layout.resizeDocked(narrow, WORK_AREA, 'wide', 'left')).toEqual({
      x: 0,
      y: 24,
      width: windowLayout.WIDE_WIDTH,
      height: 876
    })
  })

  test('widening restores a pre-narrow width wider than the expanded preset, keeping the right-edge dock', () => {
    const layout = new WindowLayoutState()
    const original = { x: 20, y: 120, width: 1360, height: 640 }
    const narrow = layout.dock(original, WORK_AREA)

    expect(layout.resizeDocked(narrow, WORK_AREA, 'wide')).toEqual({
      x: 1440 - 1360,
      y: 24,
      width: 1360,
      height: 876
    })
  })

  test('narrowing again remembers the current docked width for the next widen', () => {
    const layout = new WindowLayoutState()
    const original = { x: 20, y: 120, width: 1360, height: 640 }
    const firstNarrow = layout.dock(original, WORK_AREA)
    const wide = layout.resizeDocked(firstNarrow, WORK_AREA, 'wide')
    const secondNarrow = layout.resizeDocked(wide, WORK_AREA, 'narrow')

    expect(layout.resizeDocked(secondNarrow, WORK_AREA, 'wide').width).toBe(1360)
  })

  test('undocking restores the original bounds after either docked width', () => {
    const layout = new WindowLayoutState()
    const original = { x: 160, y: 120, width: 760, height: 640 }
    const narrow = layout.dock(original, WORK_AREA)
    const wide = layout.resizeDocked(narrow, WORK_AREA, 'wide')

    expect(layout.undock(wide, 'wide')).toEqual(original)
    expect(layout.preDockBounds).toBeNull()
  })

  test('resetting position clears all stale dock and width memory', () => {
    const layout = new WindowLayoutState()
    const firstNarrow = layout.dock({ x: -900, y: -600, width: 760, height: 700 }, WORK_AREA)
    const resetDockMemory = (layout as unknown as { resetDockMemory?: () => void }).resetDockMemory

    resetDockMemory?.call(layout)
    expect(layout.preDockBounds).toBeNull()

    const nextNarrow = layout.dock(firstNarrow, WORK_AREA)

    expect(layout.resizeDocked(nextNarrow, WORK_AREA, 'wide').width).toBe(windowLayout.WIDE_WIDTH)
  })
})

// Dominik 2026-09-23: expand did not widen enough to show the rail, did not
// unpin, and could push part of the window off screen.
describe('expanding the window', () => {
  const inside = (b: WindowBounds, wa: WindowBounds): boolean =>
    b.x >= wa.x &&
    b.y >= wa.y &&
    b.x + b.width <= wa.x + wa.width &&
    b.y + b.height <= wa.y + wa.height

  test('only the narrow sidebar is pinned', () => {
    expect(windowLayout.pinnedForPreset('wide')).toBe(false)
    expect(windowLayout.pinnedForPreset('narrow')).toBe(true)
  })

  test('a free window near the right edge expands leftwards and stays on screen', () => {
    const current = { x: 1100, y: 100, width: 460, height: 700 }
    const next = windowLayout.freeBoundsForPreset(current, WORK_AREA, 'wide')
    expect(next.width).toBe(windowLayout.WIDE_WIDTH)
    expect(inside(next, WORK_AREA)).toBe(true)
    expect(next.y).toBe(100)
  })

  test('on a display narrower than the expanded width the window fills it, no more', () => {
    const small = { x: 0, y: 24, width: 1024, height: 700 }
    const next = windowLayout.freeBoundsForPreset(
      { x: 500, y: 40, width: 460, height: 600 },
      small,
      'wide'
    )
    expect(next.width).toBe(1024)
    expect(inside(next, small)).toBe(true)
  })

  test('a docked window remembered at a pre-rail width still expands to the full width', () => {
    const layout = new WindowLayoutState()
    const narrow = layout.dock({ x: 100, y: 100, width: 760, height: 700 }, WORK_AREA)
    const wide = layout.resizeDocked(narrow, WORK_AREA, 'wide')
    expect(wide.width).toBe(windowLayout.WIDE_WIDTH)
    expect(inside(wide, WORK_AREA)).toBe(true)
  })

  test('fitToWorkArea pulls an off-screen window fully back on', () => {
    const next = windowLayout.fitToWorkArea({ x: 1300, y: 800, width: 900, height: 400 }, WORK_AREA)
    expect(inside(next, WORK_AREA)).toBe(true)
    expect(next.width).toBe(900)
  })
})
