/**
 * A promise-chain mutex for one load of the mod: each `withLock(fn)` runs after every earlier one
 * settled, so two hooks' read–modify–write of the same value never interleave. Not reentrant:
 * never call `withLock` from inside a locked `fn`. A failing `fn` rejects its own caller only; the
 * chain goes on.
 *
 * It orders this session's own writes. Nothing orders the writes of different sessions to the
 * values they share (who filed which record, which sessions are open): two sessions writing in the
 * same instant can lose one of the two entries. Those values are used for display only, in the
 * pane's status lines and its "From this session" section.
 */

export type WithLock = <T>(fn: () => Promise<T>) => Promise<T>

export function createLock(): WithLock {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    tail = run.catch(() => undefined)
    return run
  }
}
