import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Settings as SettingsType, SettingsChange } from '../../../../shared/ipc'

const app = vi.hoisted(() => ({
  settings: {
    qaRepoPath: '/records',
    appearance: 'light',
    readingTextSize: 'normal',
    pinBehaviour: 'remember',
    pinned: false,
    dockBadge: true,
    runnerMode: 'focus',
    widthPreset: 'narrow',
    windowMode: 'free',
    verdictLayout: 'one',
    reviewMargin: 'auto',
    keymap: { 'window.toggle-pin': 'Alt+P' },
    getStartedRetired: false
  } as SettingsType,
  changeSetting: vi.fn(),
  setPinned: vi.fn(),
  setWidthPreset: vi.fn(),
  setWindowMode: vi.fn(),
  back: vi.fn(),
  openCommandPalette: vi.fn(),
  reloadSettings: vi.fn(),
  navigate: vi.fn()
}))

vi.mock('../../state/app', () => ({
  useApp: () => app
}))

import { Settings } from '../Settings'

beforeEach(() => {
  app.changeSetting.mockReset()
  app.setPinned.mockReset()
  app.setWidthPreset.mockReset()
  app.setWindowMode.mockReset()
  const retiredChange = {
    key: 'coordinationFolderPath',
    from: '/old-coordination',
    to: '/new-coordination',
    at: '2026-07-17T08:00:00.000Z'
  } as unknown as SettingsChange
  Object.defineProperty(window, 'qa', {
    configurable: true,
    writable: true,
    value: {
      getSettingsLog: vi.fn(async () => [retiredChange]),
      getVersion: vi.fn(async () => '0.15.0-test')
    } as unknown as Window['qa']
  })
})

afterEach(cleanup)

test('renders the raw key for a changelog entry whose setting no longer exists', async () => {
  render(<Settings />)

  expect(await screen.findByText('coordinationFolderPath')).toBeTruthy()
})

test('shows effective bindings read-only and opens the palette for changes', async () => {
  render(<Settings />)

  expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy()
  expect(screen.getByTestId('keymap:app.command-palette').textContent).toContain('⌘⇧P')
  expect(screen.getByTestId('keymap:window.toggle-pin').textContent).toContain('⌥P')
  expect(screen.getByTestId('keymap:window.toggle-pin').textContent).toContain('Changed')

  fireEvent.click(screen.getByRole('button', { name: 'Change shortcuts in the command palette' }))
  expect(app.openCommandPalette).toHaveBeenCalledWith('all')
})

test('shows the version reported by the running build', async () => {
  render(<Settings />)

  expect(await screen.findByText('0.15.0-test')).toBeTruthy()
  expect(window.qa.getVersion).toHaveBeenCalledOnce()
})

test('finds the new surface shortcut preferences by surface name', () => {
  render(<Settings />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Search settings' }), {
    target: { value: 'Roadmap' }
  })

  expect(screen.getByTestId('keymap:nav.roadmap')).toBeTruthy()
  expect(screen.getByTestId('keymap:roadmap.promote')).toBeTruthy()
  expect(screen.queryByTestId('keymap:release.ship')).toBeNull()
})

test('changes request reading text size through the ordinary settings path', () => {
  render(<Settings />)

  const group = screen.getByRole('group', { name: 'Request text size' })
  expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe('Normal')

  fireEvent.click(screen.getByRole('button', { name: 'Extra large' }))
  expect(app.changeSetting).toHaveBeenCalledWith('readingTextSize', 'extra-large')
})

test('Reset compares object values deeply instead of staying enabled for equal keymaps', async () => {
  window.qa.getSettingsLog = vi.fn(async () => [
    {
      key: 'keymap',
      from: { 'window.toggle-pin': 'Alt+P' },
      to: { 'window.toggle-pin': 'Mod+P' },
      at: '2026-08-01T10:00:00.000Z'
    }
  ])
  render(<Settings />)

  const reset = await screen.findByRole('button', { name: /Reset Keyboard shortcuts/i })
  expect(reset.hasAttribute('disabled')).toBe(true)
})

test('Reset for a historical pin change uses the focused-window layout action', async () => {
  window.qa.getSettingsLog = vi.fn(async () => [
    {
      key: 'pinned',
      from: true,
      to: false,
      at: '2026-08-01T10:00:00.000Z'
    }
  ])
  render(<Settings />)

  fireEvent.click(await screen.findByRole('button', { name: /Reset Pin state/i }))

  expect(app.setPinned).toHaveBeenCalledWith(true)
  expect(app.changeSetting).not.toHaveBeenCalledWith('pinned', true)
})

function withFolderQa(setSetting: () => Promise<unknown>): void {
  app.reloadSettings.mockReset()
  Object.defineProperty(window, 'qa', {
    configurable: true,
    writable: true,
    value: {
      getSettingsLog: vi.fn(async () => []),
      getVersion: vi.fn(async () => '0.15.0-test'),
      pickFolder: vi.fn(async () => '/records/picked'),
      setSetting: vi.fn(setSetting)
    } as unknown as Window['qa']
  })
}

test('changing the record folder sets the picked folder and reloads settings', async () => {
  withFolderQa(async () => ({ ...app.settings, qaRepoPath: '/records/picked' }))
  render(<Settings />)
  fireEvent.click(screen.getByRole('button', { name: 'Change…' }))
  await waitFor(() => expect(app.reloadSettings).toHaveBeenCalled())
  expect(window.qa.setSetting).toHaveBeenCalledWith('qaRepoPath', '/records/picked')
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a refused record-folder change says so and never reloads as if it worked', async () => {
  withFolderQa(async () => {
    throw new Error('That folder was not chosen in the folder dialog')
  })
  render(<Settings />)
  fireEvent.click(screen.getByRole('button', { name: 'Change…' }))
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toMatch(/could not use that folder/i)
  )
  expect(app.reloadSettings).not.toHaveBeenCalled()
})

test('Settings carries Get started, and offers the button back only once it is retired', () => {
  render(<Settings />)
  fireEvent.click(screen.getAllByRole('button', { name: 'Get started' })[0])
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'get-started' })
  expect(screen.queryByRole('button', { name: 'Show the button again' })).toBeNull()
  cleanup()

  app.settings = { ...app.settings, getStartedRetired: true }
  render(<Settings />)
  fireEvent.click(screen.getByRole('button', { name: 'Show the button again' }))
  expect(app.changeSetting).toHaveBeenCalledWith('getStartedRetired', false)
  app.settings = { ...app.settings, getStartedRetired: false }
})
