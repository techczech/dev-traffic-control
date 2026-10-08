import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'
import type { Handoff } from '../../../../main/qa/handoffs'
import type { Thread } from '../../../../main/qa/types'

/**
 * Each waiting row says what to do: every row leads with its kind,
 * counts what is left, and carries the button that does it. The card arranges
 * itself by kind or newest first, and the quiet card under it holds what is the
 * agents' move.
 */

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  navigate: vi.fn(),
  markSeen: vi.fn(),
  settings: undefined,
  changeSetting: vi.fn()
}))
vi.mock('../../state/app', () => ({ useApp: () => app }))

import { ProjectHome } from '../ProjectHome'
import { CommandProvider } from '../../commands/provider'

const NOW = new Date()
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString()

beforeEach(() => {
  app.navigate.mockReset()
  app.markSeen.mockReset()
  localStorage.clear()
  app.snapshot = snapshot()
})
afterEach(cleanup)

function renderHome(): void {
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <ProjectHome slug="tangram" />
    </CommandProvider>
  )
}

const card = (): HTMLElement => screen.getByRole('region', { name: 'Waiting on you' })

test('each row leads with its kind tag, then the title, then the count', () => {
  renderHome()
  const rows = [...card().querySelectorAll('[data-waiting-row]')].map((row) => ({
    tag: row.querySelector('.w-tag')?.textContent,
    title: row.querySelector('.w-title')?.textContent,
    count: row.querySelector('.w-count')?.textContent,
    action: row.querySelector('.w-act')?.textContent
  }))
  expect(rows).toEqual([
    {
      tag: 'Answer',
      title: 'Colleague demo',
      count: 'Does she run it?',
      action: 'Open'
    },
    { tag: 'Test', title: 'Layout checks', count: '2 checks · 1 done', action: 'Open' },
    { tag: 'Decide', title: 'What goes in', count: '1 decision · 0 decided', action: 'Open' },
    {
      tag: 'Pick up',
      title: 'Hand over 0.35',
      count: expect.stringMatching(/^Never picked up · written /),
      action: 'Open'
    }
  ])
  expect(card().querySelector('.w-group')).not.toBeNull()
})

test('the toggle switches to one list, newest first, and the choice is remembered', () => {
  renderHome()
  fireEvent.click(within(card()).getByRole('button', { name: 'Sort' }))
  expect([...card().querySelectorAll('.w-title')].map((node) => node.textContent)).toEqual([
    'Hand over 0.35',
    'What goes in',
    'Colleague demo',
    'Layout checks'
  ])
  expect(card().querySelector('.w-group')).toBeNull()
  expect(localStorage.getItem('dtc.waitingLayout')).toBe('newest')

  cleanup()
  renderHome()
  expect(within(card()).getByRole('button', { name: 'Sort' }).getAttribute('aria-pressed')).toBe(
    'true'
  )
})

test('the toggle offers Group and Sort, Group pressed first', () => {
  renderHome()
  expect(within(card()).getByRole('button', { name: 'Group' }).getAttribute('aria-pressed')).toBe(
    'true'
  )
  expect(within(card()).getByRole('button', { name: 'Sort' }).getAttribute('aria-pressed')).toBe(
    'false'
  )
})

test('W is the toggle on the keyboard', () => {
  renderHome()
  expect(card().querySelector('.w-group')).not.toBeNull()
  fireEvent.keyDown(window, { key: 'w' })
  expect(card().querySelector('.w-group')).toBeNull()
  fireEvent.keyDown(window, { key: 'w' })
  expect(card().querySelector('.w-group')).not.toBeNull()
})

test('the action button opens the same place as the title', () => {
  renderHome()
  const row = card().querySelector('[data-waiting-row*="run"]')!
  fireEvent.click(row.querySelector('.w-act')!)
  expect(app.navigate).toHaveBeenCalledWith({
    kind: 'runner',
    path: expect.stringContaining('layout-checks')
  })
})

test('an untitled request shows its file name as words', () => {
  const untitled = request('2026-09-12-margin-notes-wrap', {
    title: '2026-09-12-margin-notes-wrap',
    at: daysAgo(20)
  })
  app.snapshot = snapshot({ runs: [untitled] })
  renderHome()
  expect(within(card()).getByText('Margin notes wrap')).toBeTruthy()
  expect(screen.queryByText('2026-09-12-margin-notes-wrap')).toBeNull()
})

