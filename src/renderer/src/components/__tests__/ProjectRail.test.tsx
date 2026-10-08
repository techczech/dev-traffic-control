import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'
import type { WindowScope } from '../../../../shared/windowScope'

const app = vi.hoisted(() => ({
  scope: { kind: 'all' } as WindowScope,
  snapshot: null as QaSnapshot | null,
  setScope: vi.fn(),
  openProjectHome: vi.fn(),
  focusProject: vi.fn(),
  goHome: vi.fn(),
  navigate: vi.fn(),
  openProject: vi.fn(),
  leaveFrontPage: vi.fn()
}))

vi.mock('../../state/app', () => ({ useApp: () => app }))

import { ProjectRail } from '../ProjectRail'

const NOW = '2026-09-19T09:00:00.000Z'

function snapshot(): QaSnapshot {
  return {
    root: '/record',
    rootMissing: false,
    runs: [],
    notes: [],
    entries: [],
    threads: [
      {
        id: 't1',
        title: 'A decision',
        projects: ['tangram'],
        parents: [],
        move: 'me',
        form: 'idea',
        state: 'open',
        entries: [],
        firstAt: NOW,
        lastAt: NOW,
        ageDays: 0,
        cold: false,
        dictated: false
      }
    ],
    handoffs: [],
    releases: [],
    pools: [],
    projects: ['tangram', 'windmill'],
    scannedAt: NOW
  }
}

beforeEach(() => {
  app.setScope.mockReset()
  app.focusProject.mockReset()
  app.openProjectHome.mockReset()
  app.scope = { kind: 'all' }
  app.snapshot = snapshot()
})

afterEach(cleanup)

test('the rail marks the project the window is in, and marks only it', () => {
  app.scope = { kind: 'project', slug: 'tangram' }
  render(<ProjectRail />)

  const marked = screen.getAllByRole('button').filter((row) => row.getAttribute('aria-current'))

  expect(marked.map((row) => row.textContent)).toHaveLength(1)
  expect(marked[0].textContent).toContain('Tangram')
  expect(marked[0].className).toContain('on')
})

test('under All projects the pinned entry is the marked one', () => {
  render(<ProjectRail />)

  const marked = screen.getAllByRole('button').filter((row) => row.getAttribute('aria-current'))

  expect(marked).toHaveLength(1)
  expect(marked[0].className).toContain('allrow')
})

test('activating a row sets the window scope to that project', () => {
  render(<ProjectRail />)

  fireEvent.click(screen.getByTitle(/^Windmill/))

  expect(app.setScope).toHaveBeenCalledWith({ kind: 'project', slug: 'windmill' })
})

test('activating the pinned entry sets the All projects scope', () => {
  app.scope = { kind: 'project', slug: 'windmill' }
  render(<ProjectRail />)

  fireEvent.click(screen.getByText('All projects'))

  expect(app.setScope).toHaveBeenCalledWith({ kind: 'all' })
})

