import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const app = vi.hoisted(() => ({
  snapshot: null,
  openProject: vi.fn(),
  dismissLinkArrival: vi.fn(),
  retryLinkArrival: vi.fn(),
  linkRetryInFlight: false
}))
vi.mock('../../state/app', () => ({ useApp: () => app }))

import { LinkArrivalTakeover } from '../LinkArrival'
import { inertLinkText } from '../../../../shared/deepLink'

afterEach(cleanup)

/**
 * The refusal page shows the refused link back — as text. A hostile
 * page fires these links, so the text must never become something to click,
 * and must not read differently on screen from what it is.
 */

function refusal(url: string): HTMLElement {
  const { container } = render(
    <LinkArrivalTakeover arrival={{ kind: 'refused', url, coldLaunch: false }} />
  )
  return container
}

test('the refused link is shown as monospace text with a Copy button and the hint', () => {
  const url = 'dtc://open/../../../../Users/someone/.ssh/id_ed25519'
  const container = refusal(url)
  const code = container.querySelector('code.refused-link-text')
  expect(code?.textContent).toBe(url)
  expect(screen.getByText('Send this to the agent that gave it to you.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Close and carry on/ })).toBeTruthy()
})

test('it is never a link: no anchor, no href, no element but the text node', () => {
  const url = 'dtc://open/x/<a href="https://evil.example">y</a><img src=x onerror=alert(1)>'
  const container = refusal(url)
  expect(container.querySelector('a')).toBeNull()
  expect(container.querySelector('[href]')).toBeNull()
  expect(container.querySelector('img')).toBeNull()
  const code = container.querySelector('code.refused-link-text') as HTMLElement
  expect(code.children).toHaveLength(0)
  expect(code.textContent).toBe(url)
})

test('control and bidirectional characters are stripped before it is shown', () => {
  const url = 'dtc://tangram/‮dm.exe‬\u0007x\u0000y​z⁦w⁩\u0085.md'
  const container = refusal(url)
  expect(container.querySelector('code.refused-link-text')?.textContent).toBe(
    'dtc://tangram/dm.exexyzw.md'
  )
})

test('a long link is cut to about 200 characters', () => {
  const url = `dtc://open/x/${'a'.repeat(5000)}`
  const container = refusal(url)
  const shown = container.querySelector('code.refused-link-text')?.textContent ?? ''
  expect(shown.length).toBe(201)
  expect(shown.endsWith('…')).toBe(true)
  expect(inertLinkText(url).copy.length).toBe(4096)
})

test('Copy copies the cleaned link, not anything it resolves to', async () => {
  const writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  refusal('dtc://tangram/../x‮')
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  expect(writeText).toHaveBeenCalledWith('dtc://tangram/../x')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
})

test('a refusal that arrived with no link shows the page without the link block', () => {
  const { container } = render(
    <LinkArrivalTakeover arrival={{ kind: 'refused', coldLaunch: false }} />
  )
  expect(container.querySelector('.refused-link')).toBeNull()
  expect(screen.getByRole('heading', { name: /outside your records/ })).toBeTruthy()
})
