import { describe, expect, test } from 'claude-code/testing'

import { buildProps, capProps, entryTitle, fallbackText, fit, initialState, reduceKey, renderPane, titleFromBasename, visibleRows } from './pane'
import type { PaneProps } from './pane'
import type { ScanEntry } from './scan'
import type { SessionFiling } from './session'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const DAY = 86_400_000
const utc = () => 0

const entry = (project: string, name: string, over: Partial<ScanEntry> = {}): ScanEntry => ({
  project,
  rel: `${name}.md`,
  state: 'waiting',
  title: '',
  completedAt: '2026-10-02T07:52:00Z',
  counts: { pass: 3, partial: 0, fail: 0, skip: 0, unanswered: 0 },
  decisions: { answered: 0, total: 0 },
  ...over,
})
const unfinished = (name: string, daysAgo: number, over: Partial<ScanEntry> = {}) =>
  entry('notes-app', name, { state: 'opened', completedAt: null, counts: { pass: 0, partial: 0, fail: 0, skip: 0, unanswered: 0 }, sinceMs: NOW - daysAgo * DAY, ...over })

const waiting = [entry('dev-traffic-control', '2026-10-02-a', { title: 'The rail, fixed' }), entry('example-app', '2026-10-01-b', { title: 'Icon', completedAt: '2026-10-01T08:11:00Z' })]
const opened = [unfinished('2026-10-02-recent', 1, { title: 'Recent one' }), ...Array.from({ length: 3 }, (_, i) => unfinished(`2026-08-0${i + 1}-old`, 40 + i))]
const props = buildProps(waiting, opened, { kind: 'hub' }, NOW, utc)

describe('titles', () => {
  test('basename form: date, project prefix, hyphens, capital', () => {
    expect(titleFromBasename('notes-app', '2026-01-15-notes-app-0.4.0-preview.2-export-check.md')).toBe('0.4.0 preview.2 export check')
    expect(titleFromBasename('p', 'round-1/2026-10-02-fix-the-rail.md')).toBe('Fix the rail')
  })
  test('report title, then request title, then basename', () => {
    expect(entryTitle(entry('p', '2026-01-01-x', { title: 'Report' , requestTitle: 'Req' }))).toBe('Report')
    expect(entryTitle(entry('p', '2026-01-01-x', { requestTitle: 'Req' }))).toBe('Req')
    expect(entryTitle(entry('p', '2026-01-01-x'))).toBe('X')
  })
  test('fit truncates with an ellipsis', () => {
    expect(fit('abcdefgh', 5)).toBe('abcd…')
    expect(fit('abc', 5)).toBe('abc')
  })
})

describe('rows and sections', () => {
  test('human times, date-only for unfinished, older flagged', () => {
    expect(props.rows.map(r => [r.k, r.w, r.old === true])).toEqual([
      ['w', 'yesterday 07:52', false],
      ['w', 'Thu 08:11', false],
      ['o', 'yesterday', false],
      ['o', '24 Aug', true],
      ['o', '23 Aug', true],
      ['o', '22 Aug', true],
    ])
  })
  test('older rows are folded and counted in the heading, then shown on toggle', () => {
    const text = (s = initialState()) => renderPane(props, s, 110, 40).map(l => l.text).join('\n')
    expect(text()).toContain('Opened by you, not finished · 1 recent  (3 older than two weeks — a to show)')
    expect(text()).not.toContain('24 Aug')
    expect(text()).toContain('a show older')
    const on = reduceKey(initialState(), 'a', props).state
    expect(text(on)).toContain('(3 older than two weeks shown — a to hide)')
    expect(text(on)).toContain('24 Aug')
    expect(text(on)).toContain('a hide older')
  })
  test('no older rows: no parenthesis and no toggle hint', () => {
    const p = buildProps(waiting, [opened[0] as ScanEntry], { kind: 'hub' }, NOW, utc)
    const text = renderPane(p, initialState(), 110, 40).map(l => l.text).join('\n')
    expect(text).toContain('1 recent')
    expect(text).not.toContain('older')
    expect(reduceKey(initialState(), 'a', p).state.showOlder).toBe(false)
  })
  test('header names the scope; empty state keeps the unfinished section', () => {
    const p = buildProps([], [opened[0] as ScanEntry], { kind: 'project', project: 'notes-app' }, NOW, utc)
    const lines = renderPane(p, initialState(), 110, 40).map(l => l.text)
    expect(lines[0]).toBe('DTC — answers waiting (notes-app)')
    expect(lines.join('\n')).toContain('No DTC answers waiting.')
    expect(lines.join('\n')).toContain('Opened by you, not finished')
  })
  test('selected row is inverted and carries the pointer', () => {
    const lines = renderPane(props, initialState(), 110, 40)
    const sel = lines.filter(l => l.tone === 'selected')
    expect(sel).toHaveLength(1)
    expect(sel[0]?.text).toContain('❯ dev-traffic-control')
  })
  test('a short pane windows the body around the selection', () => {
    const many = buildProps(Array.from({ length: 40 }, (_, i) => entry('p', `2026-01-${String(i + 1).padStart(2, '0')}-x`)), [], { kind: 'hub' }, NOW, utc)
    const lines = renderPane(many, { selected: 35, showOlder: false }, 100, 14)
    expect(lines.length).toBeLessThanOrEqual(14)
    expect(lines.some(l => l.tone === 'selected')).toBe(true)
  })
})

