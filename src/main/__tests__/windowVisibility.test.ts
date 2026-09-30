import type { BrowserWindow } from 'electron'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bringWindowForward,
  configureWindowVisibility,
  type ForwardableWindow,
  isHiddenWindowTestMode,
  showWindowForSecondInstance
} from '../windowVisibility'

interface WindowHarness {
  win: BrowserWindow
  ready: () => void
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  setBackgroundThrottling: ReturnType<typeof vi.fn>
}

function windowHarness(): WindowHarness {
  let ready = (): void => {
    throw new Error('ready-to-show handler was not registered')
  }
  const show = vi.fn()
  const focus = vi.fn()
  const restore = vi.fn()
  const setBackgroundThrottling = vi.fn()
  const win = {
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'ready-to-show') ready = handler
    }),
    show,
    focus,
    restore,
    isMinimized: vi.fn(() => true),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    webContents: { setBackgroundThrottling }
  } as unknown as BrowserWindow
  return {
    win,
    get ready() {
      return ready
    },
    show,
    focus,
    restore,
    setBackgroundThrottling
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('window visibility policy', () => {
  test('default mode preserves ready-to-show and timeout visibility', () => {
    vi.useFakeTimers()
    const harness = windowHarness()
    const applyInitialLayout = vi.fn()

    configureWindowVisibility(harness.win, false, applyInitialLayout)
    harness.ready()
    expect(harness.show).toHaveBeenCalledTimes(1)
    expect(applyInitialLayout).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1500)
    expect(harness.show).toHaveBeenCalledTimes(2)
    expect(harness.setBackgroundThrottling).not.toHaveBeenCalled()
  })

  test('hidden test mode suppresses both show paths and keeps the runtime live', () => {
    vi.useFakeTimers()
    const harness = windowHarness()
    const applyInitialLayout = vi.fn()

    configureWindowVisibility(harness.win, true, applyInitialLayout)
    harness.ready()
    vi.advanceTimersByTime(1500)

    expect(harness.show).not.toHaveBeenCalled()
    expect(applyInitialLayout).toHaveBeenCalledTimes(1)
    expect(harness.setBackgroundThrottling).toHaveBeenCalledWith(false)
  })

  test('DTC_TEST_MODE is the explicit hidden-window hook', () => {
    expect(isHiddenWindowTestMode({ DTC_TEST_MODE: '1' })).toBe(true)
    expect(isHiddenWindowTestMode({ DTC_TEST_MODE: '0' })).toBe(false)
    expect(isHiddenWindowTestMode({ DTC_TEST_MODE: 'false' })).toBe(false)
    expect(isHiddenWindowTestMode({ DTC_TEST_MODE: 'FALSE' })).toBe(false)
    expect(isHiddenWindowTestMode({ DTC_TEST_MODE: '' })).toBe(false)
    expect(isHiddenWindowTestMode({})).toBe(false)
  })

  test('a second instance keeps a hidden verification window hidden', () => {
    const harness = windowHarness()

    showWindowForSecondInstance(harness.win, true)

    expect(harness.restore).not.toHaveBeenCalled()
    expect(harness.show).not.toHaveBeenCalled()
    expect(harness.focus).not.toHaveBeenCalled()
  })

  test('a second instance restores, shows, and focuses a normal window', () => {
    const harness = windowHarness()

    showWindowForSecondInstance(harness.win, false)

    expect(harness.restore).toHaveBeenCalledTimes(1)
    expect(harness.show).toHaveBeenCalledTimes(1)
    expect(harness.focus).toHaveBeenCalledTimes(1)
  })
})

// Ticket 26: a window he just asked for by a link is never hidden behind
// another Dev Traffic Control window.
interface ForwardHarness {
  win: ForwardableWindow
  calls: string[]
  blur(): void
  hasBlurHandler(): boolean
  destroy(): void
}

function forwardHarness(minimized = false): ForwardHarness {
  const calls: string[] = []
  let blur: (() => void) | null = null
  let destroyed = false
  const win: ForwardableWindow = {
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    moveTop: () => calls.push('moveTop'),
    setAlwaysOnTop: (flag, level, relativeLevel) =>
      calls.push(
        `onTop:${flag}${level ? `:${level}` : ''}${relativeLevel ? `:${relativeLevel}` : ''}`
      ),
    once: (_event, listener) => {
      blur = listener
    }
  }
  return {
    win,
    calls,
    blur: () => blur?.(),
    hasBlurHandler: () => blur !== null,
    destroy: () => {
      destroyed = true
    }
  }
}

describe('bringing a link window forward', () => {
  test('shows, activates the app, moves to the top and focuses', () => {
    const h = forwardHarness(true)
    const focusApp = vi.fn(() => h.calls.push('focusApp'))
    bringWindowForward(h.win, {
      hiddenTestMode: false,
      isPinned: () => false,
      pinnedPeerExists: () => false,
      focusApp
    })
    expect(h.calls).toEqual(['restore', 'show', 'focusApp', 'moveTop', 'focus'])
    expect(h.hasBlurHandler()).toBe(false)
  })

  test('a new pinned sidebar is ordered to the top of the floating level, above the older one', () => {
    const h = forwardHarness()
    bringWindowForward(h.win, {
      hiddenTestMode: false,
      isPinned: () => true,
      pinnedPeerExists: () => true
    })
    expect(h.calls).toEqual(['show', 'moveTop', 'focus'])
  })

  test('an ordinary window rises above a pinned peer until it first loses focus', () => {
    const h = forwardHarness()
    bringWindowForward(h.win, {
      hiddenTestMode: false,
      isPinned: () => false,
      pinnedPeerExists: () => true
    })
    expect(h.calls).toEqual(['show', 'onTop:true:floating:1', 'moveTop', 'focus'])
    h.blur()
    expect(h.calls.at(-1)).toBe('onTop:false')
  })

  test('pinning it meanwhile keeps it pinned after it loses focus', () => {
    const h = forwardHarness()
    let pinned = false
    bringWindowForward(h.win, {
      hiddenTestMode: false,
      isPinned: () => pinned,
      pinnedPeerExists: () => true
    })
    pinned = true
    h.blur()
    expect(h.calls).not.toContain('onTop:false')
  })

  test('hidden test mode never shows, focuses or raises', () => {
    const h = forwardHarness(true)
    const focusApp = vi.fn()
    bringWindowForward(h.win, {
      hiddenTestMode: true,
      isPinned: () => false,
      pinnedPeerExists: () => true,
      focusApp
    })
    expect(h.calls).toEqual([])
    expect(focusApp).not.toHaveBeenCalled()
  })

  test('a link window is revealed through the forward path on both show routes', () => {
    vi.useFakeTimers()
    const harness = windowHarness()
    const reveal = vi.fn()
    configureWindowVisibility(harness.win, false, vi.fn(), reveal)
    harness.ready()
    vi.advanceTimersByTime(1500)
    expect(reveal).toHaveBeenCalledTimes(2)
    expect(harness.show).not.toHaveBeenCalled()
  })

  test('hidden test mode never reveals a link window either', () => {
    vi.useFakeTimers()
    const harness = windowHarness()
    const reveal = vi.fn()
    configureWindowVisibility(harness.win, true, vi.fn(), reveal)
    harness.ready()
    vi.advanceTimersByTime(1500)
    expect(reveal).not.toHaveBeenCalled()
  })
})
