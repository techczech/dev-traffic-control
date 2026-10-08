import { describe, expect, test } from 'claude-code/testing'

import { sharedStateOver } from './shared-store'
import { Unreadable } from './store'

const NOW = Date.parse('2026-01-20T12:00:00Z')
const RECORD = '/r/records/example-app/2026-01-15-check.md'

const entry = { path: RECORD, sessionId: 's1', project: 'example-app', filedAt: 1 }
const session = { cwd: '/w', label: 'w', lastSeen: NOW, expiresAt: NOW + 90_000 }

/** A store holding `data`; a key in `broken` fails to read, as the host's store can. */
const over = (data: Record<string, unknown>, broken: readonly string[] = []) =>
  sharedStateOver({
    get: async key => {
      if (broken.includes(key)) throw new Error('the store failed')
      return data[key]
    },
  })

/** How a read ended: its value, or the name of what it rejected with. */
const outcome = async (read: () => Promise<unknown>): Promise<unknown> => read().catch((err: unknown) => (err instanceof Error ? err.name : 'rejected'))

describe('absent, readable and unreadable are three different answers', () => {
  test('a value nobody wrote is empty in both readings', async () => {
    const s = over({})
    for (const read of [s.held.registry, s.held.sessions, s.held.seen, s.shown.registry, s.shown.sessions, s.shown.seen]) expect(await read()).toEqual({})
  })

  test('a well-formed value reads the same in both readings', async () => {
    const s = over({ registry: { [RECORD]: entry }, sessions: { s1: session }, seen: { [RECORD]: 'stamp' } })
    expect(await s.held.registry()).toEqual({ [RECORD]: entry })
    expect(await s.shown.registry()).toEqual({ [RECORD]: entry })
    expect(await s.held.sessions()).toEqual({ s1: session })
    expect(await s.shown.seen()).toEqual({ [RECORD]: 'stamp' })
  })

  test('a store that fails: a write is refused, and only the display shows empty', async () => {
    const s = over({ registry: { [RECORD]: entry } }, ['registry', 'sessions', 'seen'])
    for (const read of [s.held.registry, s.held.sessions, s.held.seen]) expect(await outcome(read)).toBe('Error')
    for (const read of [s.shown.registry, s.shown.sessions, s.shown.seen]) expect(await read()).toEqual({})
  })

  test('before a write, a value that is not an object at all is refused; a malformed entry is dropped', async () => {
    expect(await outcome(over({ registry: 'text' }).held.registry)).toBe('Unreadable')
    expect(await outcome(over({ sessions: [session] }).held.sessions)).toBe('Unreadable')
    expect(await outcome(over({ seen: 7 }).held.seen)).toBe('Unreadable')
    expect(await over({ sessions: { s1: session, s2: {} } }).held.sessions()).toEqual({ s1: session })
    expect(await over({ registry: 'text' }).shown.registry()).toEqual({})
    expect(new Unreadable('The registry').message).toBe('The registry could not be read')
  })
})
