import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CommandProvider, useCommandScope } from '../../commands/provider'
import type { KeymapOverrides } from '../../commands/keymap'
import { COMMANDS } from '../../commands/registry'

const app = vi.hoisted(() => ({
  commandPaletteOpen: true,
  commandPaletteMode: 'all' as const,
  closeCommandPalette: vi.fn(),
  view: { kind: 'inbox' } as const,
  snapshot: null,
  selectedPath: null
}))

vi.mock('../../state/app', () => ({ useApp: () => app }))

import { CommandPalette } from '../CommandPalette'

function Harness(): React.JSX.Element {
  const [overrides, setOverrides] = useState<KeymapOverrides>({})
  return (
    <CommandProvider overrides={overrides} onOverridesChange={setOverrides}>
      <AvailableCommands />
      <CommandPalette />
      <output aria-label="Overrides">{JSON.stringify(overrides)}</output>
    </CommandProvider>
  )
}

function AvailableCommands(): null {
  useCommandScope({
    'app.command-palette': () => {},
    'window.toggle-pin': () => {},
    'nav.dashboard': () => {},
    'nav.inbox': () => {},
    'nav.specs': () => {},
    'nav.releases': () => {},
    'nav.roadmap': () => {},
    'nav.handoffs': () => {}
  })
  return null
}

test('lists every top-level surface with its shortcut', () => {
  render(<Harness />)

  for (const [title, shortcut] of [
    ['Go to Overview', '⌘1'],
    ['Go to Inbox', '⌘2'],
    ['Go to Specs', '⌘3'],
    ['Go to Releases', '⌘4'],
    ['Go to Roadmap', '⌘5'],
    ['Go to Handoffs', '⌘6']
  ]) {
    const option = screen.getByRole('option', { name: new RegExp(title) })
    expect(option.textContent).toContain(shortcut)
  }
})

test('lists every registry command even when its handler is unavailable here', () => {
  render(<Harness />)

  for (const command of COMMANDS) {
    expect(screen.getByTestId(`palette-command:${command.id}`)).toBeTruthy()
  }
})

beforeEach(() => {
  app.commandPaletteOpen = true
  app.closeCommandPalette.mockReset()
})

afterEach(cleanup)

test('warns on a conflict, moves the chord on confirmation, and restores the default', () => {
  render(<Harness />)
  const filter = screen.getByRole('textbox', { name: 'Filter commands' })
  fireEvent.change(filter, { target: { value: 'Pin beside' } })

  fireEvent.keyDown(filter, { key: '<', code: 'Comma', metaKey: true, shiftKey: true })
  fireEvent.keyDown(filter, { key: 'p', metaKey: true, shiftKey: true })

  expect(screen.getByRole('alert').textContent).toContain('Command palette')
  fireEvent.keyDown(filter, { key: 'y', code: 'KeyY' })
  expect(screen.getByLabelText('Overrides').textContent).toBe(
    JSON.stringify({ 'app.command-palette': '', 'window.toggle-pin': 'Mod+Shift+P' })
  )

  fireEvent.keyDown(filter, { key: '<', code: 'Comma', metaKey: true, shiftKey: true })
  fireEvent.keyDown(filter, { key: 'Backspace', metaKey: true })
  expect(screen.getByLabelText('Overrides').textContent).toBe(
    JSON.stringify({ 'app.command-palette': '' })
  )
})

test('running rebind from the list keeps capture visible and closing disarms it', () => {
  const rendered = render(<Harness />)
  const filter = screen.getByRole('textbox', { name: 'Filter commands' })
  fireEvent.change(filter, { target: { value: 'Rebind the highlighted command' } })
  fireEvent.click(screen.getByRole('option', { name: /Rebind the highlighted command/i }))

  expect(screen.getByText('Press the new chord…')).toBeTruthy()
  expect(app.closeCommandPalette).not.toHaveBeenCalled()
  app.commandPaletteOpen = false
  rendered.rerender(<Harness />)
  const comment = document.createElement('input')
  document.body.append(comment)
  fireEvent.keyDown(comment, { key: 'x', code: 'KeyX' })

  expect(screen.getByLabelText('Overrides').textContent).toBe('{}')
})

