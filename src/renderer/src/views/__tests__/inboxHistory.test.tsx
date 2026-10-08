import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  selectedPath: null as string | null,
  setSelectedPath: vi.fn(),
  navigate: vi.fn(),
  openProject: vi.fn(),
  reloadSettings: vi.fn(),
  helpOpen: false,
  switcherOpen: false,
  seen: new Set<string>() as ReadonlySet<string>,
  seenLoaded: true,
  archived: new Set<string>() as ReadonlySet<string>,
  archiveRequest: vi.fn(),
  unarchiveRequest: vi.fn(),
  // The project these fixtures live in: the rows under test belong to the
  // per-project Overview and Inbox (under All projects both are the fleet's).
  scope: { kind: 'project', slug: 'dev-traffic-control' } as
    { kind: 'all' } | { kind: 'project'; slug: string }
}))

vi.mock('../../state/app', () => ({
  useApp: () => app
}))

import { Inbox } from '../Inbox'

beforeEach(() => {
  app.selectedPath = null
  app.setSelectedPath.mockReset()
  app.navigate.mockReset()
  app.openProject.mockReset()
  app.reloadSettings.mockReset()
  app.seen = new Set(['2026-07-27-observed'])
  app.seenLoaded = true
  app.archived = new Set()
  app.archiveRequest.mockReset()
  app.unarchiveRequest.mockReset()
  app.snapshot = {
    root: '/qa',
    rootMissing: false,
    runs: [
      {
        request: {
          id: 'observed',
          title: 'Observed request',
          date: '2026-07-27',
          labels: {},
          mode: 'test',
          items: [
            {
              id: 'one',
              title: 'One',
              steps: [],
              expected: [],
              notes: []
            }
          ],
          parked: [],
          degraded: false,
          raw: '',
          path: '/qa/dev-traffic-control/2026-07-27-observed.md'
        },
        requestMtime: '2026-07-27T11:55:00.000Z',
        report: {
          id: 'observed',
          title: 'Observed request',
          startedAt: '2026-07-27T11:57:00.000Z',
          noteFiles: [],
          observations: [
            {
              id: 'obs-1',
              text: 'The tray moved after save.',
              screenshots: []
            }
          ],
          items: [
            {
              id: 'one',
              title: 'One',
              status: 'unanswered',
              comment: '',
              flagged: [],
              quotes: [],
              screenshots: []
            }
          ]
        },
        status: 'in-progress',
        project: 'dev-traffic-control',
        round: null
      }
    ],
    notes: [],
    entries: [],
    threads: [],
    handoffs: [],
    releases: [],
    pools: [],
    projects: ['dev-traffic-control'],
    scannedAt: '2026-07-27T12:00:00.000Z'
  }
})

afterEach(() => {
  cleanup()
})

test('the Inbox request row shows the same work-history line as Dashboard', () => {
  render(<Inbox />)

  expect(screen.getByText('Test request · Work noted · 0 of 1 answered')).toBeTruthy()
  expect(screen.queryByText('Waiting')).toBeNull()
})

// The project's group header and → are two doors. Both are "show me this project", whose one answer is
// the project home.
test('the group header and the open-project command both lead to the project home', () => {
  const { container } = render(<Inbox />)

  fireEvent.click(container.querySelector('.pghead')!)
  expect(app.openProject).toHaveBeenLastCalledWith('dev-traffic-control')

  app.openProject.mockReset()
  app.selectedPath = '/qa/dev-traffic-control/2026-07-27-observed.md'
  cleanup()
  render(<Inbox />)
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(app.openProject).toHaveBeenLastCalledWith('dev-traffic-control')
  expect(app.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'project' }))
})

test('the Inbox call site shows a seen unanswered request as opened', () => {
  const run = app.snapshot!.runs[0]
  run.report = null
  run.status = 'waiting'
  app.seen = new Set(['dev-traffic-control/2026-07-27-observed.md'])

  render(<Inbox />)

  expect(screen.getByText('Test request · Opened — nothing answered yet')).toBeTruthy()
})

test('the Inbox call site gives neither shared-basename row ambiguous legacy history', () => {
  const first = app.snapshot!.runs[0]
  first.report = null
  first.status = 'waiting'
  first.request.path = '/qa/project-one/2026-07-27-observed.md'
  first.project = 'project-one'
  const second = structuredClone(first)
  second.request.path = '/qa/project-two/2026-07-27-observed.md'
  second.project = 'project-two'
  second.request.title = 'Second observed request'
  app.snapshot!.runs = [first, second]
  app.snapshot!.projects = ['project-one', 'project-two']
  app.seen = new Set(['2026-07-27-observed'])

  // Each project's Inbox in turn: the ambiguity lives in the whole record, not
  // in the scope, so either row alone must still refuse the legacy match.
  const scope = app.scope
  try {
    for (const slug of ['project-one', 'project-two']) {
      app.scope = { kind: 'project', slug }
      render(<Inbox />)
      expect(screen.getAllByText('Test request · Not opened yet')).toHaveLength(1)
      cleanup()
    }
  } finally {
    app.scope = scope
  }
})

test('a failed replacement-root bootstrap is caught and explained without reloading settings', async () => {
  app.snapshot!.rootMissing = true
  const bootstrapRepo = vi.fn(async () => {
    throw new Error('EACCES')
  })
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: { pickFolder: vi.fn(async () => '/records/chosen'), bootstrapRepo }
  })

  render(<Inbox />)
  fireEvent.click(screen.getByRole('button', { name: 'Choose location…' }))

  await waitFor(() => expect(screen.getByText(/could not use that folder/i)).toBeTruthy())
  expect(app.reloadSettings).not.toHaveBeenCalled()
})

test('a refused replacement-root bootstrap (main returns null) is a failure, never a reload', async () => {
  app.snapshot!.rootMissing = true
  app.reloadSettings.mockClear()
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: {
      pickFolder: vi.fn(async () => '/records/chosen'),
      bootstrapRepo: vi.fn(async () => null)
    }
  })

  render(<Inbox />)
  fireEvent.click(screen.getByRole('button', { name: 'Choose location…' }))

  await waitFor(() => expect(screen.getByText(/could not use that folder/i)).toBeTruthy())
  expect(app.reloadSettings).not.toHaveBeenCalled()
})
