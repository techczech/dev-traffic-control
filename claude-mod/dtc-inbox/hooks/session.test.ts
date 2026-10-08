import { describe, expect, test } from 'claude-code/testing'

import { SESSION_LABEL, collectOrder, sessionFilings, sessionStateOf } from './session'
import type { SessionProbe } from './session'
import type { Registry } from './inbox'
import type { ScanEntry } from './scan'

const ROOT = '/r/records'
const entry = (name: string, state: ScanEntry['state'], over: Partial<ScanEntry> = {}): ScanEntry => ({
  project: 'appx',
  rel: `${name}.md`,
  state,
  title: name,
  completedAt: state === 'waiting' ? '2026-10-01T07:00:00.000Z' : null,
  counts: { pass: 1, partial: 0, fail: 0, skip: 0, unanswered: 0 },
  decisions: { answered: 0, total: 0 },
  ...over,
})
const path = (name: string) => `${ROOT}/appx/${name}.md`

describe('session state', () => {
  test('all five states', () => {
    expect(sessionStateOf(entry('2026-01-01-a', 'none'))).toBe('not-opened')
    expect(sessionStateOf(entry('2026-01-01-a', 'opened'))).toBe('opened')
    expect(sessionStateOf(entry('2026-01-01-a', 'in-progress'))).toBe('opened')
    expect(sessionStateOf(entry('2026-01-01-a', 'waiting'))).toBe('answered-waiting')
    expect(sessionStateOf(entry('2026-01-01-a', 'collected'))).toBe('collected')
    expect(sessionStateOf(entry('2026-01-01-a', 'malformed'))).toBe('unreadable')
    expect(Object.values(SESSION_LABEL)).toEqual(['not opened yet', 'opened, not finished', 'answer waiting — ask the agent to collect it', 'collected', 'could not read'])
  })
  test('no state says an answer is on its way to the agent: the mod delivers nothing', () => {
    for (const label of Object.values(SESSION_LABEL)) expect(/deliver|collecting|sent to/i.test(label)).toBe(false)
  })
})

describe('sessionFilings', () => {
  const files: Record<string, string> = {
    [path('2026-01-01-unopened')]: '# Unopened one',
    [path('2026-01-02-collected')]: '# Done one',
    [`${ROOT}/appx/2026-01-02-collected.collected.json`]: '{}',
    [path('2026-01-04-malformed')]: '# x',
    [`${ROOT}/appx/2026-01-04-malformed.report.json`]: '{',
  }
  const probe: SessionProbe = { exists: async p => p in files, read: async p => files[p] ?? null }
  const registry: Registry = {
    [path('2026-01-01-unopened')]: { path: path('2026-01-01-unopened'), sessionId: 'me', project: 'appx', filedAt: 100 },
    [path('2026-01-02-collected')]: { path: path('2026-01-02-collected'), sessionId: 'me', project: 'appx', filedAt: 200 },
    [path('2026-01-03-waiting')]: { path: path('2026-01-03-waiting'), sessionId: 'me', project: 'appx', filedAt: 300 },
    [path('2026-01-04-malformed')]: { path: path('2026-01-04-malformed'), sessionId: 'me', project: 'appx', filedAt: 400 },
    [path('2026-01-05-gone')]: { path: path('2026-01-05-gone'), sessionId: 'me', project: 'appx', filedAt: 500 },
    [path('2026-01-06-theirs')]: { path: path('2026-01-06-theirs'), sessionId: 'other', project: 'appx', filedAt: 600 },
  }
  const scanned = [entry('2026-01-03-waiting', 'waiting'), entry('2026-01-06-theirs', 'waiting')]

  test('this session only, newest filed first, probed states, malformed and vanished left out', async () => {
    const out = await sessionFilings({ registry, sessionId: 'me', entries: scanned, root: ROOT, probe })
    expect(out.map(f => [f.entry.rel, f.state])).toEqual([
      ['2026-01-03-waiting.md', 'answered-waiting'],
      ['2026-01-02-collected.md', 'collected'],
      ['2026-01-01-unopened.md', 'not-opened'],
    ])
    expect(out[2]?.entry.requestTitle).toBe('Unopened one')
  })
  test('no filings: empty', async () => {
    expect(await sessionFilings({ registry, sessionId: 'nobody', entries: scanned, root: ROOT, probe })).toEqual([])
  })
  test('collect order: this session answered first, then the rest without duplicates', async () => {
    const out = await sessionFilings({ registry, sessionId: 'me', entries: scanned, root: ROOT, probe })
    const order = collectOrder(scanned, out, ROOT)
    expect(order.map(e => e.rel)).toEqual(['2026-01-03-waiting.md', '2026-01-06-theirs.md'])
  })
})
