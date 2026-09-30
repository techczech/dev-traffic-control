import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { RAIL_MIN_WINDOW_WIDTH } from '../lib/railVisibility'
import { NARROW_WIDTH } from '../../../main/windowLayout'

// A mid-width window below the rail threshold: the old 860px expanded strip.
const WIDE_WIDTH = 860

/**
 * Ticket 13. The rail was gated on `settings.widthPreset === 'wide'` — a
 * docking preference whose `wide` is an 860px strip — so it appeared in a
 * window with no room for it. These render the real shell and ask whether the
 * rail is on screen at a given measured width.
 */

const app = vi.hoisted(() => ({
  view: { kind: 'dashboard' } as { kind: string },
  navigate: vi.fn(),
  back: vi.fn(),
  helpOpen: false,
  setHelpOpen: vi.fn(),
  switcherOpen: false,
  setSwitcherOpen: vi.fn(),
  togglePin: vi.fn(),
  snapshot: null,
  firstRun: false,
  toast: null,
  scope: { kind: 'all' } as const,
  onFrontPage: false,
  returnToFrontPage: vi.fn(),
  leaveFrontPage: vi.fn(),
  setScope: vi.fn(),
  listMode: 'browse' as 'browse' | 'focus',
  // The old gate: kept deliberately at `wide` so a regression to it would show
  // the rail at 860px and fail the first test below.
  settings: { widthPreset: 'wide', readingTextSize: 'normal', windowMode: 'free' }
}))

vi.mock('../state/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/app')>()),
  AppProvider: ({ children }: { children: React.ReactNode }) => children,
  useApp: () => app
}))

vi.mock('../components/Chrome', () => ({ Chrome: () => null }))
vi.mock('../components/ScopeIndicator', () => ({ ScopeIndicator: () => null }))
vi.mock('../components/KeyHintBar', () => ({ KeyHintBar: () => null }))
vi.mock('../components/CheatSheet', () => ({ CheatSheet: () => null }))
vi.mock('../components/Switcher', () => ({
  Switcher: () => <div data-testid="switcher" />
}))
vi.mock('../components/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('../components/SurfaceTabs', () => ({
  SurfaceTabs: () => <nav aria-label="App surfaces" />
}))
vi.mock('../views/Dashboard', () => ({
  Dashboard: () => <div>dashboard</div>,
  ThreadView: () => null
}))

import App from '../App'

function renderAt(width: number, onFrontPage = false): void {
  app.onFrontPage = onFrontPage
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  render(<App />)
}

const list = (): HTMLElement | null => screen.queryByRole('navigation', { name: 'Projects' })
const tabs = (): HTMLElement | null => screen.queryByRole('navigation', { name: 'App surfaces' })

afterEach(() => {
  cleanup()
  app.onFrontPage = false
  app.leaveFrontPage.mockReset()
})

test('the docked wide preset, 860px, is too narrow for the rail', () => {
  renderAt(WIDE_WIDTH)
  expect(screen.queryByRole('navigation', { name: 'Projects' })).toBeNull()
})

test('a window wide enough for the rail and a full surface shows the rail', () => {
  renderAt(RAIL_MIN_WINDOW_WIDTH)
  expect(screen.getByRole('navigation', { name: 'Projects' })).toBeTruthy()
})

test('the rail appears and disappears as the window is actually resized', () => {
  renderAt(WIDE_WIDTH)
  expect(screen.queryByRole('navigation', { name: 'Projects' })).toBeNull()

  act(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: RAIL_MIN_WINDOW_WIDTH + 200,
      configurable: true,
      writable: true
    })
    window.dispatchEvent(new Event('resize'))
  })
  expect(screen.getByRole('navigation', { name: 'Projects' })).toBeTruthy()

  act(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: WIDE_WIDTH,
      configurable: true,
      writable: true
    })
    window.dispatchEvent(new Event('resize'))
  })
  expect(screen.queryByRole('navigation', { name: 'Projects' })).toBeNull()
})

