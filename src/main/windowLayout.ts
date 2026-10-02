import type { DockEdge, Settings } from '../shared/ipc'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export const NARROW_WIDTH = 460
/**
 * The expanded width. It must hold the project rail beside a full surface
 * (RAIL_MIN_WINDOW_WIDTH, 1013px, in src/renderer/src/lib/railVisibility.ts);
 * the old 860px strip never did, so pressing expand showed no rail. Clamped to
 * the display's work area wherever it is applied.
 */
export const WIDE_WIDTH = 1280
export const DEFAULT_WINDOW_HEIGHT = 780
export const MIN_WINDOW_WIDTH = 420
export const MIN_WINDOW_HEIGHT = 560

export const PRESET_WIDTH: Record<Settings['widthPreset'], number> = {
  narrow: NARROW_WIDTH,
  wide: WIDE_WIDTH
}

export function minimumWindowSize(bounds?: WindowBounds): {
  minWidth: number
  minHeight: number
} {
  return {
    minWidth: Math.min(MIN_WINDOW_WIDTH, bounds?.width ?? MIN_WINDOW_WIDTH),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, bounds?.height ?? MIN_WINDOW_HEIGHT)
  }
}

type DockSettings = Pick<Settings, 'pinned' | 'widthPreset' | 'windowMode'>

/**
 * Docking makes the window the narrow sidebar and keeps it docked. It never
 * touches the pin: the pin is whether it stays on top, the dock is where it
 * goes.
 */
export function settingsForDock(current: DockSettings): DockSettings {
  return { pinned: current.pinned, widthPreset: 'narrow', windowMode: 'docked' }
}

/**
 * Only the narrow sidebar is ever pinned: expanding
 * unpins the window, and narrowing it again pins it back.
 */
export function pinnedForPreset(preset: Settings['widthPreset']): boolean {
  return preset === 'narrow'
}

/** Move and, if it must, shrink bounds so no part lies outside the work area. */
export function fitToWorkArea(bounds: WindowBounds, workArea: WindowBounds): WindowBounds {
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height
  }
}

/** Free mode: change the width, keep position and height, stay on screen. */
export function freeBoundsForPreset(
  current: WindowBounds,
  workArea: WindowBounds,
  preset: Settings['widthPreset']
): WindowBounds {
  return fitToWorkArea({ ...current, width: PRESET_WIDTH[preset] }, workArea)
}

function dockedBounds(workArea: WindowBounds, width: number, edge: DockEdge): WindowBounds {
  const boundedWidth = Math.min(width, workArea.width)
  return {
    x: edge === 'left' ? workArea.x : workArea.x + workArea.width - boundedWidth,
    y: workArea.y,
    width: boundedWidth,
    height: workArea.height
  }
}

/** Confine persisted geometry to one display before BrowserWindow sees it. */
export function sanitiseRestoredBounds(
  bounds: WindowBounds,
  workArea: WindowBounds
): WindowBounds | undefined {
  if (!validBounds(bounds) || !validBounds(workArea)) return undefined
  const width = Math.min(workArea.width, Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width)))
  const height = Math.min(workArea.height, Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height)))
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height
  return {
    x: Math.min(maxX, Math.max(workArea.x, Math.round(bounds.x))),
    y: Math.min(maxY, Math.max(workArea.y, Math.round(bounds.y))),
    width,
    height
  }
}

/** The recovery geometry used by the Reset window position command. */
export function centredDefaultBounds(workArea: WindowBounds): WindowBounds | undefined {
  if (!validBounds(workArea)) return undefined
  const width = Math.min(NARROW_WIDTH, workArea.width)
  const height = Math.min(DEFAULT_WINDOW_HEIGHT, workArea.height)
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  }
}

export function validBounds(bounds: WindowBounds): boolean {
  return (
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}

/** Runtime layout memory for reversible dock and narrow actions. */
export class WindowLayoutState {
  preDockBounds: WindowBounds | null = null
  private preNarrowWidth: number | null = null

  dock(current: WindowBounds, workArea: WindowBounds, edge: DockEdge = 'right'): WindowBounds {
    if (!this.preDockBounds) this.preDockBounds = { ...current }
    if (current.width > NARROW_WIDTH) this.preNarrowWidth = current.width
    return dockedBounds(workArea, NARROW_WIDTH, edge)
  }

  resizeDocked(
    current: WindowBounds,
    workArea: WindowBounds,
    preset: Settings['widthPreset'],
    edge: DockEdge = 'right'
  ): WindowBounds {
    if (preset === 'narrow') {
      if (current.width > NARROW_WIDTH) this.preNarrowWidth = current.width
      return dockedBounds(workArea, NARROW_WIDTH, edge)
    }
    // A width remembered from before the rail existed can be narrower than the
    // rail needs; expanding must always reach at least WIDE_WIDTH.
    return dockedBounds(workArea, Math.max(this.preNarrowWidth ?? WIDE_WIDTH, WIDE_WIDTH), edge)
  }

  undock(current: WindowBounds, preset: Settings['widthPreset']): WindowBounds {
    const restored = this.preDockBounds
      ? { ...this.preDockBounds }
      : { ...current, width: PRESET_WIDTH[preset] }
    this.preDockBounds = null
    return restored
  }

  resetDockMemory(): void {
    this.preDockBounds = null
    this.preNarrowWidth = null
  }
}
