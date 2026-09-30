import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'

const PATH = '/qa/dev-traffic-control/2026-07-27-review.md'

const app = vi.hoisted(() => ({
  switcherOpen: true,
  setSwitcherOpen: vi.fn(),
  switcherMode: 'nav' as const,
  pickSwitcherLink: vi.fn(),
  snapshot: null as QaSnapshot | null,
  navigate: vi.fn(),
  markSeen: vi.fn(),
  scope: { kind: 'all' } as { kind: 'all' } | { kind: 'project'; slug: string },
  setScope: vi.fn()
}))

vi.mock('../../state/app', () => ({
  useApp: () => app
}))

import { Switcher } from '../Switcher'

beforeEach(() => {
  app.setSwitcherOpen.mockReset()
  app.pickSwitcherLink.mockReset()
  app.navigate.mockReset()
  app.markSeen.mockReset()
  app.setScope.mockReset()
  app.scope = { kind: 'all' }
  app.snapshot = {
    root: '/qa',
    rootMissing: false,
    runs: [
      {
        request: {
          id: 'review',
          title: 'Review the progress wording',
          labels: { kind: 'Doc-Review' },
          mode: 'doc-review',
          items: [],
          parked: [],
          degraded: false,
          document: { headings: [], bodyMarkdown: '' },
          raw: '',
          path: PATH
        },
        report: null,
        status: 'waiting',
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
    scannedAt: ''
  }
})

afterEach(cleanup)

test('uses normalised mode for the Switcher review label and one-cell spine', () => {
  const { container } = render(<Switcher />)
  expect(screen.getByText('review')).toBeTruthy()
  expect(container.querySelectorAll('.ckrow .mini i')).toHaveLength(1)
})

test('opening a run from the Switcher marks it seen before navigation', () => {
  render(<Switcher />)

  fireEvent.click(screen.getByRole('option', { name: /Review the progress wording/ }))

  expect(app.markSeen).toHaveBeenCalledWith('dev-traffic-control/2026-07-27-review.md')
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'runner', path: PATH })
})

test('All projects sits in the same list as the projects and sets the scope', () => {
  const { container } = render(<Switcher />)

  const rows = [...container.querySelectorAll('.ckrow')]
  const all = rows.find((row) => row.textContent?.startsWith('All projects'))
  const project = rows.find((row) => row.textContent === 'dev-traffic-controlproject')
  expect(all).toBeTruthy()
  expect(project).toBeTruthy()
  expect(rows.indexOf(all!)).toBeLessThan(rows.indexOf(project!))

  fireEvent.click(project!)
  expect(app.setScope).toHaveBeenCalledWith({ kind: 'project', slug: 'dev-traffic-control' })
  expect(app.navigate).not.toHaveBeenCalled()

  fireEvent.click(all!)
  expect(app.setScope).toHaveBeenCalledWith({ kind: 'all' })
})

test('the scope the window is already on is marked rather than hidden', () => {
  app.scope = { kind: 'project', slug: 'dev-traffic-control' }
  const { container } = render(<Switcher />)

  const marked = container.querySelectorAll('.ckrow .ckcurrent')
  expect(marked).toHaveLength(1)
  expect(marked[0]?.closest('.ckrow')?.textContent).toContain('dev-traffic-control')
})
