import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'
import type { Thread } from '../../../../main/qa/types'
import type { Handoff } from '../../../../main/qa/handoffs'
import type { WindowScope } from '../../../../shared/windowScope'

/**
 * The reviewer installed the build, clicked a project in the rail, and
 * the Dashboard still said "All projects" and still listed every project's
 * work. These render the two surfaces that were blind to the scope and ask
 * what the reviewer would have seen.
 */

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  scope: { kind: 'all' } as WindowScope,
  navigate: vi.fn(),
  selectedPath: null as string | null,
  setSelectedPath: vi.fn(),
  reloadSettings: vi.fn(),
  helpOpen: false,
  switcherOpen: false,
  seen: new Set<string>() as ReadonlySet<string>,
  seenLoaded: true,
  archived: new Set<string>() as ReadonlySet<string>,
  archiveRequest: vi.fn(),
  unarchiveRequest: vi.fn(),
  markSeen: vi.fn(),
  back: vi.fn(),
  showToast: vi.fn(),
  setScope: vi.fn(),
  openSwitcher: vi.fn(),
  view: { kind: 'dashboard' } as { kind: string }
}))

vi.mock('../../state/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/app')>()),
  useApp: () => app
}))

import { Dashboard } from '../Dashboard'
import { Inbox } from '../Inbox'
import { SurfaceTabs } from '../../components/SurfaceTabs'

function run(project: string, title: string): SerializableRun {
  return {
    request: {
      id: title,
      title,
      labels: {},
      mode: 'test',
      items: [],
      parked: [],
      degraded: false,
      raw: '',
      path: `/qa/${project}/2026-09-10-${title.toLocaleLowerCase()}.md`
    },
    report: null,
    status: 'waiting',
    project,
    round: null
  }
}

function thread(project: string, id: string): Thread {
  return {
    id,
    title: id,
    projects: [project],
    parents: [],
    move: 'me',
    form: 'idea',
    state: 'open',
    entries: [],
    firstAt: '2026-09-10T00:00:00.000Z',
    lastAt: '2026-09-10T00:00:00.000Z',
    ageDays: 0,
    cold: false,
    dictated: false
  }
}

function handoff(project: string, index: number): Handoff {
  const at = new Date(Date.parse('2026-09-12T08:00:00.000Z') - index * 3_600_000).toISOString()
  return {
    path: `/qa/${project}/handoffs/${index}.md`,
    file: `${index}.md`,
    title: `Handoff ${index}`,
    domain: project,
    project,
    move: 'agent',
    state: 'live',
    updated: at,
    bodyMarkdown: '',
    raw: '',
    relaunchPrompt: '',
    sidecar: { pickedUpAt: null, archivedAt: null },
    history: { kind: 'never-picked-up' },
    ageDays: 0,
    stale: false,
    frontmatterMalformed: false
  }
}

const FLEET: QaSnapshot = {
  root: '/qa',
  rootMissing: false,
  runs: [run('windmill', 'Export block model'), run('rivermill', 'Streaming prepare')],
  notes: [],
  entries: [],
  threads: [thread('windmill', 'wf-thread'), thread('rivermill', 'rf-thread')],
  handoffs: [],
  releases: [],
  pools: [],
  projects: ['windmill', 'rivermill'],
  scannedAt: '2026-09-12T09:00:00.000Z'
}

beforeEach(() => {
  app.snapshot = FLEET
  app.scope = { kind: 'all' }
  app.selectedPath = null
  app.navigate.mockReset()
  app.setScope.mockReset()
  app.view = { kind: 'dashboard' }
})

afterEach(cleanup)

