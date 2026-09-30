import {
  centredDefaultBounds,
  DEFAULT_WINDOW_HEIGHT,
  minimumWindowSize,
  NARROW_WIDTH,
  sanitiseRestoredBounds,
  validBounds,
  type WindowBounds
} from './windowLayout'
import type { PersistedWindowState, WindowLayoutPreferences } from './viewState'

export interface BoundsWindow {
  getBounds(): WindowBounds
  setBounds(bounds: WindowBounds): void
}

export interface MinimumSizeWindow {
  getBounds(): WindowBounds
  setMinimumSize(width: number, height: number): void
}

interface EnsureWindowAndRaiseOptions<Window, Slot> {
  focusTarget(): Window | null
  reopenSlot(): Slot
  createWindow(slot: Slot): void
  raiseWindow(window: Window): void
}

interface WindowLayoutManager<Window> {
  stateFor(window: Window): PersistedWindowState | null
  layoutFor(window: Window): { resetDockMemory(): void } | null
  setLayout(window: Window, layout: WindowLayoutPreferences): PersistedWindowState | null
}

export function windowGeometryForCreation(
  persistedBounds: WindowBounds | undefined,
  workArea: WindowBounds
): {
  bounds: WindowBounds | { width: number; height: number }
  minimumSize: { minWidth: number; minHeight: number }
} {
  const restoredBounds =
    persistedBounds && validBounds(persistedBounds)
      ? sanitiseRestoredBounds(persistedBounds, workArea)
      : undefined
  return {
    bounds: restoredBounds ?? {
      width: Math.min(NARROW_WIDTH, workArea.width),
      height: Math.min(DEFAULT_WINDOW_HEIGHT, workArea.height)
    },
    minimumSize: minimumWindowSize(workArea)
  }
}

export function reviseWindowMinimums<Window extends MinimumSizeWindow>(
  win: Window,
  workAreaForBounds: (bounds: WindowBounds) => WindowBounds
): void {
  const workArea = workAreaForBounds(win.getBounds())
  const { minWidth, minHeight } = minimumWindowSize(workArea)
  win.setMinimumSize(minWidth, minHeight)
}

/** One route back into the app for Dock activation and a second launch. */
export function createEnsureWindowAndRaiseHandler<Window, Slot>(
  options: EnsureWindowAndRaiseOptions<Window, Slot>
): () => void {
  return (): void => {
    const target = options.focusTarget()
    if (target) {
      options.raiseWindow(target)
      return
    }
    options.createWindow(options.reopenSlot())
  }
}

/** Reconcile a window against the surviving nearest display after topology changes. */
export function reconcileWindowToWorkArea<Window extends BoundsWindow & MinimumSizeWindow>(
  win: Window,
  workArea: WindowBounds
): void {
  const confined = sanitiseRestoredBounds(win.getBounds(), workArea)
  if (confined) win.setBounds(confined)
  reviseWindowMinimums(win, () => workArea)
}

export function resetWindowPosition<Window extends BoundsWindow>(
  invokingWindow: Window,
  workArea: WindowBounds,
  manager: WindowLayoutManager<NoInfer<Window>>,
  fallback: WindowLayoutPreferences
): void {
  const bounds = centredDefaultBounds(workArea)
  const current = manager.stateFor(invokingWindow)?.layout ?? fallback
  manager.layoutFor(invokingWindow)?.resetDockMemory()
  manager.setLayout(invokingWindow, {
    ...current,
    widthPreset: 'narrow',
    windowMode: 'free'
  })
  if (bounds) invokingWindow.setBounds(bounds)
}

export function finaliseNewWindowState(
  state: {
    layout: WindowLayoutPreferences
    bounds?: WindowBounds
    preventPinnedOverlap?: true
  },
  workArea: WindowBounds
): {
  layout: WindowLayoutPreferences
  bounds?: WindowBounds
  preventPinnedOverlap?: true
} {
  const bounds = state.bounds ? sanitiseRestoredBounds(state.bounds, workArea) : undefined
  return {
    layout: state.layout,
    ...(bounds ? { bounds } : {}),
    ...(state.preventPinnedOverlap ? { preventPinnedOverlap: true as const } : {})
  }
}
