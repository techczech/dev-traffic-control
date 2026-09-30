import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { COMMANDS } from '../../commands/registry'

const app = vi.hoisted(() => ({
  helpOpen: true,
  setHelpOpen: vi.fn(),
  settings: { keymap: {} }
}))

vi.mock('../../state/app', () => ({
  useApp: () => app
}))

import { CheatSheet } from '../CheatSheet'

beforeEach(() => {
  app.helpOpen = true
  app.setHelpOpen.mockReset()
})

afterEach(cleanup)

test('renders every registered command without a hand-maintained allow-list', () => {
  render(<CheatSheet />)
  for (const command of COMMANDS) {
    expect(screen.getAllByTestId(`cheat-command:${command.id}`)).toHaveLength(1)
  }
})

test('lists all six top-level surfaces with their current shortcuts', () => {
  render(<CheatSheet />)

  const surfaces = [
    ['nav.dashboard', 'Go to Overview', '⌘1'],
    ['nav.inbox', 'Go to Inbox', '⌘2'],
    ['nav.specs', 'Go to Specs', '⌘3'],
    ['nav.releases', 'Go to Releases', '⌘4'],
    ['nav.roadmap', 'Go to Roadmap', '⌘5'],
    ['nav.handoffs', 'Go to Handoffs', '⌘6']
  ]

  for (const [id, title, shortcut] of surfaces) {
    const row = screen.getByTestId(`cheat-command:${id}`)
    expect(row.textContent).toContain(title)
    expect(row.textContent).toContain(shortcut)
  }
})

test('reflects a persisted override immediately without remounting', () => {
  const rendered = render(<CheatSheet />)
  expect(screen.getByTestId('cheat-command:nav.roadmap').textContent).toContain('⌘5')

  app.settings = { keymap: { 'nav.roadmap': 'Alt+R' } }
  rendered.rerender(<CheatSheet />)

  const row = screen.getByTestId('cheat-command:nav.roadmap')
  expect(row.textContent).toContain('⌥R')
  expect(row.textContent).not.toContain('⌘5')
})

test('focuses the filter on open, filters immediately, and Escape returns focus', async () => {
  app.helpOpen = false
  const origin = document.createElement('textarea')
  origin.setAttribute('aria-label', 'Original comment')
  document.body.append(origin)
  origin.focus()

  const rendered = render(<CheatSheet />)
  app.helpOpen = true
  rendered.rerender(<CheatSheet />)

  const filter = screen.getByRole('textbox', { name: 'Filter keyboard shortcuts' })
  await waitFor(() => expect(document.activeElement).toBe(filter))

  fireEvent.change(filter, { target: { value: 'Pin beside' } })
  expect(screen.getByText('Pin beside the app under test')).toBeTruthy()
  expect(screen.queryByText('Keyboard cheat sheet')).toBeNull()

  fireEvent.keyDown(filter, { key: 'Escape' })
  expect(app.setHelpOpen).toHaveBeenCalledWith(false)
  expect(document.activeElement).toBe(origin)
  origin.remove()
})