test('the rail is walkable and activatable from the keyboard alone', () => {
  render(<ProjectRail />)
  const rows = screen.getAllByRole('button')

  // The rows are real buttons, so Tab reaches them; from there the navigation
  // commands walk the list and Enter activates the focused row.
  act(() => rows[0].focus())
  fireEvent.keyDown(window, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(rows[1])

  fireEvent.keyDown(window, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(rows[2])

  fireEvent.keyDown(window, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(rows[1])

  // Beside a surface, Enter focuses the project and puts the list away.
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(app.focusProject).toHaveBeenCalledWith('tangram')
})

test('beside a surface one click previews a project and a double-click focuses it', () => {
  render(<ProjectRail />)
  const row = screen.getByTitle(/^Tangram/)
  fireEvent.click(row)
  expect(app.setScope).toHaveBeenCalledWith({ kind: 'project', slug: 'tangram' })
  expect(app.focusProject).not.toHaveBeenCalled()
  fireEvent.doubleClick(row)
  expect(app.focusProject).toHaveBeenCalledWith('tangram')
})

test('the filter narrows the rail', () => {
  render(<ProjectRail />)

  fireEvent.change(screen.getByLabelText('Filter projects'), { target: { value: 'wind' } })

  expect(screen.queryByTitle(/^Tangram/)).toBeNull()
  expect(screen.getByTitle(/^Windmill/)).toBeTruthy()
})

/**
 * One list, two presentations — so the front page's rows must be the
 * rail's rows, not rows that resemble them. Rendering both and comparing every
 * row's text and tone is the assertion a second component would fail.
 */
test('the front page draws the same rows, in the same order, with the same weight', () => {
  app.scope = { kind: 'project', slug: 'tangram' }
  const railRows = rowSummary(render(<ProjectRail presentation="rail" />).container)
  cleanup()
  const frontPageRows = rowSummary(render(<ProjectRail presentation="front-page" />).container)

  expect(railRows.length).toBeGreaterThan(2)
  expect(frontPageRows).toEqual(railRows)
})

test('the front page is the same list, marked as the whole window', () => {
  const { container } = render(<ProjectRail presentation="front-page" />)
  const list = container.querySelector('nav')

  // The rail's fixed 252px is the one pixel value it keeps from the drawing;
  // the front page must not keep it, or the list would be a rail with a gap
  // beside it.
  expect(list?.className).toBe('project-rail frontpage')
  expect(screen.getByLabelText('Filter projects')).toBeTruthy()
  // The footer's count and sync line come with it: the front page keeps the
  // whole list, not a stripped one.
  expect(screen.getByText('2 projects')).toBeTruthy()
})

test('picking a project from the front page sets the scope, exactly as the rail does', () => {
  render(<ProjectRail presentation="front-page" />)

  fireEvent.click(screen.getByTitle(/^Windmill/))

  expect(app.setScope).toHaveBeenCalledWith({ kind: 'project', slug: 'windmill' })
})

/**
 * Clicking the rail row of the project already in
 * scope returns to that project's home — the second door past the menu.
 */
test('the row of the project in scope opens its home, and leaves the scope alone', () => {
  app.scope = { kind: 'project', slug: 'windmill' }
  render(<ProjectRail />)

  const row = screen.getByTitle(/^Windmill/)
  expect(row.getAttribute('title')).toMatch(/Open the project home$/)
  fireEvent.click(row)

  expect(app.openProjectHome).toHaveBeenCalledTimes(1)
  expect(app.setScope).not.toHaveBeenCalled()

  // Any other row still changes the scope.
  fireEvent.click(screen.getByTitle(/^Tangram/))
  expect(app.setScope).toHaveBeenCalledWith({ kind: 'project', slug: 'tangram' })
})

test('on the narrow front page the row in scope pushes back in, as any row does', () => {
  app.scope = { kind: 'project', slug: 'windmill' }
  render(<ProjectRail presentation="front-page" />)

  fireEvent.click(screen.getByTitle(/^Windmill/))

  expect(app.setScope).toHaveBeenCalledWith({ kind: 'project', slug: 'windmill' })
  expect(app.openProjectHome).not.toHaveBeenCalled()
})

function rowSummary(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button[data-rail-row]')].map(
    (row) => `${row.className.replace(/ ?frontpage/, '')}::${row.textContent ?? ''}`
  )
}

// The box searches the content and titles of records, not only project names.
test('the box also finds records by their text, and a match opens that record', async () => {
  const searchRecord = vi.fn().mockResolvedValue({
    hits: [
      {
        file: '/r/tangram/a.md',
        line: 4,
        column: 1,
        snippet: 'the handout fix',
        kind: 'request',
        title: 'Handout repair',
        project: 'tangram'
      },
      {
        file: '/r/tangram/a.md',
        line: 9,
        column: 1,
        snippet: 'handout again',
        kind: 'request',
        title: 'Handout repair',
        project: 'tangram'
      }
    ],
    total: 2,
    files: 1,
    cap: 200,
    capped: false
  })
  ;(window as unknown as { qa: { searchRecord: typeof searchRecord } }).qa = { searchRecord }
  render(<ProjectRail />)
  fireEvent.change(screen.getByLabelText('Filter projects'), { target: { value: 'handout' } })
  const row = await screen.findByText('Handout repair', {}, { timeout: 2000 })
  expect(screen.getAllByText('Handout repair')).toHaveLength(1)
  fireEvent.click(row)
  expect(app.openProject).toHaveBeenCalledWith('tangram')
  expect(app.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'runner', path: '/r/tangram/a.md' })
  )
})
