import { describe, expect, test } from 'claude-code/testing'

import { bandCount } from './inbox'
import { buildProps, fallbackText } from './pane'
import { statusOf } from './presence'
import { readLocalFilings, readRegistry, readSessions } from './store'
import { sessionFilings } from './session'
import type { Registry } from './inbox'
import type { ScanEntry } from './scan'

const ROOT = '/r/records'
const NOW = Date.parse('2026-10-03T12:00:00Z')
const good = `${ROOT}/appx/2026-01-02-b.md`
const waiting: ScanEntry = {
  project: 'appx',
  rel: '2026-01-02-b.md',
  state: 'waiting',
  title: 'B',
  completedAt: '2026-10-01T07:00:00.000Z',
  counts: { pass: 1, partial: 0, fail: 0, skip: 0, unanswered: 0 },
  decisions: { answered: 0, total: 0 },
}

/** What any other session could write into the shared store. */
const junk: unknown = {
  bad: null,
  str: 'x',
  arr: [1],
  partial: { sessionId: 'me' },
  wrongKey: { path: '/elsewhere', sessionId: 'me', project: 'appx', filedAt: 1 },
  nan: { path: 'nan', sessionId: 'me', project: 'appx', filedAt: Number.NaN },
  [good]: { path: good, sessionId: 'me', project: 'appx', filedAt: 5, label: 7 },
}

describe('one validator for every store value', () => {
  test('registry: malformed entries dropped, a good one kept (bad label dropped)', () => {
    expect(readRegistry(junk)).toEqual({ [good]: { path: good, sessionId: 'me', project: 'appx', filedAt: 5 } })
  })
  test('non-objects read as empty, never throw', () => {
    for (const raw of [undefined, null, 3, 'x', [1, 2]]) {
      expect(readRegistry(raw)).toEqual({})
      expect(readSessions(raw)).toEqual({})
      expect(readLocalFilings(raw)).toEqual({})
    }
  })
  test('sessions and local filings keep only well-formed entries', () => {
    expect(readSessions({ a: { cwd: '/x', label: 'l', lastSeen: 1 }, b: { cwd: 1 }, c: null })).toEqual({ a: { cwd: '/x', label: 'l', lastSeen: 1 } })
    expect(readSessions({ a: { cwd: '/x', label: 'l', lastSeen: 1, expiresAt: 5 }, b: { cwd: '/y', label: 'm', lastSeen: 2, expiresAt: 'soon' } })).toEqual({
      a: { cwd: '/x', label: 'l', lastSeen: 1, expiresAt: 5 },
      b: { cwd: '/y', label: 'm', lastSeen: 2 },
    })
    expect(readLocalFilings({ a: { project: 'p', filedAt: 1 }, b: { project: 'p' } })).toEqual({ a: { project: 'p', filedAt: 1 } })
  })
  test('fields this version does not write are left out of what it reads', () => {
    const entry = { path: good, sessionId: 'me', project: 'appx', filedAt: 5, generation: 3, token: 7, protocol: 1 }
    expect(readRegistry({ [good]: entry })).toEqual({ [good]: { path: good, sessionId: 'me', project: 'appx', filedAt: 5 } })
    expect(readSessions({ a: { cwd: '/x', label: 'l', lastSeen: 1, protocol: 1 } })).toEqual({ a: { cwd: '/x', label: 'l', lastSeen: 1 } })
    expect(readLocalFilings({ a: { project: 'p', filedAt: 1, lastAt: 4, generation: 2, token: 7 } })).toEqual({ a: { project: 'p', filedAt: 1, lastAt: 4 } })
  })
  test('malformed store values: the pane still builds and the band still counts', async () => {
    const probe = { exists: async () => false, read: async () => null }
    // sessionFilings validates even when handed the raw value.
    const filings = await sessionFilings({ registry: junk as Registry, sessionId: 'me', entries: [waiting], root: ROOT, probe })
    expect(filings.map(f => f.entry.rel)).toEqual(['2026-01-02-b.md'])
    const ctx = { registry: readRegistry(junk), sessions: readSessions(junk), root: ROOT, now: NOW, tz: () => 0 }
    const props = buildProps([waiting], [], { kind: 'hub' }, NOW, () => 0, e => statusOf(e, ctx), filings)
    expect(props.rows).toHaveLength(1)
    expect(fallbackText(props)).toContain('2026-01-02-b')
    expect(bandCount([waiting], { kind: 'hub' })).toBe(1)
  })
})
