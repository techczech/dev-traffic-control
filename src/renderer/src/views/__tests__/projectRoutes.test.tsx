import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'

/**
 * Ticket 12. Every door that used to open the retired ADR-0006 project view —
 * the dashboard's project vitals and the sync-lag fallback of a link — now
 * opens the project home, through the one route "show me this project" takes.
 * (The Inbox's two doors are held in inboxHistory.test.tsx, leaving a record in
 * lib/__tests__/recordExit.test.ts, links in state/__tests__/app.test.tsx.)
 */

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  navigate: vi.fn(),
  openProject: vi.fn(),
  dismissLinkArrival: vi.fn(),
  retryLinkArrival: vi.fn(),
  linkRetryInFlight: false,
  markSeen: vi.fn(),
  helpOpen: false,
  switcherOpen: false,
  seen: new Set<string>() as ReadonlySet<string>,
  seenLoaded: true,
  scope: { kind: 'project', slug: 'wordforge' } as
    { kind: 'all' } | { kind: 'project'; slug: string }
}))

vi.mock('../../state/app', () => ({ useApp: () => app }))

import { LinkArrivalTakeover } from '../../components/LinkArrival'

function run(project: string): SerializableRun {
  return {
    request: {
      id: 'r1',
      title: 'A request',
      labels: {},
      mode: 'test',
      items: [],
      parked: [],
      degraded: false,
      raw: '',
      path: `/qa/${project}/2026-09-20-a-request.md`
    },
    requestMtime: '2026-09-20T10:00:00.000Z',
    report: null,
    status: 'waiting',
    project,
    round: null
  }
}

beforeEach(() => {
  app.navigate.mockReset()
  app.openProject.mockReset()
  app.dismissLinkArrival.mockReset()
  app.snapshot = {
    root: '/qa',
    rootMissing: false,
    runs: [run('wordforge')],
    notes: [],
    entries: [],
    threads: [],
    handoffs: [],
    releases: [],
    pools: [],
    projects: ['wordforge'],
    scannedAt: '2026-09-20T12:00:00.000Z'
  }
})

afterEach(cleanup)

test('a link whose record has not synced offers the project home instead', () => {
  render(
    <LinkArrivalTakeover
      arrival={{
        kind: 'behind',
        url: 'dtc://open/wordforge/2026-09-20-missing.md',
        project: 'wordforge',
        coldLaunch: false
      }}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: /instead/ }))
  expect(app.dismissLinkArrival).toHaveBeenCalled()
  expect(app.openProject).toHaveBeenCalledWith('wordforge')
})
