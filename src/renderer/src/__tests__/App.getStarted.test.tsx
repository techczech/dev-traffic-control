import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { WindowScope } from '../../../shared/windowScope'

/**
 * Ticket 34. Get started is a page of its own: ⌥⌘G (a registered command, so
 * also in the palette) opens it, and it is drawn under the Dash tab.
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
  scope: { kind: 'all' } as WindowScope,
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
vi.mock('../views/GetStarted', () => ({ GetStarted: () => <div>get started page</div> }))
vi.mock('../views/Dashboard', () => ({
  Dashboard: () => <div>dashboard</div>,
  ThreadView: () => null
}))

import App from '../App'

beforeEach(() => {
  app.view = { kind: 'dashboard' }
  app.navigate.mockReset()
  Object.defineProperty(window, 'innerWidth', { value: 460, configurable: true, writable: true })
})

afterEach(cleanup)

test('⌥⌘G opens Get started', () => {
  render(<App />)
  fireEvent.keyDown(window, { key: 'g', code: 'KeyG', metaKey: true, altKey: true })
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'get-started' })
})

test('the Get started page renders under the tab strip', () => {
  app.view = { kind: 'get-started' }
  render(<App />)
  expect(screen.getByText('get started page')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'App surfaces' })).toBeTruthy()
  fireEvent.keyDown(window, { key: 'g', code: 'KeyG', metaKey: true, altKey: true })
  expect(app.navigate).not.toHaveBeenCalled()
})
