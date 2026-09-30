import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DockMenuState } from '../../../../shared/ipc'

/**
 * Ticket 27 (Dominik 2026-09-28): "the pin is whether it stays on top, the dock
 * is where it goes". The Dock split button's main part docks at the last place;
 * its ▾ opens the four places. Neither part touches the pin.
 */

const app = vi.hoisted(() => ({ dock: vi.fn(), setPinned: vi.fn(), togglePin: vi.fn() }))
vi.mock('../../state/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/app')>()),
  useApp: () => app
}))

import { CommandProvider, useCommandScope } from '../../commands/provider'
import { DockButton } from '../DockButton'

function menuState(oneScreen: boolean): DockMenuState {
  return {
    last: 'left-this',
    places: [
      { id: 'right-this', label: 'Right edge · this screen', enabled: true, current: false },
      { id: 'left-this', label: 'Left edge · this screen', enabled: true, current: true },
      {
        id: 'right-other',
        label: 'Right edge · other screen',
        enabled: !oneScreen,
        current: false
      },
      { id: 'left-other', label: 'Left edge · other screen', enabled: !oneScreen, current: false }
    ]
  }
}

/** The shell's own registration of the dock command, as App.tsx does it. */
function Shell(): React.JSX.Element {
  useCommandScope({ 'window.dock': () => app.dock('last') })
  return <DockButton />
}

function renderButton(oneScreen = false): ReturnType<typeof vi.fn> {
  const dockMenu = vi.fn().mockResolvedValue(menuState(oneScreen))
  ;(window as unknown as { qa: unknown }).qa = { dockMenu }
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <header className="titlebar">
        <Shell />
      </header>
    </CommandProvider>
  )
  return dockMenu
}

beforeEach(() => {
  app.dock.mockReset()
  app.setPinned.mockReset()
  app.togglePin.mockReset()
})

afterEach(cleanup)

test('the main part docks at the last place, by click and by its command', () => {
  renderButton()
  fireEvent.click(screen.getByRole('button', { name: 'Dock as the sidebar' }))
  expect(app.dock).toHaveBeenCalledWith('last')

  fireEvent.keyDown(window, { key: 'd', code: 'KeyD', altKey: true })
  expect(app.dock).toHaveBeenCalledTimes(2)
  expect(app.setPinned).not.toHaveBeenCalled()
  expect(app.togglePin).not.toHaveBeenCalled()
})

test('▾ opens the four places with the last one marked, and a pick docks there', async () => {
  const dockMenu = renderButton()
  fireEvent.click(screen.getByRole('button', { name: 'Choose where to dock' }))
  const menu = await screen.findByRole('menu', { name: 'Dock the sidebar' })
  expect(dockMenu).toHaveBeenCalledTimes(1)
  const items = within(menu).getAllByRole('menuitemradio')
  expect(items.map((item) => item.textContent)).toEqual([
    'Right edge · this screen',
    'Left edge · this screen',
    'Right edge · other screen',
    'Left edge · other screen'
  ])
  expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
    'false',
    'true',
    'false',
    'false'
  ])
  // No Unpin in this menu: the pin is its own control.
  expect(within(menu).queryByText(/Unpin/)).toBeNull()

  fireEvent.click(items[2])
  expect(app.dock).toHaveBeenCalledWith('right-other')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(app.setPinned).not.toHaveBeenCalled()
})

test('with one screen the other-screen places are disabled', async () => {
  renderButton(true)
  fireEvent.click(screen.getByRole('button', { name: 'Choose where to dock' }))
  const menu = await screen.findByRole('menu')
  const disabled = within(menu)
    .getAllByRole('menuitemradio')
    .filter((item) => (item as HTMLButtonElement).disabled)
    .map((item) => item.textContent)
  expect(disabled).toEqual(['Right edge · other screen', 'Left edge · other screen'])
})

test('the menu is on the keyboard: ⌥⇧D opens it, ↑/↓ move, Enter docks, Esc closes', async () => {
  renderButton(true)
  fireEvent.keyDown(window, { key: 'D', code: 'KeyD', altKey: true, shiftKey: true })
  const menu = await screen.findByRole('menu')
  // It opens on the last place; ↓ skips the disabled ones and wraps to the first.
  await waitFor(() => expect(document.activeElement?.textContent).toBe('Left edge · this screen'))
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
  await waitFor(() => expect(document.activeElement?.textContent).toBe('Right edge · this screen'))
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
  expect(app.dock).toHaveBeenCalledWith('right-this')
  expect(menu.isConnected).toBe(false)

  fireEvent.keyDown(window, { key: 'D', code: 'KeyD', altKey: true, shiftKey: true })
  await screen.findByRole('menu')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(app.dock).toHaveBeenCalledTimes(1)
})
