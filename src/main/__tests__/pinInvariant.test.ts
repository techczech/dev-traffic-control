import { describe, expect, test, vi, type Mock } from 'vitest'
import {
  guardPinInvariant,
  LinkLift,
  mayBePinned,
  PIN_GUARD_EVENTS,
  settlePin,
  TemporaryPin,
  type PinGuardWindow
} from '../pinInvariant'
import { NARROW_WIDTH, WIDE_WIDTH } from '../windowLayout'

// The invariant, total: a window wider than the sidebar is never
// always-on-top and its pin control shows unpinned.
describe('the pin rule', () => {
  test('only a sidebar-sized window may be pinned', () => {
    expect(mayBePinned(NARROW_WIDTH, NARROW_WIDTH)).toBe(true)
    expect(mayBePinned(420, NARROW_WIDTH)).toBe(true)
    expect(mayBePinned(NARROW_WIDTH + 1, NARROW_WIDTH)).toBe(false)
    expect(mayBePinned(WIDE_WIDTH, NARROW_WIDTH)).toBe(false)
  })

  test('a wide window loses its pin and its level', () => {
    expect(
      settlePin(WIDE_WIDTH, { layoutPinned: true, alwaysOnTop: true }, false, NARROW_WIDTH)
    ).toEqual({ layoutPinned: false, alwaysOnTop: false })
  })

  test('a wide window that is on top without a pin (a stuck lift) loses the level', () => {
    expect(
      settlePin(WIDE_WIDTH, { layoutPinned: false, alwaysOnTop: true }, false, NARROW_WIDTH)
    ).toEqual({ layoutPinned: false, alwaysOnTop: false })
  })

  test('the link lift may keep a wide window on top, but never pinned, until it ends', () => {
    expect(
      settlePin(WIDE_WIDTH, { layoutPinned: false, alwaysOnTop: true }, true, NARROW_WIDTH)
    ).toEqual({ layoutPinned: false, alwaysOnTop: true })
    expect(
      settlePin(WIDE_WIDTH, { layoutPinned: true, alwaysOnTop: true }, true, NARROW_WIDTH)
    ).toEqual({ layoutPinned: false, alwaysOnTop: true })
  })

  test('a temporary pin keeps a wide window pinned and on top', () => {
    expect(
      settlePin(WIDE_WIDTH, { layoutPinned: true, alwaysOnTop: true }, false, NARROW_WIDTH, true)
    ).toEqual({ layoutPinned: true, alwaysOnTop: true })
  })

  test('a sidebar-sized window is left exactly as it is', () => {
    for (const state of [
      { layoutPinned: true, alwaysOnTop: true },
      { layoutPinned: false, alwaysOnTop: false }
    ]) {
      expect(settlePin(NARROW_WIDTH, state, false, NARROW_WIDTH)).toEqual(state)
    }
  })
})

interface Harness {
  win: PinGuardWindow
  emit(event: string): void
  setWidth(width: number): void
  state: { pinned: boolean; onTop: boolean }
  saved: { pinned: boolean }
  unpin: Mock<() => void>
  pinOn: Mock<() => void>
  lift: LinkLift
  temporary: TemporaryPin
  /** The pin button's path (applyPinned). */
  press(): void
  destroy(): void
}

function harness(width: number, pinned: boolean, onTop = pinned): Harness {
  const listeners = new Map<string, Array<() => void>>()
  const state = { pinned, onTop }
  const saved = { pinned: pinned && width <= NARROW_WIDTH }
  let current = width
  let destroyed = false
  const win: PinGuardWindow = {
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    getBounds: () => ({ width: current }),
    isDestroyed: () => destroyed,
    isAlwaysOnTop: () => state.onTop,
    setAlwaysOnTop: (flag) => {
      state.onTop = flag
    }
  }
  // The real unpin is applyPinned(win, false): level, layout and control together.
  const temporary = new TemporaryPin()
  const unpin = vi.fn(() => {
    state.pinned = false
    state.onTop = false
    temporary.active = false
  })
  // The real pin is applyPinned(win, true) at a sidebar width: a saved pin.
  const pinOn = vi.fn(() => {
    state.pinned = true
    state.onTop = true
    temporary.active = false
    saved.pinned = true
  })
  const lift = new LinkLift()
  guardPinInvariant(win, {
    sidebarWidth: NARROW_WIDTH,
    lift,
    temporary,
    isPinned: () => state.pinned,
    unpin,
    pin: pinOn
  })
  return {
    win,
    temporary,
    // Pressing pin: wide means temporary (not saved), narrow means a saved pin.
    press: () => {
      temporary.active = current > NARROW_WIDTH
      state.pinned = true
      state.onTop = true
      saved.pinned = !temporary.active
    },
    saved,
    state,
    unpin,
    pinOn,
    lift,
    emit: (event) => {
      for (const listener of listeners.get(event) ?? []) listener()
    },
    setWidth: (next) => {
      current = next
    },
    destroy: () => {
      destroyed = true
    }
  }
}

