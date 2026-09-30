import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const app = vi.hoisted(() => ({
  snapshot: { root: '/Users/someone/Documents/Dev Traffic Control' } as { root: string } | null,
  settings: null,
  openProject: vi.fn(),
  showToast: vi.fn(),
  navigate: vi.fn()
}))

vi.mock('../../state/app', () => ({ useApp: () => app }))

import { GetStarted } from '../GetStarted'
import { INSTALL_LINE, SKILL_URL, setupLine } from '../../lib/getStarted'

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
const openExample = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  app.snapshot = { root: '/Users/someone/Documents/Dev Traffic Control' }
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Object.defineProperty(window, 'qa', { configurable: true, value: { openExample } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('the page shows the three steps and what agents can send', () => {
  render(<GetStarted />)
  for (const heading of [
    'Connect your agents',
    'Install the dev-traffic-control skill',
    'Tell your agent where to write',
    'Or look around first',
    'What agents can send you',
    'Check request',
    'Design review',
    'Handoff'
  ]) {
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
  }
  const link = screen.getByRole('link', { name: /dominiks-agent-skills/ })
  expect(link.getAttribute('href')).toBe(
    'https://github.com/techczech/dominiks-agent-skills/tree/main/dev/dev-traffic-control'
  )
  expect(link.getAttribute('href')).toBe(SKILL_URL)
  expect(screen.getByText(INSTALL_LINE)).toBeTruthy()
})

test('the setup line names the configured records folder, shortened with ~', () => {
  expect(setupLine('/Users/someone/work/records')).toBe(
    'Use the dev-traffic-control skill. My records folder is ~/work/records. ' +
      'When you want me to test or review something, file it there and give me the dtc:// link.'
  )
  app.snapshot = { root: '/Users/someone/work/records' }
  render(<GetStarted />)
  expect(screen.getByText(/My records folder is ~\/work\/records\./)).toBeTruthy()
})

test('each Copy button puts its exact line on the clipboard and says Copied briefly', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  render(<GetStarted />)

  fireEvent.click(screen.getByRole('button', { name: 'Copy the install line' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(INSTALL_LINE))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Copy the install line' }).textContent).toBe('Copied')
  )

  fireEvent.click(screen.getByRole('button', { name: 'Copy the setup line' }))
  await waitFor(() =>
    expect(writeText).toHaveBeenLastCalledWith(
      setupLine('/Users/someone/Documents/Dev Traffic Control')
    )
  )

  await act(async () => {
    vi.advanceTimersByTime(2000)
  })
  expect(screen.getByRole('button', { name: 'Copy the install line' }).textContent).toBe('Copy')
})

test('Open the example project opens its Project Dash once main has copied it', async () => {
  openExample.mockResolvedValue({ kind: 'installed', slug: 'example-app' })
  render(<GetStarted />)
  fireEvent.click(screen.getByRole('button', { name: 'Open the example project' }))
  await waitFor(() => expect(app.openProject).toHaveBeenCalledWith('example-app'))
  expect(openExample).toHaveBeenCalledWith()
})

test('a refused example says why and opens nothing', async () => {
  openExample.mockResolvedValue({ kind: 'refused', reason: 'folder-exists' })
  render(<GetStarted />)
  fireEvent.click(screen.getByRole('button', { name: 'Open the example project' }))
  await waitFor(() =>
    expect(app.showToast).toHaveBeenCalledWith(
      'Your records folder already has a folder called example-app, so the example was not added.'
    )
  )
  expect(app.openProject).not.toHaveBeenCalled()
})
