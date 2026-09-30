import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test } from 'vitest'
import { CommandProvider, useCommandScope, useCommands } from '../provider'

function Probe(): React.JSX.Element {
  const [calls, setCalls] = useState(0)
  useCommandScope({ 'app.cheat-sheet': () => setCalls((value) => value + 1) })
  return <input aria-label="Comment" data-calls={String(calls)} />
}

function EnabledProbe({ enabled }: { enabled: boolean }): React.JSX.Element {
  useCommandScope({ 'window.toggle-pin': { enabled, handler: () => {} } })
  return <PaletteAvailability />
}

function PaletteAvailability(): React.JSX.Element {
  const commands = useCommands()
  return (
    <output>
      {commands.available().some((entry) => entry.id === 'window.toggle-pin') ? 'yes' : 'no'}
    </output>
  )
}

afterEach(cleanup)

test('Mod+/ opens the cheat sheet while focus is in a text field', () => {
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <Probe />
    </CommandProvider>
  )
  const input = screen.getByRole('textbox', { name: 'Comment' })
  input.focus()
  fireEvent.keyDown(input, { key: '/', metaKey: true })
  expect(input.dataset.calls).toBe('1')
})

test('the secondary ? trigger works outside text fields but stays quiet while typing', () => {
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <Probe />
    </CommandProvider>
  )
  const input = screen.getByRole('textbox', { name: 'Comment' })
  input.focus()
  fireEvent.keyDown(input, { key: '?', code: 'Slash', shiftKey: true })
  expect(input.dataset.calls).toBe('0')

  input.blur()
  fireEvent.keyDown(document.body, { key: '?', code: 'Slash', shiftKey: true })
  expect(input.dataset.calls).toBe('1')
})

test('enabled flips bump provider revision so command availability re-renders', () => {
  const { rerender } = render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <EnabledProbe enabled={false} />
    </CommandProvider>
  )
  expect(screen.getByText('no')).toBeTruthy()

  rerender(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <EnabledProbe enabled />
    </CommandProvider>
  )
  expect(screen.getByText('yes')).toBeTruthy()
})
