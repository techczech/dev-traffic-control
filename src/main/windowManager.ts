import {
  DEFAULT_WINDOW_HEIGHT,
  NARROW_WIDTH,
  sanitiseRestoredBounds,
  WindowLayoutState,
  type WindowBounds
} from './windowLayout'
import type { PersistedWindowState, ViewStateStore, WindowLayoutPreferences } from './viewState'

export interface ManagedWindow {
  isDestroyed(): boolean
  getBounds(): WindowBounds
  on(event: string, listener: () => void): this
}

interface WindowEntry<Window extends ManagedWindow> {
  window: Window
  slot: string
  layout: WindowLayoutState
}

const NEW_WINDOW_CASCADE_OFFSET = 28

function cascadeAxis(position: number, areaStart: number, areaSize: number, size: number): number {
  const maxPosition = areaStart + areaSize - size
  if (maxPosition - position >= NEW_WINDOW_CASCADE_OFFSET) {
    return position + NEW_WINDOW_CASCADE_OFFSET
  }
  if (position - areaStart >= NEW_WINDOW_CASCADE_OFFSET) {
    return position - NEW_WINDOW_CASCADE_OFFSET
  }
  return position
}

function visiblyDistinct(first: WindowBounds, second: WindowBounds): boolean {
  return (
    Math.abs(first.x - second.x) >= NEW_WINDOW_CASCADE_OFFSET ||
    Math.abs(first.y - second.y) >= NEW_WINDOW_CASCADE_OFFSET ||
    Math.abs(first.width - second.width) >= NEW_WINDOW_CASCADE_OFFSET ||
    Math.abs(first.height - second.height) >= NEW_WINDOW_CASCADE_OFFSET
  )
}

function narrowFarEdgeCascade(source: WindowBounds, workArea: WindowBounds): WindowBounds {
  const width = Math.min(NARROW_WIDTH, workArea.width)
  const height = Math.min(DEFAULT_WINDOW_HEIGHT, workArea.height)
  return sanitiseRestoredBounds(
    {
      x: source.x + source.width,
      y: source.y + source.height,
      width,
      height
    },
    workArea
  )!
}

export class WindowManager<Window extends ManagedWindow> {
  private readonly entries = new Map<Window, WindowEntry<Window>>()
  private quitting = false
  private lastFocused: Window | null = null

  constructor(private readonly viewStateStore: ViewStateStore) {}

  startupSlots(defaultLayout: WindowLayoutPreferences): PersistedWindowState[] {
    const existing = this.viewStateStore.listWindows()
    if (existing.length > 0) return existing
    return [this.viewStateStore.ensureWindow('window-1', defaultLayout)]
  }

  /**
   * A slot no live window is using and no persisted record claims.
   *
   * Both halves are load-bearing. The persisted list alone is not enough: it
   * can be pruned, or lag a window that has not written yet, and handing out a
   * slot a live window already occupies means the next `setWindowScope` on that
   * slot changes the project of a window somebody is reading. The rule is that a link
   * never touches a window that already exists, and slot reuse would break it
   * from underneath.
   */
  createSlot(defaultLayout: WindowLayoutPreferences, bounds?: WindowBounds): PersistedWindowState {
    const used = new Set([
      ...this.viewStateStore.listWindows().map((window) => window.slot),
      ...this.liveSlots()
    ])
    let index = 1
    while (used.has(`window-${index}`)) index += 1
    return this.viewStateStore.ensureWindow(`window-${index}`, defaultLayout, bounds)
  }

  /** The slots currently bound to windows that are still open. */
  liveSlots(): string[] {
    const slots: string[] = []
    for (const [window, entry] of this.entries) {
      if (!window.isDestroyed()) slots.push(entry.slot)
    }
    return slots
  }

  reopenSlot(defaultLayout: WindowLayoutPreferences): PersistedWindowState {
    return this.viewStateStore.listWindows()[0] ?? this.createSlot(defaultLayout)
  }

