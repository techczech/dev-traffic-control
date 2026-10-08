import { describe, expect, test } from 'vitest'
import { EMPTY_TICKS, isTicked, nextUntickled, seedRecency, tickOff, tickOn } from '../ticks'
import type { ItemTicks } from '../../../../shared/ipc'

describe('tickOn / tickOff', () => {
  test('round-trips and never mutates the input', () => {
    const start: ItemTicks = { steps: [], expected: [] }
    const on = tickOn(start, 'steps', 2)
    expect(on.steps).toEqual([2])
    expect(start.steps).toEqual([])
    const off = tickOff(on, 'steps', 2)
    expect(off.steps).toEqual([])
    expect(on.steps).toEqual([2])
  })

  test('tickOn is idempotent; appends preserve tick order', () => {
    let t = tickOn(EMPTY_TICKS, 'expected', 3)
    t = tickOn(t, 'expected', 0)
    t = tickOn(t, 'expected', 3) // already ticked — unchanged
    expect(t.expected).toEqual([3, 0])
  })

  test('tickOff on an untickled bullet returns the same object', () => {
    expect(tickOff(EMPTY_TICKS, 'steps', 5)).toBe(EMPTY_TICKS)
  })

  test('isTicked reads either list', () => {
    const t: ItemTicks = { steps: [1], expected: [0] }
    expect(isTicked(t, 'steps', 1)).toBe(true)
    expect(isTicked(t, 'expected', 0)).toBe(true)
    expect(isTicked(t, 'steps', 0)).toBe(false)
  })
})

describe('nextUntickled — the Space walk (document order)', () => {
  test('starts at the first step', () => {
    expect(nextUntickled(EMPTY_TICKS, 3, 2)).toEqual({ kind: 'steps', index: 0 })
  })

  test('steps complete before expected begins, whatever order ticks landed', () => {
    const t: ItemTicks = { steps: [2, 0], expected: [] }
    expect(nextUntickled(t, 3, 2)).toEqual({ kind: 'steps', index: 1 })
    const allSteps: ItemTicks = { steps: [2, 0, 1], expected: [] }
    expect(nextUntickled(allSteps, 3, 2)).toEqual({ kind: 'expected', index: 0 })
  })

  test('skips ticked expected bullets too', () => {
    const t: ItemTicks = { steps: [0], expected: [0] }
    expect(nextUntickled(t, 1, 3)).toEqual({ kind: 'expected', index: 1 })
  })

  test('null when the walk is complete — and when there is nothing to walk', () => {
    const t: ItemTicks = { steps: [0, 1], expected: [0] }
    expect(nextUntickled(t, 2, 1)).toBeNull()
    expect(nextUntickled(EMPTY_TICKS, 0, 0)).toBeNull()
  })
})

describe('seedRecency — ⇧Space after a reload', () => {
  test('steps then expected, each in stored (tick) order', () => {
    const t: ItemTicks = { steps: [1, 0], expected: [2] }
    expect(seedRecency(t)).toEqual([
      { kind: 'steps', index: 1 },
      { kind: 'steps', index: 0 },
      { kind: 'expected', index: 2 }
    ])
  })

  test('matches true chronology for a pure Space walk', () => {
    // Space ticks steps 0..1 then expected 0 — the seed must replay exactly that.
    let t = EMPTY_TICKS
    for (let i = 0; i < 3; i++) {
      const next = nextUntickled(t, 2, 1)
      if (!next) break
      t = tickOn(t, next.kind, next.index)
    }
    expect(seedRecency(t)).toEqual([
      { kind: 'steps', index: 0 },
      { kind: 'steps', index: 1 },
      { kind: 'expected', index: 0 }
    ])
  })
})
