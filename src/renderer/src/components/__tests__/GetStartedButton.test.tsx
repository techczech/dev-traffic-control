import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/**
 * Ticket 36. The title-bar button has three states (Get started, Remove example,
 * hidden) and main, not the snapshot, says whether the example's marker exists.
 */

const app = vi.hoisted(() => ({
  settings: { getStartedRetired: false } as { getStartedRetired: boolean } | null,
  scope: { kind: 'all' } as { kind: string; slug?: string },
  navigate: vi.fn(),
  goHome: vi.fn(),
  changeSetting: vi.fn(),
  showToast: vi.fn()
}))

vi.mock('../../state/app', () => ({ useApp: () => app }))

import { GetStartedButton } from '../GetStartedButton'
import { getStartedButtonState, resetExampleState } from '../../lib/exampleState'

const examplePresent = vi.fn()
const removeExample = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  resetExampleState()
  app.settings = { getStartedRetired: false }
  app.scope = { kind: 'all' }
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: { examplePresent, removeExample }
  })
})

afterEach(cleanup)

test('the state is a pure function of the retired flag and main’s answer', () => {
  expect(getStartedButtonState(false, false)).toBe('get-started')
  expect(getStartedButtonState(false, true)).toBe('remove-example')
  expect(getStartedButtonState(true, true)).toBe('hidden')
  expect(getStartedButtonState(true, false)).toBe('hidden')
  // Nothing is drawn until both settings and main have answered.
  expect(getStartedButtonState(undefined, true)).toBe('hidden')
  expect(getStartedButtonState(false, null)).toBe('hidden')
})

test('state 1: Get started opens the page while no example exists', async () => {
  examplePresent.mockResolvedValue(false)
  render(<GetStartedButton />)
  fireEvent.click(await screen.findByRole('button', { name: 'Get started' }))
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'get-started' })
})

test('state 2: the same button reads Remove example once main finds the marker', async () => {
  examplePresent.mockResolvedValue(true)
  render(<GetStartedButton />)
  await screen.findByRole('button', { name: 'Remove example' })
  expect(screen.queryByRole('button', { name: 'Get started' })).toBeNull()
})

test('state 3: a retired button never shows, and asks nothing visible', async () => {
  app.settings = { getStartedRetired: true }
  examplePresent.mockResolvedValue(false)
  const { container } = render(<GetStartedButton />)
  await waitFor(() => expect(examplePresent).toHaveBeenCalled())
  expect(container.textContent).toBe('')
})

test('main is asked again on window focus, so an example added outside the app shows', async () => {
  examplePresent.mockResolvedValue(false)
  render(<GetStartedButton />)
  await screen.findByRole('button', { name: 'Get started' })
  examplePresent.mockResolvedValue(true)
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
  await screen.findByRole('button', { name: 'Remove example' })
})

test('Remove example asks inside the app, and Cancel removes nothing', async () => {
  examplePresent.mockResolvedValue(true)
  const confirm = vi.spyOn(window, 'confirm')
  render(<GetStartedButton />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove example' }))
  expect(screen.getByRole('alertdialog', { name: 'Remove the example project' })).toBeTruthy()
  expect(confirm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(removeExample).not.toHaveBeenCalled()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(screen.getByRole('button', { name: 'Remove example' })).toBeTruthy()
})

test('confirming removes through main, retires the button and re-asks main', async () => {
  examplePresent.mockResolvedValue(true)
  removeExample.mockResolvedValue({ kind: 'removed' })
  render(<GetStartedButton />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove example' }))
  examplePresent.mockResolvedValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(app.changeSetting).toHaveBeenCalledWith('getStartedRetired', true))
  expect(removeExample).toHaveBeenCalledWith()
  expect(app.showToast).toHaveBeenCalledWith('Example project removed')
  // Not on the example, so the window stays where it is.
  expect(app.goHome).not.toHaveBeenCalled()
  // Retirement is a settings write; the mock does not apply it, so main's answer
  // is what flips the label off "Remove example".
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove example' })).toBeNull())
})

test('removing while looking at the example returns to the DTC Dash', async () => {
  app.scope = { kind: 'project', slug: 'example-app' }
  examplePresent.mockResolvedValue(true)
  removeExample.mockResolvedValue({ kind: 'removed' })
  render(<GetStartedButton />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove example' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(app.goHome).toHaveBeenCalledTimes(1))
})

test('a refused removal keeps the button, does not retire it and says why', async () => {
  examplePresent.mockResolvedValue(true)
  removeExample.mockResolvedValue({ kind: 'refused', reason: 'not-example' })
  render(<GetStartedButton />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove example' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(app.showToast).toHaveBeenCalled())
  expect(app.changeSetting).not.toHaveBeenCalled()
  expect(app.goHome).not.toHaveBeenCalled()
})
