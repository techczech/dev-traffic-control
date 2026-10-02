import { describe, expect, test, vi } from 'vitest'
import {
  type EnlargeableWindow,
  type EnlargementWatch,
  shouldUnpinOnResize,
  watchEnlargementUnpins
} from '../enlargeUnpins'
import { NARROW_WIDTH } from '../windowLayout'

// Ticket 26: a pinned window is only ever sidebar-sized.
describe('shouldUnpinOnResize', () => {
  test('growing past the sidebar width unpins', () => {
    expect(shouldUnpinOnResize(460, 461, NARROW_WIDTH)).toBe(true)
    expect(shouldUnpinOnResize(460, 1280, NARROW_WIDTH)).toBe(true)
  })

  test('growing up to the sidebar width does not', () => {
    expect(shouldUnpinOnResize(420, 460, NARROW_WIDTH)).toBe(false)
  })

  test('narrowing, or a height-only resize, never counts as enlarging', () => {
    expect(shouldUnpinOnResize(1280, 900, NARROW_WIDTH)).toBe(false)
    expect(shouldUnpinOnResize(900, 900, NARROW_WIDTH)).toBe(false)
  })
})

interface FakeWindow {
  win: EnlargeableWindow
  emit(event: string): void
  resizeTo(next: number): void
  destroy(): void
}

interface Watched extends FakeWindow {
  watch: EnlargementWatch
  /** Fire the programmatic-resize settle timer. */
  settle(): void
  unpin: ReturnType<typeof vi.fn>
  pin(): void
  isPinned(): boolean
}

function fakeWindow(width: number): FakeWindow {
  const listeners = new Map<string, Array<() => void>>()
  let current = width
  let destroyed = false
  const win = {
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }),
    getBounds: () => ({ width: current }),
    isDestroyed: () => destroyed
  }
  return {
    win,
    emit(event: string): void {
      for (const listener of listeners.get(event) ?? []) listener()
    },
    resizeTo(next: number): void {
      current = next
      for (const listener of listeners.get('resize') ?? []) listener()
    },
    destroy(): void {
      destroyed = true
    }
  }
}

function watched(width: number, startPinned = true): Watched {
  const harness = fakeWindow(width)
  let pinned = startPinned
  const unpin = vi.fn(() => {
    pinned = false
  })
  const timers: Array<{ callback: () => void; cleared: boolean }> = []
  const watch = watchEnlargementUnpins(
    harness.win,
    {
      sidebarWidth: NARROW_WIDTH,
      isPinned: () => pinned,
      unpin
    },
    {
      setTimeout: (callback) => {
        const timer = { callback, cleared: false }
        timers.push(timer)
        return timer
      },
      clearTimeout: (handle) => {
        ;(handle as { cleared: boolean }).cleared = true
      }
    }
  )
  return {
    ...harness,
    watch,
    settle: () => {
      for (const timer of timers.splice(0)) if (!timer.cleared) timer.callback()
    },
    unpin,
    pin: () => {
      pinned = true
    },
    isPinned: () => pinned
  }
}

describe('watchEnlargementUnpins', () => {
  test('maximise (double-click on the title bar, the zoom) unpins a pinned window', () => {
    const w = watched(460)
    w.emit('maximize')
    expect(w.unpin).toHaveBeenCalledTimes(1)
    expect(w.isPinned()).toBe(false)
  })

  test('entering full screen unpins', () => {
    const w = watched(460)
    w.emit('enter-full-screen')
    expect(w.unpin).toHaveBeenCalledTimes(1)
  })

  test('dragging an edge wider than the sidebar unpins once', () => {
    const w = watched(460)
    w.resizeTo(470)
    w.resizeTo(700)
    expect(w.unpin).toHaveBeenCalledTimes(1)
  })

  test('a drag that narrows first and then widens past the sidebar still unpins', () => {
    const w = watched(460)
    w.resizeTo(430)
    expect(w.unpin).not.toHaveBeenCalled()
    w.resizeTo(520)
    expect(w.unpin).toHaveBeenCalledTimes(1)
  })

  test('narrowing back never pins again', () => {
    const w = watched(460)
    w.resizeTo(900)
    w.resizeTo(460)
    expect(w.isPinned()).toBe(false)
    expect(w.unpin).toHaveBeenCalledTimes(1)
  })

  // Only the deliberate Narrow command re-pins (pinnedForPreset); a window made
  // narrow by dragging an edge stays as it is.
  test('dragging an unpinned window narrower leaves it unpinned', () => {
    const w = watched(1280, false)
    w.resizeTo(900)
    w.resizeTo(460)
    w.resizeTo(420)
    expect(w.isPinned()).toBe(false)
    expect(w.unpin).not.toHaveBeenCalled()
  })

  test('an unpinned window is left alone', () => {
    const w = watched(460, false)
    w.emit('maximize')
    w.emit('enter-full-screen')
    w.resizeTo(1280)
    expect(w.unpin).not.toHaveBeenCalled()
  })

  test('a window he pinned while already wide stays pinned until it grows', () => {
    const w = watched(1000)
    w.resizeTo(1000)
    w.resizeTo(800)
    expect(w.unpin).not.toHaveBeenCalled()
    w.resizeTo(900)
    expect(w.unpin).toHaveBeenCalledTimes(1)
  })

  test('re-pinning after an unpin is honoured, and the next enlargement unpins again', () => {
    const w = watched(460)
    w.resizeTo(900)
    w.resizeTo(460)
    w.pin()
    w.resizeTo(470)
    expect(w.unpin).toHaveBeenCalledTimes(2)
  })

  test('a destroyed window does nothing', () => {
    const w = watched(460)
    w.destroy()
    w.emit('maximize')
    w.resizeTo(900)
    expect(w.unpin).not.toHaveBeenCalled()
  })

  // Ticket 27: docking sets the bounds itself; that is never his enlargement.
  test('a move main announces is not an enlargement, and his next one still is', () => {
    const w = watched(420)
    w.watch.expectProgrammaticResize(460)
    w.resizeTo(440)
    w.resizeTo(460)
    expect(w.unpin).not.toHaveBeenCalled()
    w.resizeTo(700)
    expect(w.unpin).toHaveBeenCalledTimes(1)
  })

  test('even a transient wider size during a cross-screen dock does not unpin', () => {
    const w = watched(460)
    w.watch.expectProgrammaticResize(460)
    w.resizeTo(920)
    w.resizeTo(460)
    expect(w.unpin).not.toHaveBeenCalled()
    expect(w.isPinned()).toBe(true)
  })

  test('an announced resize that never arrives stops being excused once it settles', () => {
    const w = watched(460)
    w.watch.expectProgrammaticResize(460)
    w.settle()
    w.resizeTo(900)
    expect(w.unpin).toHaveBeenCalledTimes(1)
  })

  // Settings "Free" undocks back to the wider bounds from before the dock.
  test('undocking to the wider pre-dock bounds, announced by main, keeps the pin', () => {
    const w = watched(460)
    w.watch.expectProgrammaticResize(1280)
    w.resizeTo(1280)
    expect(w.unpin).not.toHaveBeenCalled()
    expect(w.isPinned()).toBe(true)
    // Once it has landed, the reviewer's own drag wider still unpins.
    w.resizeTo(1400)
    expect(w.unpin).toHaveBeenCalledTimes(1)
  })
})
