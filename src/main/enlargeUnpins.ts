/**
 * Every enlargement unpins.
 *
 * Invariant: a pinned window is only ever sidebar-sized. Maximising, the macOS
 * zoom (green button or a double-click on the title bar), entering full screen
 * and dragging an edge wider than the sidebar all turn a pinned window into an
 * ordinary one. Dragging it narrower never pins it back; only the deliberate
 * Narrow command (pinnedForPreset) or the pin button does.
 *
 * The rule is pure; the wiring only listens and calls `unpin`, which the caller
 * routes through the same path as the pin button so the pin control and the
 * persisted window state agree.
 */

/**
 * A resize unpins when it grows the window past the sidebar width. Growth, not
 * size alone: a window the reviewer pinned while it was already wide is the reviewer's choice, and a
 * resize that shrinks it (or leaves the width alone) is not an enlargement.
 */
export function shouldUnpinOnResize(
  previousWidth: number,
  nextWidth: number,
  sidebarWidth: number
): boolean {
  return nextWidth > previousWidth && nextWidth > sidebarWidth
}

export interface EnlargeableWindow {
  on(event: string, listener: () => void): unknown
  getBounds(): { width: number }
  isDestroyed(): boolean
}

export interface EnlargeUnpinsOptions {
  sidebarWidth: number
  isPinned: () => boolean
  unpin: () => void
}

/** Events that are an enlargement whatever the width says. */
export const ENLARGING_EVENTS = ['maximize', 'enter-full-screen'] as const

/**
 * What the watcher hands back: a way for main to say "the next resize is mine".
 * Docking sets the window's bounds itself; that move is never the reviewer's
 * enlargement, and must never unpin or pin.
 */
export interface EnlargementWatch {
  /**
   * Main is about to set the window to `width`. Resizes until the window
   * reports that width (or `settleMs` passes, for a move the window manager
   * clamped) are not enlargements, and the width tracking restarts from it.
   */
  expectProgrammaticResize(width: number): void
}

export interface EnlargementTimers {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const DEFAULT_TIMERS: EnlargementTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export function watchEnlargementUnpins(
  win: EnlargeableWindow,
  options: EnlargeUnpinsOptions,
  timers: EnlargementTimers = DEFAULT_TIMERS,
  settleMs = 750
): EnlargementWatch {
  let lastWidth = win.getBounds().width
  let expected: { width: number; timer: unknown } | null = null
  const unpinIfPinned = (): void => {
    if (!win.isDestroyed() && options.isPinned()) options.unpin()
  }
  for (const event of ENLARGING_EVENTS) win.on(event, unpinIfPinned)
  // `resize` fires during a drag and for the macOS zoom; the width is tracked
  // on every one so a drag that narrows first and widens later is still seen.
  win.on('resize', () => {
    if (win.isDestroyed()) return
    const width = win.getBounds().width
    if (expected) {
      lastWidth = width
      if (width === expected.width) {
        timers.clearTimeout(expected.timer)
        expected = null
      }
      return
    }
    const grew = shouldUnpinOnResize(lastWidth, width, options.sidebarWidth)
    lastWidth = width
    if (grew) unpinIfPinned()
  })
  return {
    expectProgrammaticResize(width: number): void {
      if (expected) timers.clearTimeout(expected.timer)
      const timer = timers.setTimeout(() => {
        expected = null
        if (!win.isDestroyed()) lastWidth = win.getBounds().width
      }, settleMs)
      expected = { width, timer }
    }
  }
}