describe('Dashboard follows the window scope', () => {
  // Under All projects the Overview is the fleet's home
  // — one line per project, not the project view with a wildcard.
  test('under All projects it says where each project stands, one line each', () => {
    render(<Dashboard />)
    expect(screen.getByText('Where each project stands')).toBeTruthy()
    const rows = document.querySelectorAll('[data-fleet-row]')
    expect([...rows].map((row) => row.getAttribute('data-fleet-row'))).toEqual([
      'rivermill',
      'windmill'
    ])
    expect(screen.getAllByText('1 waiting on you · 1 decision owed')).toHaveLength(2)
    expect(screen.getByText('waiting on you')).toBeTruthy()
    expect(screen.queryByText('Project vitals')).toBeNull()
  })

  // Fix round: 21 handoffs listed in full pushed Latest below the fold at 860px
  // and at 1500px. State 17 has both side panels above it.
  test('under All projects the handoffs panel draws four, then says how many more', () => {
    app.snapshot = {
      ...FLEET,
      handoffs: Array.from({ length: 21 }, (_, index) => handoff('rivermill', index))
    }
    render(<Dashboard />)

    const panel = screen.getByRole('region', { name: 'Handoffs ready' })
    // A handoff here is the same row as on the Project Dash.
    expect(panel.querySelectorAll('[data-waiting-row]')).toHaveLength(4)
    expect(within(panel).getAllByRole('button', { name: /Pick up/ })).toHaveLength(4)
    expect(within(panel).getByText('17 more handoffs ready')).toBeTruthy()
    expect(panel.querySelector('header .n')?.textContent).toBe('21')
    const tile = screen.getByText('handoffs ready').closest('.fleet-tile')
    expect(tile?.querySelector('.n')?.textContent).toBe('21')
    expect(screen.getByRole('region', { name: 'Latest across the fleet' })).toBeTruthy()
  })

  test('under All projects a short handoffs list has no closing row', () => {
    app.snapshot = { ...FLEET, handoffs: [handoff('rivermill', 0), handoff('windmill', 1)] }
    render(<Dashboard />)

    const panel = screen.getByRole('region', { name: 'Handoffs ready' })
    expect(panel.querySelectorAll('[data-waiting-row]')).toHaveLength(2)
    expect(panel.querySelector('[data-fleet-handoffs-more]')).toBeNull()
  })

  test('under All projects a project name opens that project', () => {
    render(<Dashboard />)
    fireEvent.click(document.querySelector('[data-fleet-row="windmill"]')!)
    expect(app.setScope).toHaveBeenCalledWith({ kind: 'project', slug: 'windmill' })
  })

  test('under All projects the table is the reviewer\'s to sort', () => {
    render(<Dashboard />)
    const select = screen.getByLabelText('Sort projects') as HTMLSelectElement
    expect(select.value).toBe('last-moved')
    fireEvent.change(select, { target: { value: 'name' } })
    expect(select.value).toBe('name')
    expect(screen.getByRole('button', { name: 'Project' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Last' }))
    expect(screen.getByRole('button', { name: 'Last' }).getAttribute('aria-pressed')).toBe('true')
  })

  test('in a project it shows the project home and drops the fleet', () => {
    app.scope = { kind: 'project', slug: 'windmill' }
    render(<Dashboard />)
    expect(screen.getByRole('region', { name: 'Waiting on you' })).toBeTruthy()
    expect(screen.queryByText('Where each project stands')).toBeNull()
  })

  // Each thing is named exactly once on a screen, so the surface has no
  // heading at all: the tab names it. A heading could only repeat the tab or
  // disagree with the titlebar.
  test('it carries no heading of its own, in a project', () => {
    app.scope = { kind: 'project', slug: 'windmill' }
    render(<Dashboard />)
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    expect(screen.queryByText('Dashboard')).toBeNull()
    expect(screen.queryByText('All projects')).toBeNull()
  })

  test('and none under All projects either, so it can never disagree', () => {
    render(<Dashboard />)
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    expect(screen.queryByText('Dashboard')).toBeNull()
  })

  test('the project filter, whose empty option reads All projects, is gone in a project', () => {
    app.scope = { kind: 'project', slug: 'windmill' }
    render(<Dashboard />)
    expect(screen.queryByLabelText('Filter by project')).toBeNull()
  })
})

describe('Inbox follows the window scope', () => {
  // One list across projects, each row naming its
  // project first because under this scope it cannot be assumed.
  test('under All projects it lists every open request, each naming its project first', () => {
    render(<Inbox />)
    const rows = [...document.querySelectorAll('[data-fleet-request]')].map(
      (row) => row.querySelector('.t')?.textContent
    )
    expect(rows).toEqual(['Windmill · Export block model', 'Rivermill · Streaming prepare'])
    expect(screen.getByText('Open across two projects')).toBeTruthy()
    expect(document.querySelector('.pghead')).toBeNull()
  })

  test('under All projects it is sortable and filterable', () => {
    render(<Inbox />)
    fireEvent.change(screen.getByLabelText('Sort requests'), { target: { value: 'project' } })
    const rows = [...document.querySelectorAll('[data-fleet-request]')].map(
      (row) => row.querySelector('.t')?.textContent
    )
    expect(rows).toEqual(['Rivermill · Streaming prepare', 'Windmill · Export block model'])
    fireEvent.click(screen.getByRole('button', { name: 'Being built' }))
    expect(document.querySelectorAll('[data-fleet-request]')).toHaveLength(0)
  })

  test('in a project it shows one group and counts only that project', () => {
    app.scope = { kind: 'project', slug: 'rivermill' }
    render(<Inbox />)
    expect(screen.getByText('Streaming prepare')).toBeTruthy()
    expect(screen.queryByText('Export block model')).toBeNull()
    expect(screen.getByText(/1 waiting/)).toBeTruthy()
  })
})

describe('the four project surfaces under All projects', () => {
  const projectOnly = ['Specs', 'Releases', 'Roadmap', 'Handoffs']

  test('are visibly not applicable — dimmed and inert — while Overview and Inbox are live', () => {
    render(<SurfaceTabs />)
    for (const label of projectOnly) {
      const tab = screen.getByRole('button', { name: label })
      expect((tab as HTMLButtonElement).disabled).toBe(true)
      expect(tab.className).toContain('off')
    }
    for (const label of ['DTC Dash', 'Inbox']) {
      expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(
        false
      )
    }
    fireEvent.click(screen.getByRole('button', { name: 'Releases' }))
    expect(app.navigate).not.toHaveBeenCalled()
  })

  test('come back to life in a project', () => {
    app.scope = { kind: 'project', slug: 'windmill' }
    render(<SurfaceTabs />)
    for (const label of projectOnly) {
      const tab = screen.getByRole('button', { name: label })
      expect((tab as HTMLButtonElement).disabled).toBe(false)
      expect(tab.className).not.toContain('off')
    }
  })
})
