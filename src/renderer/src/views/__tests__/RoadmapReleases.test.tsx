import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PoolIdea } from '../../../../main/qa/pool'
import type { QaSnapshot } from '../../../../shared/ipc'

/**
 * Ticket 42. The Roadmap grouped by release: Pending first, later releases,
 * Unscheduled; a drag or Move to… rewrites the feature's candidate through the
 * existing roadmap idea write and nothing else.
 */

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  scope: { kind: 'project', slug: 'app' } as { kind: string; slug?: string },
  view: { kind: 'roadmap' } as { kind: string },
  navigate: vi.fn(),
  showToast: vi.fn(),
  helpOpen: false,
  switcherOpen: false
}))
vi.mock('../../state/app', () => ({ useApp: () => app }))

import { RoadmapByRelease } from '../RoadmapReleases'
import { RoadmapSwitch } from '../RoadmapSwitch'
import { CommandProvider } from '../../commands/provider'

const writePoolIdea = vi.fn()

function idea(
  id: string,
  extra: Partial<PoolIdea> & { request?: Record<string, unknown> }
): PoolIdea {
  return {
    id,
    title: `Title ${id}`,
    tier: 'functionality',
    bodyMarkdown: '',
    state: 'pool',
    path: `/r/app/roadmap/${id}.md`,
    position: 1,
    isNew: false,
    ...extra
  } as PoolIdea
}

const IDEAS = [
  idea('a', {
    candidateRelease: '0.23.0',
    request: { by: 'reviewer', fate: 'planned', quotes: ['say a'], said: [], related: [] }
  }),
  idea('b', { candidateRelease: '0.24.0' }),
  idea('c', {}),
  idea('wait', { request: { by: 'reviewer', fate: 'waiting', quotes: [], said: [], related: [] } })
]

function snapshot(ideas: PoolIdea[]): QaSnapshot {
  return {
    root: '/r',
    scannedAt: '2026-10-01T10:00:00Z',
    projects: ['app'],
    runs: [],
    notes: [],
    threads: [],
    entries: [],
    handoffs: [],
    releases: [
      {
        kind: 'recorded',
        project: 'app',
        record: {},
        versions: [{ version: '0.22.0', record: {} }],
        inFlightVersion: '0.22.0'
      }
    ],
    pools: [{ project: 'app', directory: '/r/app/roadmap', ideas, degradedOrder: false }]
  } as unknown as QaSnapshot
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  Object.defineProperty(window, 'qa', {
    value: { writePoolIdea },
    configurable: true,
    writable: true
  })
  app.snapshot = snapshot(IDEAS)
  writePoolIdea.mockResolvedValue({ pool: app.snapshot.pools[0], id: 'a' })
})
afterEach(cleanup)

function renderRoadmap(layout: 'columns' | 'list' = 'columns'): void {
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <RoadmapByRelease layout={layout} onLayout={() => {}} />
    </CommandProvider>
  )
}

const groupLabels = (): string[] =>
  [...document.querySelectorAll('.rr-group-h strong')].map((node) => node.textContent ?? '')

test('groups the approved features: Pending first and marked, later releases, Unscheduled', () => {
  renderRoadmap()
  expect(groupLabels()).toEqual(['Pending – 0.23.0', '0.24.0', 'Unscheduled'])
  expect(document.querySelector('[data-group="pending"] .rr-badge')?.textContent).toBe('PENDING')
  expect(document.querySelector('[data-group="pending"] [data-card="a"]')).toBeTruthy()
  expect(document.querySelector('[data-group="unscheduled"] [data-card="c"]')).toBeTruthy()
  // A request still waiting for his yes is not a card; a link says so.
  expect(document.querySelector('[data-card="wait"]')).toBeNull()
  expect(screen.getByText('1 request waiting for your yes in Feature requests')).toBeTruthy()
  expect(screen.getByText('0.22.0 is in flight in Releases')).toBeTruthy()
})

test('chips: his quote on a request, Agent proposed on the others; the filters narrow', () => {
  renderRoadmap()
  expect(within(document.querySelector('[data-card="a"]')!).getByText('“say a”')).toBeTruthy()
  expect(
    within(document.querySelector('[data-card="b"]')!).getByText('Agent proposed')
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'From you' }))
  expect(document.querySelector('[data-card="a"]')).toBeTruthy()
  expect(document.querySelector('[data-card="b"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'From agents' }))
  expect(document.querySelector('[data-card="a"]')).toBeNull()
  expect(document.querySelector('[data-card="b"]')).toBeTruthy()
})

