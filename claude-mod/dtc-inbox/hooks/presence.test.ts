import { describe, expect, test } from 'claude-code/testing'

import { buildProps, fallbackText, initialState, renderPane } from './pane'
import { OPEN_MS, PRUNE_MS, deriveLabel, isOpen, openMsOf, statusOf, touchSession } from './presence'
import type { Sessions, StatusContext } from './presence'
import { bandCount } from './inbox'
import type { ScanEntry } from './scan'

const ROOT = '/r/records'
const NOW = Date.parse('2026-10-03T12:00:00Z')
const utc = () => 0

const entry = (name: string, over: Partial<ScanEntry> = {}): ScanEntry => ({
  project: 'p',
  rel: `${name}.md`,
  state: 'opened',
  title: name,
  completedAt: null,
  counts: { pass: 0, partial: 0, fail: 0, skip: 0, unanswered: 0 },
  decisions: { answered: 0, total: 0 },
  sinceMs: NOW - 3_600_000,
  ...over,
})
const path = (e: ScanEntry) => `${ROOT}/${e.project}/${e.rel}`

const ctx = (e: ScanEntry, over: Partial<StatusContext> = {}, filing: { sessionId: string; label?: string } | null = null): StatusContext => ({
  registry: filing === null ? {} : { [path(e)]: { path: path(e), project: 'p', filedAt: NOW - 86_400_000, ...filing } },
  sessions: {},
  root: ROOT,
  now: NOW,
  tz: utc,
  ...over,
})

describe('label and presence', () => {
  test('label: folder plus first prompt cut to 60, or the folder alone', () => {
    expect(deriveLabel('example-app', null)).toBe('example-app')
    expect(deriveLabel('example-app', '  \n ')).toBe('example-app')
    expect(deriveLabel('example-app', 'fix the rail')).toBe('example-app · fix the rail')
    const long = deriveLabel('p', 'x'.repeat(100))
    expect(long.length).toBe('p · '.length + 60)
    expect(long.endsWith('…')).toBe(true)
  })
  test('touch refreshes one session and prunes entries older than 14 days', () => {
    const held = {
      old: { cwd: '/a', label: 'a', lastSeen: NOW - PRUNE_MS - 1 },
      edge: { cwd: '/b', label: 'b', lastSeen: NOW - PRUNE_MS },
      me: { cwd: '/c', label: 'c', lastSeen: NOW - 1000 },
    }
    const next = touchSession(held, 'me', { cwd: '/c2', label: 'c2' }, NOW, openMsOf(60_000))
    expect(Object.keys(next).sort()).toEqual(['edge', 'me'])
    expect(next.me).toEqual({ cwd: '/c2', label: 'c2', lastSeen: NOW, expiresAt: NOW + 120_000 })
  })
  test('the window a session writes: max(90 s, 2 × its band refresh)', () => {
    expect(openMsOf(30_000)).toBe(OPEN_MS)
    expect(openMsOf(60_000)).toBe(120_000)
    expect(openMsOf(120_000)).toBe(240_000)
  })
  test('open until the record\'s own expiresAt', () => {
    const rec = { cwd: '', label: '', lastSeen: NOW - 95_000, expiresAt: NOW - 95_000 + 240_000 }
    expect(isOpen(rec, NOW)).toBe(true)
    expect(isOpen(rec, rec.expiresAt - 1)).toBe(true)
    expect(isOpen(rec, rec.expiresAt)).toBe(false)
    expect(isOpen(undefined, NOW)).toBe(false)
  })
  test('a record without expiresAt (written before it existed) is open for 90 s after lastSeen', () => {
    expect(isOpen({ cwd: '', label: '', lastSeen: NOW - 89_000 }, NOW)).toBe(true)
    expect(isOpen({ cwd: '', label: '', lastSeen: NOW - 90_000 }, NOW)).toBe(false)
  })
  test('bandRefreshSeconds 120: pane status reads open at 95 s, closed at 241 s', () => {
    const e = entry('r', { state: 'none' })
    const seen = (ago: number) => ctx(e, { sessions: touchSession({}, 's', { cwd: '/x', label: 'L' }, NOW - ago, openMsOf(120_000)) }, { sessionId: 's' })
    expect(statusOf(e, seen(95_000))).toEqual({ text: 'asked by L · session open, waiting for your answer', waiting: true })
    expect(statusOf(e, seen(241_000)).text).toContain('session closed')
    expect(statusOf(e, seen(241_000)).waiting).toBe(false)
  })
})

