/**
 * No big window stays on top.
 *
 * The width is the pin: narrowing a window to the
 * sidebar width always pins it (drag, the Narrow command, docking), widening
 * past it always unpins, and a restart restores sidebar windows pinned and wide
 * windows unpinned. The pin button still overrides until the next size change.
 *
 * Invariant: a window wider than the sidebar is never always-on-top for good and
 * its saved pin is always off. One exception: pressing the pin on a wide window
 * pins it for now (on top, control shows pinned, `TemporaryPin`); the next size
 * change across the sidebar width, either way, ends it; it is never saved, so
 * a restart brings the window back unpinned. The resize events (maximise, full screen, a drag wider) are
 * one route. Windows also reach a wide, on-top state by
 * other routes: restored from saved bounds with a saved pin, un-docked back to
 * the wide bounds from before the dock, the pin button pressed on a wide
 * window, and the floating lift a link window gets above a pinned peer. This
 * module holds the rule once; every route ends here.
 *
 * The one allowed exception is the lift: a link's window may sit one level above
 * the pinned sidebar so it is not hidden behind it, until the reviewer first leaves it
 * (blur) or first touches it (a click, a key, a drag). `LinkLift` is that flag.
 */

/** A saved pin is allowed only while the window is no wider than the sidebar. */
export function mayBePinned(width: number, sidebarWidth: number): boolean {
  return width <= sidebarWidth
}

export interface PinState {
  /** The pin the layout (and the pin control) says. */
  layoutPinned: boolean
  /** Whether the window really is always-on-top. */
  alwaysOnTop: boolean
}

/** What a window's pin and level must be, given its width right now. */
export function settlePin(
  width: number,
  state: PinState,
  lifted: boolean,
  sidebarWidth: number,
  temporary = false
): PinState {
  if (mayBePinned(width, sidebarWidth)) return state
  if (temporary) return state
  return { layoutPinned: false, alwaysOnTop: state.alwaysOnTop && lifted }
}

/** Whether a link window is currently lifted above a pinned peer. */
export class LinkLift {
  active = false
}

/** Whether a wide window is pinned temporarily (never persisted). */
export class TemporaryPin {
  active = false
}

export interface PinGuardWindow {
  on(event: string, listener: () => void): unknown
  getBounds(): { width: number }
  isDestroyed(): boolean
  isAlwaysOnTop(): boolean
  setAlwaysOnTop(flag: boolean): void
}

export interface PinGuardOptions {
  sidebarWidth: number
  lift: LinkLift
  temporary: TemporaryPin
  /** Pinned in any way: the saved pin or the temporary one. */
  isPinned: () => boolean
  /** The pin button's own path: level, persisted layout and the control agree. */
  unpin: () => void
  /** The pin button's own path, pressing pin on: a saved pin on a sidebar window. */
  pin: () => void
}

/** Events after which the width, or what the window is, may have changed. */
export const PIN_GUARD_EVENTS = [
  'resize',
  'maximize',
  'unmaximize',
  'enter-full-screen',
  'leave-full-screen',
  'restore'
] as const

export interface PinGuard {
  /** Bring pin and level in line with the width now. Safe to call at any time. */
  settle(): void
}

export function guardPinInvariant(win: PinGuardWindow, options: PinGuardOptions): PinGuard {
  let wasWide = !mayBePinned(win.getBounds().width, options.sidebarWidth)
  const settle = (): void => {
    if (win.isDestroyed()) return
    const width = win.getBounds().width
    const wide = !mayBePinned(width, options.sidebarWidth)
    // Sidebar = pinned: crossing the sidebar width always sets the
    // pin to the new side, whatever it was before and whoever moved the window.
    // Narrowing pins (a temporary pin becomes a saved one); widening unpins.
    // Between crossings the pin button is free to say otherwise.
    if (wide !== wasWide) {
      wasWide = wide
      if (wide) {
        if (options.isPinned()) options.unpin()
      } else {
        // Also when already pinned: a temporary pin turns into a saved one.
        options.pin()
      }
    }
    const next = settlePin(
      width,
      { layoutPinned: options.isPinned(), alwaysOnTop: win.isAlwaysOnTop() },
      options.lift.active,
      options.sidebarWidth,
      options.temporary.active
    )
    if (options.isPinned() && !next.layoutPinned) options.unpin()
    if (win.isAlwaysOnTop() && !next.alwaysOnTop) win.setAlwaysOnTop(false)
  }
  for (const event of PIN_GUARD_EVENTS) win.on(event, settle)
  return { settle }
}