test('a hidden multi-owner conflict names and unbinds every owner on confirmation', () => {
  render(<Harness />)
  const filter = screen.getByRole('textbox', { name: 'Filter commands' })
  fireEvent.change(filter, { target: { value: 'Pin beside' } })
  fireEvent.keyDown(filter, { key: '<', code: 'Comma', metaKey: true, shiftKey: true })
  fireEvent.keyDown(filter, { key: 'F', code: 'KeyF', shiftKey: true })

  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain('Finish the run')
  expect(alert.textContent).toContain('Finish the review')
  fireEvent.keyDown(filter, { key: 'y', code: 'KeyY' })
  expect(screen.getByLabelText('Overrides').textContent).toBe(
    JSON.stringify({ 'run.finish': '', 'review.finish': '', 'window.toggle-pin': 'Shift+F' })
  )
})

test('a shared Enter binding can be moved with the fixed capture confirmation key', () => {
  render(<Harness />)
  const filter = screen.getByRole('textbox', { name: 'Filter commands' })
  fireEvent.change(filter, { target: { value: 'Pin beside' } })
  fireEvent.keyDown(filter, { key: '<', code: 'Comma', metaKey: true, shiftKey: true })
  fireEvent.keyDown(filter, { key: 'Enter', code: 'Enter' })
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain('Y')
  expect(alert.textContent).toContain('Esc')
  fireEvent.keyDown(filter, { key: 'y', code: 'KeyY' })

  fireEvent.keyDown(filter, { key: 'Enter', code: 'Enter' })

  const overrides = JSON.parse(screen.getByLabelText('Overrides').textContent ?? '{}') as Record<
    string,
    string
  >
  expect(overrides['window.toggle-pin']).toBe('Enter')
  expect(overrides['find.next']).toBe('')
  expect(overrides['palette.run']).toBe('')
})

test('a conflict can be confirmed by mouse after Enter itself is rebound', () => {
  render(<Harness />)
  const filter = screen.getByRole('textbox', { name: 'Filter commands' })
  fireEvent.change(filter, { target: { value: 'Pin beside' } })
  fireEvent.keyDown(filter, { key: '<', code: 'Comma', metaKey: true, shiftKey: true })
  fireEvent.keyDown(filter, { key: 'Enter', code: 'Enter' })

  fireEvent.click(screen.getByRole('button', { name: 'Move binding' }))

  const overrides = JSON.parse(screen.getByLabelText('Overrides').textContent ?? '{}') as Record<
    string,
    string
  >
  expect(overrides['window.toggle-pin']).toBe('Enter')
  expect(overrides['palette.run']).toBe('')
})

test('Escape cancels a conflict inside capture mode regardless of registry bindings', () => {
  render(<Harness />)
  const filter = screen.getByRole('textbox', { name: 'Filter commands' })
  fireEvent.change(filter, { target: { value: 'Pin beside' } })
  fireEvent.keyDown(filter, { key: '<', code: 'Comma', metaKey: true, shiftKey: true })
  fireEvent.keyDown(filter, { key: 'Enter', code: 'Enter' })

  fireEvent.keyDown(filter, { key: 'Escape', code: 'Escape' })

  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByLabelText('Overrides').textContent).toBe('{}')
})

test('the conflict footer advertises only the controls that remain live', () => {
  const rendered = render(<Harness />)
  const filter = screen.getByRole('textbox', { name: 'Filter commands' })
  fireEvent.change(filter, { target: { value: 'Pin beside' } })
  fireEvent.keyDown(filter, { key: '<', code: 'Comma', metaKey: true, shiftKey: true })
  fireEvent.keyDown(filter, { key: 'p', metaKey: true, shiftKey: true })

  const footer = rendered.container.querySelector('.ckfoot')
  expect(footer?.textContent).toContain('Y')
  expect(footer?.textContent).toContain('confirm')
  expect(footer?.textContent).toContain('Esc')
  expect(footer?.textContent).toContain('cancel')
  expect(within(footer as HTMLElement).getByRole('button', { name: 'Move binding' })).toBeTruthy()
  expect(footer?.textContent).not.toContain('unbind')
  expect(footer?.textContent).not.toContain('restore default')
})
