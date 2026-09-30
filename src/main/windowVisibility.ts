import type { BrowserWindow } from 'electron'

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
}

/**
 * A window he just asked for by a link is never hidden behind another Dev
 * Traffic Control window (ticket 26). It is shown, the app takes focus, and it
 * is ordered to the top of its level and focused.
 *
 * A pinned sidebar shares the `floating` level with any older pinned one, so
 * ordering it to the top of that level is enough. An ordinary window cannot
 * sit above a floating one, so while a pinned peer exists it is lifted one
 * step above the floating level until it first loses focus, then dropped back
 * to an ordinary window (unless he pinned it meanwhile). Hidden test mode
 * never shows or raises anything.
 */
export function bringWindowForward(win: ForwardableWindow, options: BringForwardOptions): void {
  if (options.hiddenTestMode || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  options.focusApp?.()
  if (!options.isPinned() && options.pinnedPeerExists()) {
    win.setAlwaysOnTop(true, 'floating', 1)
    win.once('blur', () => {
      if (!win.isDestroyed() && !options.isPinned()) win.setAlwaysOnTop(false)
    })
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
  // window; headed windows are reserved for checks Dominik is watching.
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
