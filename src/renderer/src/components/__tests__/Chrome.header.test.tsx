import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WindowScope } from '../../../../shared/windowScope'

/**
 * Ticket 14. A screenshot of 0.21.0-alpha.2 showed the header naming
 * two things twice: the app printed its own name in the middle of the titlebar,
 * and "Dashboard" appeared as the selected tab and again as a heading beneath
 * it. ADR-0016's design lock allows each thing exactly one naming on one screen.
 *
 * This is the composition half of the repair — which names the header renders in
 * which scope. The geometry half (nothing overflows, nothing is pushed, nothing
 * wraps at 460, 860 and 1440) is in lib/__tests__/dashboardLayout.test.ts.
 */

const app = vi.hoisted(() => ({
  pinned: false,
  view: { kind: 'dashboard' } as { kind: string },
  settings: { widthPreset: 'narrow', windowMode: 'floating' } as Record<string, unknown>,
  scope: { kind: 'all' } as WindowScope,
  snapshot: null as unknown,
  onFrontPage: false,
  listMode: 'focus' as string,
  goHome: vi.fn() as () => void,
  returnToFrontPage: vi.fn(),
  navigate: vi.fn()
}))
const commands = vi.hoisted(() => ({ run: vi.fn(), binding: () => '' }))

vi.mock('../../state/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/app')>()),
  useApp: () => app
}))
vi.mock('../../commands/provider', () => ({
  useCommands: () => commands,
  useCommandScope: () => {}
}))
vi.mock('../../lib/specs', () => ({ needsSpecCount: () => 0, specRows: () => [] }))

import { Chrome } from '../Chrome'
import { SurfaceTabs } from '../SurfaceTabs'
import { isOnDtcDash } from '../../lib/dashLabel'

beforeEach(() => {
  app.pinned = false
  app.view = { kind: 'dashboard' }
  app.scope = { kind: 'all' }
  app.onFrontPage = false
  app.listMode = 'focus'
  app.settings = { widthPreset: 'narrow', windowMode: 'floating' }
  Object.defineProperty(window, 'innerWidth', { value: 460, configurable: true, writable: true })
  // The version arrives over IPC; the header must be right before and after it.
  Object.defineProperty(window, 'qa', {
    value: { getVersion: () => Promise.resolve('0.21.0-alpha.2') },
    configurable: true,
    writable: true
  })
})

afterEach(cleanup)

test('the app does not print its own name inside itself', () => {
  const { container } = render(<Chrome />)

  // The centred span is gone, and with it the element that wrapped to three
  // lines at 460px and collided with the build marker.
  expect(container.querySelector('.titlebar .app')).toBeNull()
  expect(screen.queryByText('Dev Traffic Control')).toBeNull()
})

test('the build marker has left the header entirely', () => {
  // The app version is smaller and sits in the footer. It is
  // reference rather than chrome, and in the header it was one more thing a
  // long project name had to be measured against. It now lives in the key-hint
  // bar; this asserts only that the header no longer carries it.
  const { container } = render(<Chrome />)

  expect(container.querySelector('.titlebar .buildtag')).toBeNull()
  expect(container.querySelector('.titlebar .buildmark')).toBeNull()
})

test('the header names the project exactly once, in the chip', () => {
  app.scope = { kind: 'project', slug: 'wordforge-desktop' }
  render(<Chrome />)

  expect(screen.getAllByText('Wordforge Desktop')).toHaveLength(1)
})

test('under All projects the scope is still named once and only there', () => {
  render(<Chrome />)

  expect(screen.getAllByText('All projects')).toHaveLength(1)
})

test('the header carries exactly the way back, the chip and the controls', () => {
  app.scope = { kind: 'project', slug: 'wordforge-desktop' }
  const { container } = render(<Chrome />)

  const titlebar = container.querySelector('.titlebar')!
  // Narrow and pushed into a project: the way back is drawn.
  expect(titlebar.querySelector('.scopeback')).toBeTruthy()
  expect(titlebar.querySelector('.scopechip')).toBeTruthy()
  // Five controls plus Back, which is in the title bar in every mode (ticket 23),
  // plus the DTC Dash home button, an icon button since alpha.28.
  // Dock is a split button (ticket 27): one control, two iconbtn parts.
  expect(titlebar.querySelectorAll('.iconbtn')).toHaveLength(8)
  expect(titlebar.querySelectorAll('.dockbtn')).toHaveLength(1)
  expect(titlebar.querySelector('.tb-back')).toBeTruthy()
  // DTC Dash (was Home) sits on the left, right after Back (2026-09-26).
  expect(titlebar.children[1]?.classList.contains('homebtn')).toBe(true)
  // One empty element holds all the slack, so nothing named has to stretch.
  expect(titlebar.querySelectorAll('.tbspace')).toHaveLength(1)
  expect(titlebar.querySelector('.tbspace')!.textContent).toBe('')
  // Nothing else. Anything added here is something the header now says twice.
  expect(titlebar.children).toHaveLength(10)
})

