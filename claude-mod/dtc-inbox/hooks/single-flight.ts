/** Two ways of not doing the same work twice at once. No I/O of their own. */

/**
 * Shares one run among every caller that asks while it is in flight: the first call starts `run`,
 * and each call made before it settles gets that same promise (its own `run` is not called). The
 * next call after it settles starts a new one. A failing run rejects every caller that shared it.
 */
export function createShared<T>(): (run: () => Promise<T>) => Promise<T> {
  let flight: Promise<T> | null = null
  return run => {
    if (flight !== null) return flight
    const started = Promise.resolve().then(run)
    flight = started
    const clear = (): void => {
      if (flight === started) flight = null
    }
    started.then(clear, clear)
    return started
  }
}

/**
 * One run at a time, and at most one more queued. A call made while a run is in flight returns at
 * once and asks for a follow-up; however many such calls there were, one follow-up runs when the
 * current run ends (the latest caller's `run`). The call that started the run resolves once the
 * run and its follow-ups are done. A failing run rejects that call and drops the queued follow-up.
 */
export function createFollowUp(): (run: () => Promise<void>) => Promise<void> {
  let isRunning = false
  let queued: (() => Promise<void>) | null = null
  return async run => {
    if (isRunning) {
      queued = run
      return
    }
    isRunning = true
    try {
      let next: (() => Promise<void>) | null = run
      while (next !== null) {
        queued = null
        await next()
        next = queued
      }
    } finally {
      isRunning = false
      queued = null
    }
  }
}