test('With your agents is closed by default, and opening it shows rows with no buttons', () => {
  renderHome()
  const agents = screen.getByRole('region', { name: 'With your agents' })
  expect(within(agents).getByText('With your agents · 2')).toBeTruthy()
  expect(within(agents).queryByText('Agent thread')).toBeNull()

  fireEvent.click(within(agents).getByRole('button', { name: /With your agents/ }))
  expect(within(agents).getByText('Agent thread')).toBeTruthy()
  expect(within(agents).getByText('Agent handoff')).toBeTruthy()
  // The rows open the record; none of them is an action.
  expect(agents.querySelector('.w-act')).toBeNull()
  fireEvent.click(within(agents).getByText('Agent thread'))
  expect(app.navigate).toHaveBeenCalledWith({
    kind: 'thread',
    project: 'tangram',
    thread: 'agent-t'
  })
  // And nothing the agents hold is counted in Waiting on you.
  expect(card().textContent).not.toContain('Agent thread')
  expect(card().querySelector('header .n')?.textContent).toBe('4')
})

function snapshot(parts: { runs?: SerializableRun[] } = {}): QaSnapshot {
  const runs = parts.runs ?? [
    request('layout-checks', { title: 'Layout checks', at: daysAgo(4), items: 2, answered: 1 }),
    request('what-goes-in', {
      title: 'What goes in',
      at: daysAgo(3),
      mode: 'doc-review',
      body: '```decision\nShip?\n- Yes\n```'
    })
  ]
  return {
    root: '/record',
    rootMissing: false,
    runs,
    notes: [],
    entries: [],
    threads: parts.runs
      ? []
      : [
          thread('me-t', 'me', 'Colleague demo', 'Does she run it?', daysAgo(3)),
          thread('agent-t', 'agent', 'Agent thread', 'Working on it.', daysAgo(1))
        ],
    handoffs: parts.runs
      ? []
      : [
          handoff('Hand over 0.35', 'me', daysAgo(2)),
          handoff('Agent handoff', 'agent', daysAgo(1), true)
        ],
    releases: [],
    pools: [],
    projects: ['tangram'],
    scannedAt: NOW.toISOString()
  }
}

function request(
  name: string,
  options: {
    title: string
    at: string
    items?: number
    answered?: number
    mode?: 'test' | 'doc-review'
    body?: string
  }
): SerializableRun {
  const mode = options.mode ?? 'test'
  const items = Array.from({ length: options.items ?? 0 }, (_, index) => ({
    id: `i${index}`,
    title: `i${index}`,
    steps: [],
    expected: [],
    notes: []
  }))
  return {
    request: {
      id: name,
      title: options.title,
      labels: {},
      mode,
      items,
      parked: [],
      degraded: false,
      raw: options.body ?? '',
      path: `/record/tangram/${name}.md`,
      ...(mode === 'doc-review'
        ? { document: { headings: [], bodyMarkdown: options.body ?? '' } }
        : {})
    },
    requestMtime: options.at,
    report: options.answered
      ? ({
          id: name,
          title: options.title,
          startedAt: options.at,
          items: items.slice(0, options.answered).map((item) => ({ id: item.id, status: 'pass' }))
        } as unknown as SerializableRun['report'])
      : null,
    status: 'waiting',
    project: 'tangram',
    round: null
  } as SerializableRun
}

function thread(id: string, move: 'me' | 'agent', title: string, body: string, at: string): Thread {
  return {
    id,
    title,
    projects: ['tangram'],
    parents: [],
    move,
    form: 'idea',
    state: 'open',
    entries: [{ path: `/record/tangram/threads/${id}.md`, thread: id, at, body }],
    firstAt: at,
    lastAt: at,
    ageDays: 0,
    cold: false,
    dictated: false
  } as unknown as Thread
}

function handoff(title: string, move: 'me' | 'agent', at: string, pickedUp = false): Handoff {
  const file = `${title.replace(/\W+/g, '-')}.md`
  return {
    path: `/record/tangram/handoffs/${file}`,
    file,
    title,
    domain: 'tangram',
    project: 'tangram',
    move,
    state: 'live',
    updated: at,
    bodyMarkdown: '',
    raw: '',
    relaunchPrompt: '',
    sidecar: { pickedUpAt: pickedUp ? at : null, archivedAt: null },
    history: pickedUp ? { kind: 'picked-up', at } : { kind: 'never-picked-up' },
    ageDays: 0,
    stale: false,
    frontmatterMalformed: false
  } as Handoff
}
