import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { WindowScope } from '../../../shared/windowScope'

/**
 * The project home is reached without a tab: ⌘⇧H is one of its
 * three doors, and it is shown with the six tabs' strip above it. These render
 * the real shell and press the real chord.
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
  scope: { kind: 'project', slug: 'windmill' } as WindowScope,
  onFrontPage: false,
  returnToFrontPage: vi.fn(),
  leaveFrontPage: vi.fn(),
  setScope: vi.fn(),
  openProjectHome: vi.fn(),
  openSwitcher: vi.fn(),
  showToast: vi.fn(),
  settings: { widthPreset: 'narrow', readingTextSize: 'normal', windowMode: 'free' }
}))

vi.mock('../state/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/app')>()),
  AppProvider: ({ children }: { children: React.ReactNode }) => children,
  useApp: () => app
}))

vi.mock('../components/Chrome', () => ({ Chrome: () => null }))
vi.mock('../components/KeyHintBar', () => ({ KeyHintBar: () => null }))
vi.mock('../components/CheatSheet', () => ({ CheatSheet: () => null }))
vi.mock('../components/Switcher', () => ({ Switcher: () => null }))
vi.mock('../components/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('../components/SurfaceTabs', () => ({
  SurfaceTabs: () => <nav aria-label="App surfaces" />
}))
vi.mock('../views/ProjectHome', () => ({
  ProjectHome: ({ slug }: { slug: string }) => <div>home of {slug}</div>
}))
vi.mock('../views/Dashboard', () => ({
  Dashboard: () =>
    app.scope.kind === 'project' ? <div>home of {app.scope.slug}</div> : <div>dashboard</div>,
  ThreadView: () => null
}))

import App from '../App'

beforeEach(() => {
  app.view = { kind: 'dashboard' }
  app.scope = { kind: 'project', slug: 'windmill' }
  app.openProjectHome.mockReset()
  app.setScope.mockReset()
  // Pushed into a project in a narrow window: tabs on, no rail.
  Object.defineProperty(window, 'innerWidth', { value: 460, configurable: true, writable: true })
})

afterEach(cleanup)

test('Overview is the scoped project home, with the tab strip above it', () => {
  render(<App />)

  expect(screen.getByText('home of windmill')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'App surfaces' })).toBeTruthy()
})

test('⌘⇧H opens the project home', () => {
  app.view = { kind: 'dashboard' }
  render(<App />)

  fireEvent.keyDown(window, { key: 'H', code: 'KeyH', metaKey: true, shiftKey: true })

  expect(app.openProjectHome).toHaveBeenCalledTimes(1)
})

test('the project link command copies the scoped project link', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(<App />)

  fireEvent.keyDown(window, { key: 'L', code: 'KeyL', metaKey: true, shiftKey: true })

  expect(writeText).toHaveBeenCalledWith('dtc://project/windmill')
})

test('⌘⇧0 moves the window to All projects, as the menu says it does', () => {
  render(<App />)

  fireEvent.keyDown(window, { key: ')', code: 'Digit0', metaKey: true, shiftKey: true })

  expect(app.setScope).toHaveBeenCalledWith({ kind: 'all' })
})

test('under All projects ⌘⇧H is off and Overview shows the fleet', () => {
  app.scope = { kind: 'all' }
  render(<App />)

  fireEvent.keyDown(window, { key: 'H', code: 'KeyH', metaKey: true, shiftKey: true })

  expect(app.openProjectHome).not.toHaveBeenCalled()
  expect(screen.getByText('dashboard')).toBeTruthy()
  expect(screen.queryByText(/home of/)).toBeNull()
})