describe('reduceKey', () => {
  test('moves across both sections and clamps', () => {
    let s = initialState()
    s = reduceKey(s, 'down', props).state
    s = reduceKey(s, 'j', props).state
    expect(visibleRows(props, s)[s.selected]?.k).toBe('o')
    s = reduceKey(s, 'down', props).state
    expect(s.selected).toBe(2)
    s = reduceKey(reduceKey(s, 'k', props).state, 'up', props).state
    expect(s.selected).toBe(0)
    expect(reduceKey(s, 'up', props).state.selected).toBe(0)
  })
  test('enter and c post an action for the selected row', () => {
    const s = { selected: 1, showOlder: false }
    expect(reduceKey(s, 'return', props).action).toEqual({ kind: 'open', id: 'example-app/2026-10-01-b.md' })
    expect(reduceKey(s, 'c', props).action).toEqual({ kind: 'collect', id: 'example-app/2026-10-01-b.md' })
    expect(reduceKey(s, 'x', props).action).toBeUndefined()
  })
  test('a toggles older and keeps the selection in range', () => {
    const on = reduceKey({ selected: 2, showOlder: false }, 'a', props).state
    expect(visibleRows(props, on)).toHaveLength(6)
    const last = reduceKey({ selected: 4, showOlder: true }, 'a', props).state
    expect(last).toEqual({ selected: 2, showOlder: false })
  })
  test('q posts a close action', () => {
    expect(reduceKey(initialState(), 'q', props).action).toEqual({ kind: 'close' })
    expect(reduceKey(initialState(), 'q', { scope: 'x', rows: [] }).action).toEqual({ kind: 'close' })
    expect(renderPane(props, initialState(), 110, 40).map(l => l.text).join('\n')).toContain('enter open in DTC · c collect prompt · a show older · q close')
  })
  test('nothing listed: no action', () => {
    expect(reduceKey(initialState(), 'return', { scope: 'x', rows: [] }).action).toBeUndefined()
  })
})

describe('props size and text fallback', () => {
  test('500 rows serialise under 100,000 characters', () => {
    const w = Array.from({ length: 200 }, (_, i) => entry('example-app', `2026-01-01-${'long-name-'.repeat(8)}${i}`, { title: 'T'.repeat(120) }))
    const o = Array.from({ length: 300 }, (_, i) => unfinished(`2026-01-02-${'long-name-'.repeat(8)}${i}`, 1 + (i % 30), { title: 'U'.repeat(120) }))
    const p = buildProps(w, o, { kind: 'hub' }, NOW, utc)
    expect(JSON.stringify(p).length).toBeLessThan(100_000)
    expect(p.rows.length).toBeGreaterThan(200)
    expect(p.rows.slice(0, 200).every(r => r.k === 'w')).toBe(true)
  })
  test('capProps drops from the end', () => {
    const p: PaneProps = { scope: 's', rows: Array.from({ length: 10 }, (_, i) => ({ id: `p/${i}.md`, k: 'o' as const, t: 'x'.repeat(50), w: '', v: '' })) }
    const c = capProps(p, 300)
    expect(c.rows.length).toBeLessThan(10)
    expect(c.rows[0]?.id).toBe('p/0.md')
  })
  test('text fallback: aligned rows, human times, link on its own line, collect hint', () => {
    const text = fallbackText(props)
    expect(text).toContain('DTC — answers waiting (all projects)')
    expect(text).toContain(' 1. dev-traffic-control  The rail, fixed  yesterday 07:52  3 pass')
    expect(text).toContain('\n    dtc://open/dev-traffic-control/2026-10-02-a.md')
    expect(text).toContain('/dtc collect [n]')
    expect(text).toContain('Opened by you, not finished · 1 recent  (3 older than two weeks not listed)')
    expect(text).not.toContain('Z')
  })
  test('a scan that put reads off: the pane and the text list say more is not read yet, and how much', () => {
    const p = buildProps(waiting, opened, { kind: 'hub' }, NOW, utc, undefined, [], [], 800)
    expect(p.more).toBe(800)
    const lines = renderPane(p, initialState(), 110, 30).map(l => l.text)
    expect(lines).toContain(' More not read yet: 800 files are read over the next refreshes, and this list fills in.')
    expect(lines.indexOf(' More not read yet: 800 files are read over the next refreshes, and this list fills in.')).toBeLessThan(lines.findIndex(l => l.startsWith(' From this session')))
    expect(fallbackText(p)).toContain('\nMore not read yet: 800 files are read over the next refreshes, and this list fills in.\n')
    expect(fallbackText(buildProps(waiting, opened, { kind: 'hub' }, NOW, utc, undefined, [], [], 1))).toContain('More not read yet: 1 file is read over')
    // Nothing put off: no such line, and no such prop.
    expect('more' in props).toBe(false)
    expect(fallbackText(props)).not.toContain('not read yet')
    expect(renderPane(props, initialState(), 110, 30).some(l => l.text.includes('not read yet'))).toBe(false)
    // The cap on the props keeps it.
    expect(capProps({ ...p, rows: [] }, 300).more).toBe(800)
  })
  test('text fallback empty state', () => {
    expect(fallbackText({ scope: 'p', rows: [] })).toContain('No DTC answers waiting.')
  })
})