  register(window: Window, slot: string): void {
    const entry: WindowEntry<Window> = { window, slot, layout: new WindowLayoutState() }
    this.entries.set(window, entry)
    const persistBounds = (): void => {
      if (!window.isDestroyed()) this.viewStateStore.setWindowBounds(slot, window.getBounds())
    }
    window.on('move', persistBounds)
    window.on('resize', persistBounds)
    window.on('close', persistBounds)
    window.on('focus', () => {
      this.lastFocused = window
    })
    window.on('closed', () => {
      const hasOtherLiveWindow = [...this.entries.keys()].some(
        (candidate) => candidate !== window && !candidate.isDestroyed()
      )
      this.entries.delete(window)
      if (this.lastFocused === window) this.lastFocused = null
      if (!this.quitting && hasOtherLiveWindow) this.viewStateStore.removeWindow(slot)
    })
  }

  beginQuit(): void {
    this.quitting = true
    for (const entry of this.entries.values()) {
      if (!entry.window.isDestroyed()) {
        this.viewStateStore.setWindowBounds(entry.slot, entry.window.getBounds())
      }
    }
  }

  liveWindows(): Window[] {
    return [...this.entries.keys()].filter((window) => !window.isDestroyed())
  }

  focusTarget(): Window | null {
    if (this.lastFocused && !this.lastFocused.isDestroyed()) return this.lastFocused
    return this.liveWindows()[0] ?? null
  }

  layoutForNewWindow(fallback: WindowLayoutPreferences): WindowLayoutPreferences {
    const source = this.focusTarget()
    const inherited = source ? (this.stateFor(source)?.layout ?? fallback) : fallback
    return {
      ...inherited,
      windowMode: inherited.windowMode === 'docked' ? 'free' : inherited.windowMode
    }
  }

  newWindowState(
    fallback: WindowLayoutPreferences,
    workArea?: WindowBounds
  ): {
    layout: WindowLayoutPreferences
    bounds?: WindowBounds
    preventPinnedOverlap?: true
  } {
    const source = this.focusTarget()
    const sourceBounds = source?.getBounds()
    const confinedSource =
      sourceBounds && workArea ? sanitiseRestoredBounds(sourceBounds, workArea) : sourceBounds
    const cascadedBounds = confinedSource
      ? {
          ...confinedSource,
          x: workArea
            ? cascadeAxis(confinedSource.x, workArea.x, workArea.width, confinedSource.width)
            : confinedSource.x + NEW_WINDOW_CASCADE_OFFSET,
          y: workArea
            ? cascadeAxis(confinedSource.y, workArea.y, workArea.height, confinedSource.height)
            : confinedSource.y + NEW_WINDOW_CASCADE_OFFSET
        }
      : undefined
    const inheritedLayout = this.layoutForNewWindow(fallback)
    const visiblyOffset =
      !confinedSource ||
      !cascadedBounds ||
      cascadedBounds.x !== confinedSource.x ||
      cascadedBounds.y !== confinedSource.y
    const narrowFallback =
      confinedSource && workArea && !visiblyOffset
        ? narrowFarEdgeCascade(confinedSource, workArea)
        : undefined
    const finalBounds = narrowFallback ?? cascadedBounds
    const visiblyPlaced =
      !confinedSource || !finalBounds || visiblyDistinct(finalBounds, confinedSource)
    const finalLayout = narrowFallback
      ? { ...inheritedLayout, widthPreset: 'narrow' as const }
      : inheritedLayout
    return {
      layout: visiblyPlaced ? finalLayout : { ...finalLayout, pinned: false },
      ...(finalBounds ? { bounds: finalBounds } : {}),
      ...(!visiblyPlaced ? { preventPinnedOverlap: true as const } : {})
    }
  }

  slotFor(window: Window | null): string | null {
    return window ? (this.entries.get(window)?.slot ?? null) : null
  }

  layoutFor(window: Window | null): WindowLayoutState | null {
    return window ? (this.entries.get(window)?.layout ?? null) : null
  }

  stateFor(window: Window | null): PersistedWindowState | null {
    const slot = this.slotFor(window)
    return slot ? this.viewStateStore.getWindow(slot) : null
  }

  setLayout(window: Window, layout: WindowLayoutPreferences): PersistedWindowState | null {
    const slot = this.slotFor(window)
    return slot ? this.viewStateStore.setWindowLayout(slot, layout) : null
  }
}
