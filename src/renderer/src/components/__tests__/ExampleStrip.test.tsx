import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const app = vi.hoisted(() => ({
  snapshot: { scannedAt: '2026-09-30T10:00:00.000Z' },
  goHome: vi.fn(),
  showToast: vi.fn(),
  navigate: vi.fn()
}))

vi.mock('../../state/app', () => ({ useApp: () => app }))

import { ExampleStrip } from '../ExampleStrip'
import { NothingYetEmpty } from '../NothingYet'
import { nothingFiledYet } from '../../lib/getStarted'

const examplePresent = vi.fn()
const removeExample = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: { examplePresent, removeExample }
  })
})

afterEach(cleanup)

test('the strip shows on the example only while main finds its marker', async () => {
  examplePresent.mockResolvedValue(true)
  render(<ExampleStrip slug="example-app" />)
  await screen.findByText('This is the example project.')
  expect(screen.getByRole('button', { name: 'Remove example' })).toBeTruthy()
  cleanup()

  examplePresent.mockResolvedValue(false)
  const { container } = render(<ExampleStrip slug="example-app" />)
  await waitFor(() => expect(examplePresent).toHaveBeenCalledTimes(2))
  expect(container.textContent).toBe('')
})

test('no other project asks or shows anything', () => {
  const { container } = render(<ExampleStrip slug="my-app" />)
  expect(container.textContent).toBe('')
  expect(examplePresent).not.toHaveBeenCalled()
})

test('Remove example asks inside the app, and Cancel removes nothing', async () => {
  examplePresent.mockResolvedValue(true)
  const confirm = vi.spyOn(window, 'confirm')
  render(<ExampleStrip slug="example-app" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove example' }))

  expect(screen.getByRole('alertdialog', { name: 'Remove the example project' })).toBeTruthy()
  expect(confirm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(removeExample).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Remove example' })).toBeTruthy()
})

test('confirming removes through main and returns to the DTC Dash', async () => {
  examplePresent.mockResolvedValue(true)
  removeExample.mockResolvedValue({ kind: 'removed' })
  render(<ExampleStrip slug="example-app" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove example' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(app.goHome).toHaveBeenCalledTimes(1))
  expect(removeExample).toHaveBeenCalledWith()
  expect(app.showToast).toHaveBeenCalledWith('Example project removed')
})

test('a refused removal stays put and says why', async () => {
  examplePresent.mockResolvedValue(true)
  removeExample.mockResolvedValue({ kind: 'refused', reason: 'not-example' })
  render(<ExampleStrip slug="example-app" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove example' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(app.showToast).toHaveBeenCalled())
  expect(app.goHome).not.toHaveBeenCalled()
})

test('the empty Inbox points to Get started only when nothing was ever filed', () => {
  expect(nothingFiledYet(null)).toBe(false)
  expect(nothingFiledYet({ runs: [] })).toBe(true)
  expect(nothingFiledYet({ runs: [{}] } as never)).toBe(false)

  render(<NothingYetEmpty />)
  expect(screen.getByRole('heading', { name: 'Nothing yet' })).toBeTruthy()
  expect(
    screen.getByText('Your agents have not filed anything. See Get started to connect them.')
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'get-started' })
})