describe('the guard on a window', () => {
  test('a window restored wide with a saved pin is unpinned once settled', () => {
    const h = harness(WIDE_WIDTH, true)
    guardPinInvariant(h.win, {
      sidebarWidth: NARROW_WIDTH,
      lift: h.lift,
      temporary: h.temporary,
      isPinned: () => h.state.pinned,
      unpin: h.unpin,
      pin: h.pinOn
    }).settle()
    expect(h.state).toEqual({ pinned: false, onTop: false })
  })

  test('un-docking back to wide bounds while pinned unpins, though main made the move', () => {
    const h = harness(NARROW_WIDTH, true)
    h.setWidth(WIDE_WIDTH)
    h.emit('resize')
    expect(h.state).toEqual({ pinned: false, onTop: false })
    expect(h.unpin).toHaveBeenCalledTimes(1)
  })

  test('a pin pressed on a wide window is allowed, shown and not saved', () => {
    const h = harness(WIDE_WIDTH, false)
    h.press()
    h.emit('resize')
    expect(h.state).toEqual({ pinned: true, onTop: true })
    expect(h.saved.pinned).toBe(false)
    expect(h.unpin).not.toHaveBeenCalled()
  })

  test('narrowing a temporarily pinned window to the sidebar makes it a saved pin', () => {
    const h = harness(WIDE_WIDTH, false)
    h.press()
    h.setWidth(WIDE_WIDTH - 100)
    h.emit('resize')
    expect(h.state.pinned).toBe(true)
    expect(h.pinOn).not.toHaveBeenCalled()
    h.setWidth(NARROW_WIDTH)
    h.emit('resize')
    expect(h.state).toEqual({ pinned: true, onTop: true })
    expect(h.saved.pinned).toBe(true)
    expect(h.temporary.active).toBe(false)
    // Expanded again, it unpins.
    h.setWidth(WIDE_WIDTH)
    h.emit('resize')
    expect(h.state).toEqual({ pinned: false, onTop: false })
  })

  // Narrowing from pinned wide must not lose the pin, and narrowing
  // from unpinned wide must pin.
  test('narrowing an unpinned wide window to the sidebar pins it, however it was narrowed', () => {
    const h = harness(WIDE_WIDTH, false)
    h.setWidth(NARROW_WIDTH)
    h.emit('resize')
    expect(h.state).toEqual({ pinned: true, onTop: true })
    expect(h.saved.pinned).toBe(true)
  })

  test('narrowing a window while in the wide range, then crossing, pins once', () => {
    const h = harness(WIDE_WIDTH, false)
    h.setWidth(NARROW_WIDTH + 200)
    h.emit('resize')
    expect(h.pinOn).not.toHaveBeenCalled()
    h.setWidth(NARROW_WIDTH)
    h.emit('resize')
    h.emit('resize')
    expect(h.pinOn).toHaveBeenCalledTimes(1)
    expect(h.state.pinned).toBe(true)
  })

  test('pin off on a sidebar window holds until the next size change, then the width decides', () => {
    const h = harness(NARROW_WIDTH, true)
    h.state.pinned = false
    h.state.onTop = false
    h.emit('resize')
    expect(h.state.pinned).toBe(false)
    h.setWidth(WIDE_WIDTH)
    h.emit('resize')
    h.setWidth(NARROW_WIDTH)
    h.emit('resize')
    expect(h.state.pinned).toBe(true)
  })

  test('a wide window pinned by the button stays pinned until the size crosses the sidebar width', () => {
    const h = harness(WIDE_WIDTH, false)
    h.press()
    h.setWidth(WIDE_WIDTH - 50)
    h.emit('resize')
    expect(h.state.pinned).toBe(true)
  })

  test('a pin made on a sidebar-sized window is saved, and expanding clears it', () => {
    const h = harness(NARROW_WIDTH, false)
    h.press()
    expect(h.saved.pinned).toBe(true)
    h.emit('resize')
    expect(h.state.pinned).toBe(true)
    h.setWidth(WIDE_WIDTH)
    h.emit('resize')
    expect(h.state).toEqual({ pinned: false, onTop: false })
  })

  test('a temporary pin is not restored: a restarted wide window settles unpinned', () => {
    const h = harness(WIDE_WIDTH, false)
    h.press()
    // Restart: the saved layout said unpinned, so the new window has no pin.
    const restarted = harness(WIDE_WIDTH, h.saved.pinned)
    restarted.emit('resize')
    expect(restarted.state).toEqual({ pinned: false, onTop: false })
  })

  test('un-docking to wide bounds leaves the window unpinned', () => {
    const h = harness(NARROW_WIDTH, true)
    h.setWidth(WIDE_WIDTH)
    h.emit('resize')
    expect(h.state).toEqual({ pinned: false, onTop: false })
    h.emit('resize')
    expect(h.state).toEqual({ pinned: false, onTop: false })
  })

  test.each([...PIN_GUARD_EVENTS])('%s settles a wide window', (event) => {
    const h = harness(WIDE_WIDTH, true)
    h.emit(event)
    expect(h.state).toEqual({ pinned: false, onTop: false })
  })

  test('a lifted wide window stays on top through a resize, then drops when the lift ends', () => {
    const h = harness(WIDE_WIDTH, false, true)
    h.lift.active = true
    h.emit('resize')
    expect(h.state.onTop).toBe(true)
    h.lift.active = false
    h.emit('resize')
    expect(h.state.onTop).toBe(false)
  })

  test('enlarging a lifted window (which is not pinned) no longer leaves it on top', () => {
    const h = harness(NARROW_WIDTH, false, true)
    h.setWidth(WIDE_WIDTH)
    h.emit('resize')
    expect(h.state.onTop).toBe(false)
  })

  test('narrow pinned windows are untouched, and a destroyed window is ignored', () => {
    const h = harness(NARROW_WIDTH, true)
    h.emit('resize')
    expect(h.state).toEqual({ pinned: true, onTop: true })
    const gone = harness(WIDE_WIDTH, true)
    gone.destroy()
    gone.emit('resize')
    expect(gone.unpin).not.toHaveBeenCalled()
  })
})
