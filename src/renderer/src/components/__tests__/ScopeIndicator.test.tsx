import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'
import type { WindowScope } from '../../../../shared/windowScope'

const app = vi.hoisted(() => ({
  scope: { kind: 'all' } as WindowScope,
  snapshot: null as QaSnapshot | null,
  onFrontPage: false,
  returnToFrontPage: vi.fn(),
  navigate: vi.fn(),
  back: vi.fn(),
  view: { kind: 'dashboard' } as { kind: string },
  showToast: vi.fn()
}))
const BINDINGS: Record<string, string> = {
  'nav.project-home': 'Mod+Shift+H',
  'app.navigation-switcher': 'Mod+Shift+K',
  'nav.all-projects': 'Mod+Shift+0'
}
const commands = vi.hoisted(() => ({
  run: vi.fn(),
  binding: (id: string) => BINDINGS[id] ?? ''
}))

vi.mock('../../state/app', () => ({ useApp: () => app }))
// The real command scope: with no provider mounted it listens on the window
// itself, so the menu's keyboard path is exercised as registered.
vi.mock('../../commands/provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commands/provider')>()),
  useCommands: () => commands
}))

import { ScopeIndicator } from '../ScopeIndicator'
import { RAIL_MIN_WINDOW_WIDTH } from '../../lib/railVisibility'

// A mid-width window below the rail threshold: the old 860px expanded strip.
const WIDE_WIDTH = 860

beforeEach(() => {
  commands.run.mockReset()
  app.showToast.mockReset()
  app.view = { kind: 'dashboard' }
  app.returnToFrontPage.mockReset()
  app.navigate.mockReset()
  app.back.mockReset()
  app.scope = { kind: 'all' }
  app.snapshot = null
  app.onFrontPage = false
  widthIs(RAIL_MIN_WINDOW_WIDTH)
})

function widthIs(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

/** The one control in the titlebar that is not the scope chip. */
function backControl(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Back to the project list' })
}

afterEach(cleanup)

test('All projects reads as a named scope, not a blank', () => {
  render(<ScopeIndicator />)

  expect(screen.getByText('All projects')).toBeTruthy()
  expect(screen.getByRole('button').className).toContain('all')
})

test('a project scope names the project in the titlebar', () => {
  app.scope = { kind: 'project', slug: 'windmill-desktop' }
  render(<ScopeIndicator />)

  expect(screen.getByText('Windmill Desktop')).toBeTruthy()
  expect(screen.getByRole('button').className).not.toContain('all')
})

test.each([{ kind: 'all' } as const, { kind: 'project', slug: 'windmill' } as const])(
  'the indicator opens the searchable switcher in $kind scope',
  (scope) => {
    app.scope = scope
    render(<ScopeIndicator />)

    fireEvent.click(screen.getByRole('button', { name: /Switch project/ }))

    expect(commands.run).toHaveBeenCalledWith('app.navigation-switcher')
    expect(screen.queryByRole('menu')).toBeNull()
  }
)

test('under All projects the indicator opens the switcher: there is no home to enter', () => {
  render(<ScopeIndicator />)

  fireEvent.click(screen.getByRole('button'))

  expect(commands.run).toHaveBeenCalledWith('app.navigation-switcher')
})

/**
 * Pushed into a project in the narrow presentation,
 * the way back out sits beside the scope indicator.
 */
test('the way back appears only when a narrow window has pushed into a scope', () => {
  widthIs(WIDE_WIDTH)
  render(<ScopeIndicator />)
  expect(backControl()).toBeTruthy()

  cleanup()
  app.onFrontPage = true
  render(<ScopeIndicator />)
  // Already on the list: there is nothing to go back to.
  expect(backControl()).toBeNull()

  cleanup()
  app.onFrontPage = false
  widthIs(RAIL_MIN_WINDOW_WIDTH)
  render(<ScopeIndicator />)
  // Wide: the list is on screen beside the content, so the control is noise.
  expect(backControl()).toBeNull()
})

test('the way back returns to the list, and is not the view-history back', () => {
  widthIs(WIDE_WIDTH)
  app.scope = { kind: 'project', slug: 'windmill-desktop' }
  render(<ScopeIndicator />)

  fireEvent.click(backControl()!)

  expect(app.returnToFrontPage).toHaveBeenCalledTimes(1)
  // It clears no scope and pops no view — a back press must never lose the
  // project.
  expect(app.scope).toEqual({ kind: 'project', slug: 'windmill-desktop' })
  expect(app.back).not.toHaveBeenCalled()
  expect(app.navigate).not.toHaveBeenCalled()
  expect(commands.run).not.toHaveBeenCalled()
})

test('the project stays named beside the way back', () => {
  widthIs(WIDE_WIDTH)
  app.scope = { kind: 'project', slug: 'windmill-desktop' }
  render(<ScopeIndicator />)

  expect(backControl()).toBeTruthy()
  expect(screen.getByText('Windmill Desktop')).toBeTruthy()
})

test('a project scope has no menu', () => {
  app.scope = { kind: 'project', slug: 'windmill-desktop' }
  render(<ScopeIndicator />)
  fireEvent.click(screen.getByRole('button', { name: /Switch project/ }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(commands.run).toHaveBeenCalledWith('app.navigation-switcher')
})
