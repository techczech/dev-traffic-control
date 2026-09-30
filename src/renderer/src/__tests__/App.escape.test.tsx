import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const app = vi.hoisted(() => ({
  view: { kind: 'runner', path: '/qa/dev-traffic-control/light-request.md' } as const,
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
  setScope: vi.fn()
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
vi.mock('../views/Runner', () => ({
  Runner: () => <textarea className="lr-note" aria-label="Problem note for Check one" rows={1} />
}))

import App from '../App'

beforeEach(() => {
  app.back.mockReset()
})

afterEach(cleanup)

test('Escape blurs the problem-note textarea without navigating back', () => {
  render(<App />)
  const note = screen.getByRole('textbox', { name: 'Problem note for Check one' })
  note.focus()

  fireEvent.keyDown(note, { key: 'Escape' })

  expect(document.activeElement).not.toBe(note)
  expect(app.back).not.toHaveBeenCalled()
})