/**
 * Ticket 04. At his working width ticket 13 left NO project list at all — the
 * rail refused to render and nothing replaced it. These are about what a narrow
 * window shows instead.
 */
describe('narrow: the project list is the front page', () => {
  test.each([
    ['the narrow preset, 460px', NARROW_WIDTH],
    ['the wide preset, 860px — his docked window', WIDE_WIDTH]
  ])('%s shows the whole list and no tab bar', (_label, width) => {
    renderAt(width, true)

    expect(list()).toBeTruthy()
    expect(list()?.className).toContain('frontpage')
    // The six surfaces belong to a scope and none has been chosen, so there is
    // nothing for tabs to apply to (ADR-0016 design lock).
    expect(tabs()).toBeNull()
    // The list IS the window: no surface is drawn beside or beneath it.
    expect(document.querySelector('.viewroot')).toBeNull()
    expect(screen.queryByText('dashboard')).toBeNull()
  })

  test('pushed into a project the tabs return and the list steps aside', () => {
    renderAt(WIDE_WIDTH, false)

    expect(tabs()).toBeTruthy()
    expect(screen.getByText('dashboard')).toBeTruthy()
    expect(list()).toBeNull()
  })

  // Two presentations of one list. A width or a state that produced both would
  // put a 252px rail beside a front page.
  test.each([NARROW_WIDTH, WIDE_WIDTH, RAIL_MIN_WINDOW_WIDTH, 1440])(
    'at %ipx exactly one presentation is on screen, in both states',
    (width) => {
      for (const onFrontPage of [true, false]) {
        renderAt(width, onFrontPage)
        const lists = screen.queryAllByRole('navigation', { name: 'Projects' })
        expect(lists).toHaveLength(width >= RAIL_MIN_WINDOW_WIDTH || onFrontPage ? 1 : 0)
        for (const node of lists) {
          expect(node.className.includes('frontpage')).toBe(width < RAIL_MIN_WINDOW_WIDTH)
        }
        cleanup()
      }
    }
  )

  // The fastest route between projects is the same route in both presentations.
  test('the switcher is mounted over the front page too', () => {
    renderAt(NARROW_WIDTH, true)

    expect(screen.getByTestId('switcher')).toBeTruthy()
  })

  // A wide window has no front page: the list is already beside the content and
  // a surface is showing. Narrowing must not throw away the place he was in.
  test('a window showing the rail is told it is not on a front page', () => {
    renderAt(RAIL_MIN_WINDOW_WIDTH, true)

    expect(app.leaveFrontPage).toHaveBeenCalled()
  })
})

/**
 * Ticket 08. A project surface reached under *All projects* — by Back, or by
 * moving the window to All projects while it showed one — says it does not
 * apply, rather than showing one project's content or a merge of every one.
 */
describe('a project surface under All projects', () => {
  afterEach(() => {
    app.view = { kind: 'dashboard' }
  })

  test.each(['specs', 'releases', 'roadmap', 'handoffs'])(
    '%s is drawn as not applicable, with the way to a project and to Overview',
    (kind) => {
      app.view = { kind }
      renderAt(RAIL_MIN_WINDOW_WIDTH)
      expect(screen.getByText(`Pick a project to see its ${kind}`)).toBeTruthy()
      expect(screen.getByRole('button', { name: /Switch project/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Go to Overview' })).toBeTruthy()
    }
  )
})

// Ticket 23: browse mode and focus mode are different layouts.
describe('browse mode and focus mode on a wide window', () => {
  afterEach(() => {
    app.listMode = 'browse'
  })

  test('browsing: the list is out and the tabs sit in the pane beside it', () => {
    renderAt(1440)
    expect(list()).toBeTruthy()
    expect(tabs()?.closest('.panehead')).toBeTruthy()
  })

  test('focused: no list, and the pane carries no header of its own', () => {
    app.listMode = 'focus'
    renderAt(1440)
    expect(list()).toBeNull()
    expect(document.querySelector('.panehead')).toBeNull()
  })
})
