import type { ItemTicks } from '../../../shared/ipc'

/**
 * Pure tick logic for the Runner (M8, ADR-0004 Amendment 5) — ticks in, ticks
 * out, never mutating the input, mirroring runnerState's discipline. The
 * stored arrays keep TICK order (append), not bullet order: recency is real
 * state (⇧Space unticks the most recently ticked) and the locked storage
 * shape has nowhere else to carry it.
 */

export type TickKind = 'steps' | 'expected'
export interface TickRef {
  kind: TickKind
  index: number
}

export const EMPTY_TICKS: ItemTicks = { steps: [], expected: [] }

export function isTicked(t: ItemTicks, kind: TickKind, index: number): boolean {
  return t[kind].includes(index)
}

/** Tick a bullet (idempotent) — appended, preserving tick order. */
export function tickOn(t: ItemTicks, kind: TickKind, index: number): ItemTicks {
  if (isTicked(t, kind, index)) return t
  return { ...t, [kind]: [...t[kind], index] }
}

export function tickOff(t: ItemTicks, kind: TickKind, index: number): ItemTicks {
  if (!isTicked(t, kind, index)) return t
  return { ...t, [kind]: t[kind].filter((i) => i !== index) }
}

/**
 * The bullet Space ticks next: first untickled bullet in DOCUMENT order —
 * steps top to bottom, then expected — or null when the walk is complete.
 */
export function nextUntickled(
  t: ItemTicks,
  stepsCount: number,
  expectedCount: number
): TickRef | null {
  for (let i = 0; i < stepsCount; i++) {
    if (!isTicked(t, 'steps', i)) return { kind: 'steps', index: i }
  }
  for (let i = 0; i < expectedCount; i++) {
    if (!isTicked(t, 'expected', i)) return { kind: 'expected', index: i }
  }
  return null
}

/**
 * Recency seed for ⇧Space after a reload: the stored arrays carry tick order
 * within each list but not across the two, so seed steps-then-expected — for
 * a pure Space walk (which ticks in exactly that order) this IS the true
 * chronology. The live session keeps its own exact stack on top of this.
 */
export function seedRecency(t: ItemTicks): TickRef[] {
  return [
    ...t.steps.map((index): TickRef => ({ kind: 'steps', index })),
    ...t.expected.map((index): TickRef => ({ kind: 'expected', index }))
  ]
}
