import type { BrowserWindow } from 'electron'
import type { LinkLift } from './pinInvariant'

export function isHiddenWindowTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  // Harnesses commonly write 0 or false explicitly; neither should hide the app.
  const value = env['DTC_TEST_MODE']?.trim().toLowerCase()
  return value !== undefined && value !== '' && value !== '0' && value !== 'false'
}

export function showWindowForSecondInstance(win: BrowserWindow, hiddenTestMode: boolean): void {
  if (hiddenTestMode) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** What bringing a link's window forward needs from Electron. */
export interface ForwardableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  moveTop(): void
  setAlwaysOnTop(flag: boolean, level?: 'floating', relativeLevel?: number): void
  once(event: 'blur', listener: () => void): unknown
}

export interface BringForwardOptions {
  hiddenTestMode: boolean
  /** Whether this window is pinned (its own layout, not its current level). */
  isPinned: () => boolean
  /** Whether any OTHER live Dev Traffic Control window is pinned. */
  pinnedPeerExists: () => boolean
  /** macOS: activate the app even when another app is frontmost. */
  focusApp?: () => void
  /** Set while the window is lifted above a pinned peer (see pinInvariant.ts). */
  lift?: LinkLift
  /**
   * Calls `listener` on his first touch of the window: a click, a key, a drag.
   * Returns a function that stops listening.
   */
  watchInteraction?: (listener: () => void) => () => void
}

/**
 * A window he just asked for by a link is never hidden behind another Dev
 * Traffic Control window (ticket 26). It is shown, the app takes focus, and it
 * is ordered to the top of its level and focused.
 *
 * A pinned sidebar shares the `floating` level with any older pinned one, so
 * ordering it to the top of that level is enough. An ordinary window cannot
 * sit above a floating one, so while a pinned peer exists it is lifted one
 * step above the floating level until it first loses focus OR he first touches
 * it, whichever comes first, then dropped back to an ordinary window (unless he
 * pinned it meanwhile; a pin only ever holds on a sidebar-sized window, see
 * pinInvariant.ts). Hidden test mode never shows or raises anything.
 */
export function bringWindowForward(win: ForwardableWindow, options: BringForwardOptions): void {
  if (options.hiddenTestMode || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  options.focusApp?.()
  if (!options.isPinned() && options.pinnedPeerExists()) {
    win.setAlwaysOnTop(true, 'floating', 1)
    if (options.lift) options.lift.active = true
    let ended = false
    let stopWatching: (() => void) | undefined
    const endLift = (): void => {
      if (ended) return
      ended = true
      stopWatching?.()
      if (options.lift) options.lift.active = false
      if (!win.isDestroyed() && !options.isPinned()) win.setAlwaysOnTop(false)
    }
    win.once('blur', endLift)
    stopWatching = options.watchInteraction?.(endLift)
    if (ended) stopWatching?.()
  }
  win.moveTop()
  win.focus()
}

export function configureWindowVisibility(
  win: BrowserWindow,
  hiddenTestMode: boolean,
  applyInitialLayout: () => void,
  reveal: () => void = () => win.show()
): void {
  // Estate verification rule: Electron tests run in a hidden, unthrottled
  // window; headed windows are reserved for checks the reviewer is watching.
  if (hiddenTestMode) win.webContents.setBackgroundThrottling(false)

  win.on('ready-to-show', () => {
    if (!hiddenTestMode) reveal()
    applyInitialLayout()
  })
  if (hiddenTestMode) return

  // ready-to-show never fires if the first frame is suppressed, so normal
  // launches retain the existing timeout backstop.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) reveal()
  }, 1500)
}
