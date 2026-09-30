import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'
import type { ProjectRelease } from '../../../../main/qa/releaseRecords'

/**
 * Ticket 27 fix round: "the same screen controls for docking". With the
 * verdict sheet open — one at a time or all at once — the title bar's pin,
 * Dock (both parts) and Expand are still there and still work, and using them
 * leaves the sheet open. That the sheet does not cover them on screen is
 * measured in real Chrome in lib/__tests__/verdictSheet.layout.test.ts.
 */

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  navigate: vi.fn(),
  markSeen: vi.fn(),
  changeSetting: vi.fn(),
  settings: { verdictLayout: 'one', widthPreset: 'narrow', windowMode: 'free' } as Record<
    string,
    unknown
  >,
  pinned: false,
  view: { kind: 'project-home' } as { kind: string },
  scope: { kind: 'project', slug: 'tallyboard' } as { kind: 'project'; slug: string },
  back: vi.fn(),
  canGoBack: true,
  listMode: 'focus',
  setListMode: vi.fn(),
  goHome: vi.fn(),
  onFrontPage: false,
  returnToFrontPage: vi.fn(),
  togglePin: vi.fn(),
  dock: vi.fn(),
  setWidthPreset: vi.fn()
}))

vi.mock('../../state/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/app')>()),
  useApp: () => app
}))

import { CommandProvider, useCommandScope } from '../../commands/provider'
import { Chrome } from '../../components/Chrome'
import { ProjectHome } from '../ProjectHome'

/** The window commands as App.tsx registers them. */
function Shell(): React.JSX.Element {
  useCommandScope({
    'window.toggle-pin': app.togglePin,
    'window.dock': () => app.dock('last'),
    'window.toggle-width': () => app.setWidthPreset('wide')
  })
  return (
    <>
      <Chrome />
      <ProjectHome slug="tallyboard" />
    </>
  )
}

beforeEach(() => {
  for (const fn of [app.togglePin, app.dock, app.setWidthPreset, app.changeSetting]) fn.mockReset()
  ;(window as unknown as { qa: unknown }).qa = {
    getVersion: () => Promise.resolve('0.21.0'),
    answerRelease: vi.fn().mockResolvedValue({}),
    dockMenu: vi.fn().mockResolvedValue({
      last: 'right-this',
      places: [
        { id: 'right-this', label: 'Right edge · this screen', enabled: true, current: true },
        { id: 'left-this', label: 'Left edge · this screen', enabled: true, current: false },
        { id: 'right-other', label: 'Right edge · other screen', enabled: false, current: false },
        { id: 'left-other', label: 'Left edge · other screen', enabled: false, current: false }
      ]
    })
  }
  app.snapshot = snapshot()
})

afterEach(cleanup)

for (const layout of ['one', 'all'] as const) {
  test(`with the sheet open ${layout === 'one' ? 'one at a time' : 'all at once'}, pin, Dock and Expand still work`, async () => {
    app.settings = { ...app.settings, verdictLayout: layout }
    render(
      <CommandProvider overrides={{}} onOverridesChange={() => {}}>
        <Shell />
      </CommandProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /Give the verdict/ }))
    const sheet = screen.getByRole('dialog', {
      name: layout === 'one' ? 'Verdict 1 of 1' : 'Verdicts all at once'
    })

    // The controls belong to the title bar, not to the sheet.
    const titlebar = document.querySelector('.titlebar') as HTMLElement
    expect(sheet.contains(titlebar)).toBe(false)
    const pin = within(titlebar).getByRole('button', { name: 'Pin beside the app under test' })
    const dock = within(titlebar).getByRole('button', { name: 'Dock as the sidebar' })
    const where = within(titlebar).getByRole('button', { name: 'Choose where to dock' })
    const expand = within(titlebar).getByRole('button', { name: 'Widen the window' })

    fireEvent.click(pin)
    expect(app.togglePin).toHaveBeenCalledTimes(1)
    fireEvent.click(dock)
    expect(app.dock).toHaveBeenCalledWith('last')
    fireEvent.click(expand)
    expect(app.setWidthPreset).toHaveBeenCalledWith('wide')

    fireEvent.click(where)
    const menu = await screen.findByRole('menu', { name: 'Dock the sidebar' })
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Left edge · this screen/ }))
    expect(app.dock).toHaveBeenLastCalledWith('left-this')

    // Esc with the menu open closes the menu, not the sheet.
    fireEvent.click(where)
    await screen.findByRole('menu')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    // None of it closed the sheet.
    expect(sheet.isConnected).toBe(true)
    expect(screen.getByRole('dialog', { name: sheet.getAttribute('aria-label')! })).toBe(sheet)
  })
}

function snapshot(): QaSnapshot {
  const record = {
    path: '/record/tallyboard/releases/0.31.0.md',
    version: '0.31.0',
    app: 'TallyBoard',
    release: '0.31.0',
    repo: 'apps/tallyboard',
    updated: '2026-09-11',
    features: [{ id: 'a', title: 'First feature', kind: 'feature', status: 'you' }],
    answers: [],
    degraded: false
  }
  const release = {
    kind: 'recorded',
    project: 'tallyboard',
    record,
    versions: [{ version: '0.31.0', record }],
    inFlightVersion: '0.31.0'
  } as unknown as ProjectRelease
  return {
    root: '/record',
    rootMissing: false,
    runs: [],
    notes: [],
    entries: [],
    threads: [],
    handoffs: [],
    releases: [release],
    pools: [],
    projects: ['tallyboard'],
    scannedAt: '2026-09-19T09:00:00Z'
  }
}
