import { describe, expect, test } from 'claude-code/testing'

import { createFollowUp, createShared } from './single-flight'

/** A promise a test settles by hand. */
function gate<T = void>() {
  let open: (value: T) => void = () => undefined
  let fail: (err: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    open = resolve
    fail = reject
  })
  return { promise, open, fail }
}

const turns = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('one run shared by callers that overlap', () => {
  test('five calls while one is in flight start one run and all get its result; the next call starts another', async () => {
    const shared = createShared<number>()
    let runs = 0
    const first = gate<number>()
    const run = () => {
      runs++
      return first.promise
    }
    const calls = [shared(run), shared(run), shared(run), shared(run), shared(run)]
    await turns()
    expect(runs).toBe(1)
    first.open(7)
    expect(await Promise.all(calls)).toEqual([7, 7, 7, 7, 7])
    expect(await shared(async () => (runs++, 8))).toBe(8)
    expect(runs).toBe(2)
  })
  test('a joining caller\'s own run is never called', async () => {
    const shared = createShared<string>()
    const first = gate<string>()
    const a = shared(() => first.promise)
    let other = false
    const b = shared(async () => ((other = true), 'other'))
    first.open('first')
    expect(await a).toBe('first')
    expect(await b).toBe('first')
    expect(other).toBe(false)
  })
  test('a failing run rejects everyone who shared it, and the next call runs afresh', async () => {
    const shared = createShared<number>()
    const first = gate<number>()
    const a = shared(() => first.promise)
    const b = shared(async () => 0)
    first.fail(new Error('scan failed'))
    await expect(a).rejects.toThrow('scan failed')
    await expect(b).rejects.toThrow('scan failed')
    expect(await shared(async () => 3)).toBe(3)
    // A run that throws before its first await is a rejection too, not a throw at the caller.
    await expect(shared(() => { throw new Error('at once') })).rejects.toThrow('at once')
    expect(await shared(async () => 4)).toBe(4)
  })
})

describe('one refresh at a time, and one follow-up', () => {
  test('calls during a run return at once and add up to exactly one follow-up', async () => {
    const follow = createFollowUp()
    const gates = [gate(), gate(), gate()]
    const started: string[] = []
    const run = (name: string) => async () => {
      const mine = gates[started.length] as ReturnType<typeof gate>
      started.push(name)
      await mine.promise
    }
    const first = follow(run('first'))
    await turns()
    expect(started).toEqual(['first'])
    // Three refreshes asked for while the first runs: each returns straight away.
    let returned = 0
    for (const name of ['second', 'third', 'fourth']) void follow(run(name)).then(() => returned++)
    await turns()
    expect(returned).toBe(3)
    expect(started).toEqual(['first'])
    ;(gates[0] as ReturnType<typeof gate>).open(undefined)
    await turns()
    // One follow-up, and it is the latest caller's.
    expect(started).toEqual(['first', 'fourth'])
    ;(gates[1] as ReturnType<typeof gate>).open(undefined)
    await first
    await turns()
    expect(started).toEqual(['first', 'fourth'])
    // Idle again: the next call runs.
    const next = follow(run('fifth'))
    await turns()
    expect(started).toEqual(['first', 'fourth', 'fifth'])
    ;(gates[2] as ReturnType<typeof gate>).open(undefined)
    await next
  })
  test('a refresh asked for during the follow-up gets one more, and no more than that', async () => {
    const follow = createFollowUp()
    let runs = 0
    let ask = 2
    const run = async (): Promise<void> => {
      runs++
      // Each of the first two runs is asked again twice while it is in flight.
      if (ask-- > 0) {
        void follow(run)
        void follow(run)
      }
      await Promise.resolve()
    }
    await follow(run)
    expect(runs).toBe(3)
  })
  test('a failing run rejects its caller and leaves nothing running or queued', async () => {
    const follow = createFollowUp()
    let queuedRan = false
    const failing = follow(async () => {
      void follow(async () => void (queuedRan = true))
      throw new Error('refresh failed')
    })
    await expect(failing).rejects.toThrow('refresh failed')
    expect(queuedRan).toBe(false)
    let ran = false
    await follow(async () => void (ran = true))
    expect(ran).toBe(true)
  })
})