describe('From this session', () => {
  const filing = (name: string, state: SessionFiling['state'], filedAt: number, project = 'example-app'): SessionFiling => ({
    entry: entry(project, name, { title: name, state: state === 'not-opened' ? 'none' : state === 'opened' ? 'opened' : state === 'collected' ? 'collected' : 'waiting' }),
    state,
    filedAt,
  })
  const mine = [filing('2026-10-03-a', 'not-opened', NOW - 3_600_000), filing('2026-10-03-b', 'answered-waiting', NOW - 7_200_000, 'other-app')]
  const dup = [entry('other-app', '2026-10-03-b', { title: 'dup' }), ...waiting]
  const withMine = buildProps(dup, [unfinished('2026-10-03-a', 0, { project: 'example-app', title: 'dup-open' }), ...opened], { kind: 'hub' }, NOW, utc, undefined, mine)
  const text = (p: PaneProps, s = initialState()) => renderPane(p, s, 120, 60).map(l => l.text)

  test('rows: this session first, state label, marker only when the reviewer is the one being waited on, no duplicates', () => {
    expect(withMine.rows.slice(0, 2).map(r => [r.k, r.t, r.v, r.w, r.a === true])).toEqual([
      ['s', '2026-10-03-a', 'not opened yet', 'today 11:00', true],
      ['s', '2026-10-03-b', 'answer waiting — ask the agent to collect it', 'today 10:00', false],
    ])
    const ids = withMine.rows.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(withMine.rows.filter(r => r.k !== 's').map(r => r.t)).not.toContain('dup')
    expect(withMine.rows.filter(r => r.k !== 's').map(r => r.t)).not.toContain('dup-open')
  })
  test('layout: section first, other headings gain (other sessions)', () => {
    const lines = text(withMine)
    expect(lines[2]).toBe(' From this session · 2')
    expect(lines[3]).toContain('●')
    expect(lines[3]).toMatch(/example-app +2026-10-03-a +not opened yet +today 11:00/)
    expect(lines[4]).toMatch(/other-app +2026-10-03-b +answer waiting — ask the agent to collect it +today 10:00/)
    expect(lines).toContain(' Waiting to be collected (other sessions) · 2')
    expect(lines.some(l => l.startsWith(' Opened by you, not finished (other sessions) · '))).toBe(true)
  })
  test('empty section keeps its heading with one dim line; other headings are unchanged', () => {
    const lines = renderPane(props, initialState(), 120, 60)
    expect(lines[2]).toEqual({ text: ' From this session · 0', tone: 'heading' })
    expect(lines[3]).toEqual({ text: '   Nothing filed from this session yet.', tone: 'dim' })
    const all = lines.map(l => l.text).join('\n')
    expect(all).toContain(' Waiting to be collected · 2')
    expect(all).not.toContain('other sessions')
  })
  test('keys move across all three sections and act on a session row', () => {
    const rows = visibleRows(withMine, initialState())
    expect(rows.map(r => r.k).slice(0, 3)).toEqual(['s', 's', 'w'])
    expect(reduceKey(initialState(), 'return', withMine).action).toEqual({ kind: 'open', id: 'example-app/2026-10-03-a.md' })
    const s = reduceKey(initialState(), 'down', withMine).state
    expect(reduceKey(s, 'c', withMine).action).toEqual({ kind: 'collect', id: 'other-app/2026-10-03-b.md' })
    expect(reduceKey({ selected: 2, showOlder: false }, 'down', withMine).state.selected).toBe(3)
  })
  test('a collected row is listed and keyed like the rest', () => {
    const p = buildProps([], [], { kind: 'hub' }, NOW, utc, undefined, [filing('2026-10-03-z', 'collected', NOW)])
    expect(p.rows[0]).toMatchObject({ k: 's', v: 'collected' })
    expect(p.rows[0]?.a).toBeUndefined()
    expect(reduceKey(initialState(), 'c', p).action).toEqual({ kind: 'collect', id: 'example-app/2026-10-03-z.md' })
  })
  test('text fallback: the same three sections, answered rows numbered for /dtc collect', () => {
    const t = fallbackText(withMine)
    const order = ['From this session · 2', 'Waiting to be collected (other sessions) · 2', 'Opened by you, not finished (other sessions)'].map(h => t.indexOf(h))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(t).toContain('  - ● example-app')
    expect(t).toContain(' 1. other-app')
    expect(t).toContain(' 2. dev-traffic-control')
    expect(fallbackText(props)).toContain('From this session · 0\nNothing filed from this session yet.')
  })
})
