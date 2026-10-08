import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CommandProvider, useCommands } from '../../commands/provider'
import { CollectPromptButton } from '../CollectPromptButton'

function CommandProbe(): React.JSX.Element {
  const commands = useCommands()
  return <output>{commands.canRun('run.copy-collect-prompt') ? 'available' : 'unavailable'}</output>
}

function renderButton(finished: boolean): ReturnType<typeof render> {
  return render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <CollectPromptButton
        requestPath="/records/dev-traffic-control/round/request.md"
        title="Multiple windows"
        finished={finished}
      />
      <CommandProbe />
    </CommandProvider>
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'qa', {
    configurable: true,
    writable: true,
    value: { copyCollectPrompt: vi.fn(async () => {}) } as unknown as Window['qa']
  })
})

afterEach(cleanup)

test('copies through the app bridge and follows the Handoffs Copy/Copied pattern', async () => {
  renderButton(true)

  await waitFor(() => expect(screen.getByText('available')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Copy collect prompt' }))

  await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
  expect(window.qa.copyCollectPrompt).toHaveBeenCalledWith(
    '/records/dev-traffic-control/round/request.md',
    'Multiple windows'
  )
})

test('renders no control and registers no command before the run is finished', async () => {
  renderButton(false)

  await waitFor(() => expect(screen.getByText('unavailable')).toBeTruthy())
  expect(screen.queryByRole('button', { name: 'Copy collect prompt' })).toBeNull()
})