describe('presence across sessions with different band-refresh settings', () => {
  // The filer refreshes every 120 s and writes its own expiry; an observer refreshing every 30 s
  // reads the same record. Neither computes a window: both read `expiresAt`, so they agree.
  const target = entry('2026-10-01-r', { state: 'waiting', completedAt: '2026-10-03T11:00:00.000Z' })
  const other = entry('2026-10-01-q', { state: 'waiting', completedAt: '2026-10-03T10:00:00.000Z' })
  const scanned = [target, other]
  const T = NOW - 100_000
  /** The filer's heartbeat at T with its own 120 s band refresh. */
  const sessions: Sessions = touchSession({}, 'filer', { cwd: '/x', label: 'L' }, T, openMsOf(120_000))
  const registry = { [path(target)]: { path: path(target), sessionId: 'filer', project: 'p', filedAt: T - 60_000 } }
  /** What a session sees at `now`. The observer's own settings (30 s) are not an input: there is none to pass. */
  const view = (now: number) => {
    const status = statusOf(target, { registry, sessions, root: ROOT, now, tz: utc })
    return { open: isOpen(sessions.filer, now), status, band: bandCount(scanned, { kind: 'hub' }) }
  }
  test('at +95 s filer (120 s) and observer (30 s) both see open, and the band counts every waiting answer', () => {
    const filer = view(T + 95_000)
    const observer = view(T + 95_000)
    expect(filer.open).toBe(true)
    expect(observer.open).toBe(true)
    expect(observer.status).toEqual({ text: 'asked by L · session open, answer not collected yet', waiting: true })
    expect(filer.band).toBe(2)
    expect(observer.band).toBe(2)
  })
  test('at +241 s both see closed; the band count is the same', () => {
    const v = view(T + 241_000)
    expect(v.open).toBe(false)
    expect(v.status.text).toContain('session closed')
    expect(v.status.waiting).toBe(false)
    expect(v.band).toBe(2)
  })
})

describe('status resolution', () => {
  const e = entry('2026-10-03-a')
  const open = { s1: { cwd: '/x', label: 'x', lastSeen: NOW - 60_000 } }
  test('filer open, unfinished row', () => {
    expect(statusOf(e, ctx(e, { sessions: open }, { sessionId: 's1', label: 'x · fix' }))).toEqual({ text: 'asked by x · fix · session open, waiting for your answer', waiting: true })
  })
  test('filer open, waiting row: not collected yet', () => {
    const w = entry('2026-10-03-b', { state: 'waiting', completedAt: '2026-10-03T09:00:00Z' })
    expect(statusOf(w, ctx(w, { sessions: open }, { sessionId: 's1', label: 'L' })).text).toBe('asked by L · session open, answer not collected yet')
  })
  test('filer closed', () => {
    const sessions = { s1: { cwd: '/x', label: 'x', lastSeen: NOW - 86_400_000 } }
    expect(statusOf(e, ctx(e, { sessions }, { sessionId: 's1', label: 'L' }))).toEqual({ text: 'asked by L · session closed yesterday 12:00 — nobody waiting', waiting: false })
    expect(statusOf(e, ctx(e, {}, { sessionId: 'gone', label: 'L' })).text).toContain('session closed yesterday 12:00')
  })
  test('live watch with no registry entry; a stale heartbeat does not count', () => {
    const live = entry('2026-10-03-c', { watch: { agent: 'agent-1', machine: 'laptop', heartbeatMs: NOW - 89_000 } })
    expect(statusOf(live, ctx(live))).toEqual({ text: 'an agent is watching (agent-1, laptop)', waiting: true })
    const stale = entry('2026-10-03-d', { watch: { agent: 'agent-1', machine: 'laptop', heartbeatMs: NOW - 91_000 } })
    expect(statusOf(stale, ctx(stale))).toEqual({ text: 'origin not recorded (filed before the inbox)', waiting: false })
  })
  test('neither', () => {
    expect(statusOf(e, ctx(e))).toEqual({ text: 'origin not recorded (filed before the inbox)', waiting: false })
  })
})

describe('marker, detail line and heading', () => {
  const a = entry('2026-10-03-a')
  const b = entry('2026-10-03-b', { sinceMs: NOW - 7_200_000 })
  const c = ctx(a, { sessions: { s1: { cwd: '/x', label: 'x', lastSeen: NOW - 1000 } } }, { sessionId: 's1', label: 'x' })
  const props = buildProps([], [a, b], { kind: 'hub' }, NOW, utc, e => statusOf(e, c))
  test('marker only on the waiting row; heading counts agents waiting', () => {
    const lines = renderPane(props, initialState(), 110, 30).map(l => l.text)
    expect(lines.find(l => l.includes('2026-10-03-a'))).toContain('●')
    expect(lines.find(l => l.includes('2026-10-03-b'))).not.toContain('●')
    expect(lines.join('\n')).toContain('Opened by you, not finished · 2 recent · 1 agent waiting')
  })
  test('the status sentence shows under the selected row only', () => {
    const first = renderPane(props, initialState(), 110, 30).map(l => l.text)
    expect(first.filter(l => l.includes('asked by') || l.includes('origin not recorded'))).toHaveLength(1)
    expect(first.some(l => l.includes('asked by x · session open, waiting for your answer'))).toBe(true)
    const second = renderPane(props, { selected: 1, showOlder: false }, 110, 30).map(l => l.text)
    expect(second.some(l => l.includes('origin not recorded'))).toBe(true)
  })
  test('text fallback prints the sentence beside the link', () => {
    const text = fallbackText(props)
    expect(text).toContain('● asked by x · session open, waiting for your answer')
    expect(text).toContain('origin not recorded (filed before the inbox)')
  })
})