test('dragging a card onto another column rewrites its candidate and nothing else', async () => {
  renderRoadmap()
  const card = document.querySelector('[data-card="a"]')!
  const target = document.querySelector('[data-group="0.24.0"]')!
  fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
  fireEvent.dragOver(target, { dataTransfer: {} })
  expect(within(target as HTMLElement).getByText('Drop here to move it into 0.24.0')).toBeTruthy()
  fireEvent(target, createEvent.drop(target))
  await waitFor(() => expect(writePoolIdea).toHaveBeenCalledTimes(1))
  expect(writePoolIdea).toHaveBeenCalledWith({
    project: 'app',
    action: 'edit',
    id: 'a',
    candidate: '0.24.0'
  })
})

test('Unscheduled clears the candidate; Move to… does the same from the keyboard path', async () => {
  renderRoadmap()
  fireEvent.click(screen.getByRole('button', { name: 'Move to… Title a' }))
  const menu = screen.getByRole('menu', { name: 'Move to release' })
  expect(within(menu).getByText('0.23.0 · pending')).toBeTruthy()
  expect(within(menu).getByText('current')).toBeTruthy()
  fireEvent.click(within(menu).getByRole('menuitem', { name: /Unscheduled/ }))
  await waitFor(() => expect(writePoolIdea).toHaveBeenCalledTimes(1))
  expect(writePoolIdea.mock.calls[0][0]).toEqual({
    project: 'app',
    action: 'edit',
    id: 'a',
    candidate: null
  })
})

test('A new release… asks for a later version and moves the card there', async () => {
  renderRoadmap('list')
  fireEvent.click(screen.getByRole('button', { name: 'Move to… Title a' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'A new release…' }))
  const input = screen.getByLabelText('New release version')
  fireEvent.change(input, { target: { value: '0.22.0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Move there' }))
  expect(writePoolIdea).not.toHaveBeenCalled()
  expect(screen.getByText(/Type a version later than 0.23.0/)).toBeTruthy()
  fireEvent.change(input, { target: { value: '0.26' } })
  fireEvent.click(screen.getByRole('button', { name: 'Move there' }))
  await waitFor(() => expect(writePoolIdea).toHaveBeenCalledTimes(1))
  expect(writePoolIdea.mock.calls[0][0]).toMatchObject({ id: 'a', candidate: '0.26.0' })
})

test('the list opens Pending and folds the later groups', () => {
  renderRoadmap('list')
  expect(document.querySelector('[data-group="pending"] [data-card="a"]')).toBeTruthy()
  expect(document.querySelector('[data-card="b"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^0\.24\.0/ }))
  expect(document.querySelector('[data-card="b"]')).toBeTruthy()
})

test('once the pending release ships the new pending group is empty and says so', () => {
  const shipped = snapshot([IDEAS[0], IDEAS[2]])
  ;(shipped.releases[0] as unknown as { versions: unknown[] }).versions.push({
    version: '0.23.0',
    record: {}
  })
  app.snapshot = shipped
  renderRoadmap()
  expect(groupLabels()[0]).toBe('Pending – 0.24.0')
  expect(screen.getByText(/Nothing in it yet/)).toBeTruthy()
  expect(screen.queryByText('Start a new pending release')).toBeNull()
})

test('Start a new pending release is the fallback when no version can be derived', () => {
  app.snapshot = { ...snapshot(IDEAS), releases: [] } as unknown as QaSnapshot
  renderRoadmap()
  expect(groupLabels()).not.toContain('Pending')
  fireEvent.click(screen.getByRole('button', { name: 'Start a new pending release' }))
  fireEvent.change(screen.getByLabelText('Version of the pending release'), {
    target: { value: '0.1.0' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start it' }))
  expect(groupLabels()[0]).toBe('Pending – 0.1.0')
})

test('the layout choice is remembered', () => {
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <RoadmapSwitch />
    </CommandProvider>
  )
  expect(document.querySelector('.rr-columns')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  expect(document.querySelector('.rr-list')).toBeTruthy()
  cleanup()
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <RoadmapSwitch />
    </CommandProvider>
  )
  expect(document.querySelector('.rr-list')).toBeTruthy()
})