test('the surface is named by its tab and nowhere else on the screen', () => {
  const { container } = render(
    <>
      <Chrome />
      <SurfaceTabs />
    </>
  )

  // The tab names the surface. The one other place its name may appear is the
  // DTC Dash button under All projects, which goes to that very surface
  //.
  const label = app.scope.kind === 'project' ? 'Project Dash' : 'DTC Dash'
  const named = screen.getAllByText(label).filter((node) => !node.closest('.homebtn'))
  expect(named).toHaveLength(1)
  expect(named[0].closest('nav')).toBe(container.querySelector('.surface-tabs'))
  expect(named[0].closest('button')!.getAttribute('aria-current')).toBe('page')
})

test('inside a project Project Dash is the selected first tab without a crumb', () => {
  app.scope = { kind: 'project', slug: 'wordforge-desktop' }
  const { container } = render(<SurfaceTabs />)
  const tabs = [...container.querySelectorAll('.surface-tabs button')]
  expect(tabs).toHaveLength(7)
  expect(tabs[0].textContent).toBe('Project Dash')
  expect(tabs[0].getAttribute('aria-current')).toBe('page')
  expect(container.querySelector('.surface-home')).toBeNull()
  expect(container.querySelector('.surface-sep')).toBeNull()
})

describe('the DTC Dash home button (alpha.28)', () => {
  // The teal "DTC Dash" chip read as the active project, so the home button
  // is a plain button instead. Teal in the bar now
  // means only the project/scope chip.
  test.each([
    ['narrow', 460],
    ['wide', 1440]
  ])('is an icon-only neutral button at the %s width', (preset, width) => {
    app.settings = { widthPreset: preset, windowMode: 'floating' }
    Object.defineProperty(window, 'innerWidth', {
      value: width,
      configurable: true,
      writable: true
    })
    app.scope = { kind: 'project', slug: 'wordforge-desktop' }
    render(
      <Chrome
        layout={
          width > 600
            ? { rail: false, header: 'titlebar', listToggle: true }
            : { rail: false, header: 'titlebar-row', listToggle: false }
        }
      />
    )

    const home = screen.getByRole('button', { name: 'DTC Dash' })
    expect(home.classList.contains('homebtn')).toBe(true)
    expect(home.classList.contains('iconbtn')).toBe(true)
    expect(home.classList.contains('scopechip')).toBe(false)
    // No visible label: the name is the aria-label and the tooltip.
    expect(home.textContent).toBe('')
    expect(home.querySelector('svg')).toBeTruthy()
    expect(home.getAttribute('title')).toMatch(/^DTC Dash/)
    // In a project the DTC Dash is not showing.
    expect(home.classList.contains('on')).toBe(false)
    expect(home.getAttribute('aria-pressed')).toBe('false')
  })

  test('still goes home', () => {
    app.goHome = vi.fn()
    render(<Chrome />)
    fireEvent.click(screen.getByRole('button', { name: 'DTC Dash' }))
    expect(app.goHome).toHaveBeenCalledTimes(1)
  })

  test('is pressed while the DTC Dash is the view on screen', () => {
    app.settings = { widthPreset: 'wide', windowMode: 'floating' }
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true })
    render(<Chrome />)
    const home = screen.getByRole('button', { name: 'DTC Dash' })
    expect(home.classList.contains('on')).toBe(true)
    expect(home.getAttribute('aria-pressed')).toBe('true')
  })

  test('is not pressed on another surface, or behind the narrow project list', () => {
    app.view = { kind: 'inbox' }
    const { unmount } = render(<Chrome />)
    expect(screen.getByRole('button', { name: 'DTC Dash' }).classList.contains('on')).toBe(false)
    unmount()

    app.view = { kind: 'dashboard' }
    app.onFrontPage = true
    render(<Chrome />)
    expect(screen.getByRole('button', { name: 'DTC Dash' }).classList.contains('on')).toBe(false)
  })
})

describe('isOnDtcDash', () => {
  test('is All projects, the dashboard, and no project list in front of it', () => {
    const all = { kind: 'all' } as WindowScope
    expect(isOnDtcDash({ scope: all, viewKind: 'dashboard', onProjectList: false })).toBe(true)
    expect(isOnDtcDash({ scope: all, viewKind: 'dashboard', onProjectList: true })).toBe(false)
    expect(isOnDtcDash({ scope: all, viewKind: 'inbox', onProjectList: false })).toBe(false)
    expect(
      isOnDtcDash({
        scope: { kind: 'project', slug: 'x' } as WindowScope,
        viewKind: 'dashboard',
        onProjectList: false
      })
    ).toBe(false)
  })
})
