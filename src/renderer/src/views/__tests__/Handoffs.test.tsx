import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Handoff } from '../../../../main/qa/handoffs'
import type { QaSnapshot } from '../../../../shared/ipc'

const navigate = vi.fn()
const showToast = vi.fn()
const copyHandoffPrompt = vi.fn()
const archiveHandoff = vi.fn()
const revealHandoff = vi.fn()
const unarchiveHandoff = vi.fn()

function handoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    path: '/record/rivermill/handoffs/2026-07-30-example-handoff.md',
    file: '2026-07-30-example-handoff.md',
    title: 'Rivermill — continue the clean reading view',
    domain: 'utilities',
    repo: 'apps/rivermill',
    project: 'rivermill',
    move: 'agent',
    state: 'live',
    updated: '2026-07-30T11:59:30.000Z',
    resume: 'Build the visible reading pane.',
    bodyMarkdown: '# Rivermill handoff\n\nThe next agent starts here.',
    raw: '# Rivermill handoff\n\nThe next agent starts here.',
    relaunchPrompt:
      'Continue the Rivermill — continue the clean reading view thread.\n\nRead ~/Documents/Dev Traffic Control/rivermill/handoffs/2026-07-30-example-handoff.md and pick up from where it leaves off.',
    sidecar: { pickedUpAt: null, archivedAt: null },
    history: { kind: 'never-picked-up' },
    ageDays: 0,
    stale: false,
    frontmatterMalformed: false,
    ...overrides
  }
}

const snapshot = {
  root: '/record',
  rootMissing: false,
  runs: [],
  notes: [],
  entries: [],
  threads: [],
  handoffs: [
    handoff(),
    handoff({
      path: '/record/rivermill/handoffs/2026-07-29-second-handoff.md',
      file: '2026-07-29-second-handoff.md',
      title: 'Rivermill — collect the installed build',
      move: 'me',
      updated: '2026-07-30T09:00:00.000Z',
      relaunchPrompt:
        'Continue the Rivermill — collect the installed build thread.\n\nRead ~/Documents/Dev Traffic Control/rivermill/handoffs/2026-07-29-second-handoff.md and pick up from where it leaves off.'
    }),
    handoff({
      path: '/record/tangram/handoffs/2026-07-28-old-handoff.md',
      file: '2026-07-28-old-handoff.md',
      project: 'tangram',
      title: 'Tangram — previous layout direction',
      state: 'superseded',
      updated: '2026-07-28T09:00:00.000Z',
      relaunchPrompt:
        'Continue the Tangram — previous layout direction thread.\n\nRead ~/Documents/Dev Traffic Control/tangram/handoffs/2026-07-28-old-handoff.md and pick up from where it leaves off.'
    })
  ],
  projects: ['rivermill', 'tangram'],
  scannedAt: '2026-07-30T12:00:00.000Z'
} as unknown as QaSnapshot

vi.mock('../../state/app', () => ({
  useApp: () => ({
    snapshot,
    navigate,
    helpOpen: false,
    switcherOpen: false,
    showToast,
    scope: { kind: 'all' } as const,
    setScope: vi.fn()
  })
}))

import { Handoffs } from '../Handoffs'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'))
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: {
      copyHandoffPrompt,
      archiveHandoff,
      revealHandoff,
      unarchiveHandoff
    }
  })
  unarchiveHandoff.mockResolvedValue({ pickedUpAt: null, archivedAt: null })
  copyHandoffPrompt.mockResolvedValue({
    pickedUpAt: '2026-07-30T12:00:00.000Z',
    archivedAt: null
  })
  archiveHandoff.mockResolvedValue({
    pickedUpAt: null,
    archivedAt: '2026-07-30T12:00:00.000Z'
  })
  revealHandoff.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('states counts, history and age without inventing prose', () => {
  const { container } = render(<Handoffs />)

  expect([...container.querySelectorAll('.ho-count-unit')].map((unit) => unit.textContent)).toEqual(
    ['3 total', '1 ready for an agent', '1 waiting on you', '1 superseded']
  )
  expect(container.querySelector('.ho-counts .status-ready')?.textContent).toBe(
    '1 ready for an agent'
  )
  expect(container.querySelector('.ho-counts .status-waiting')?.textContent).toBe(
    '1 waiting on you'
  )
  expect(container.querySelector('.ho-counts .status-inactive')?.textContent).toBe('1 superseded')
  // All three sample handoffs were updated today, so all three print a time.
  expect(screen.getAllByText(/^updated \d\d:\d\d$/)).toHaveLength(3)
  expect(screen.queryByText('updated now ago')).toBeNull()
  expect(screen.getAllByText('never picked up').length).toBeGreaterThan(0)
  expect(
    screen.getByText(/Continue the Rivermill — continue the clean reading view thread/)
  ).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Rivermill handoff' })).toBeNull()
})

test('summary and filters remain complete wrap units at narrow widths', () => {
  const { container } = render(<Handoffs />)

  expect(container.querySelectorAll('.ho-count-unit')).toHaveLength(4)
  expect(container.querySelectorAll('.ho-count-sep')).toHaveLength(0)
  expect(container.querySelectorAll('.ho-filter-chip')).toHaveLength(4)
  expect(container.querySelector('.ho-filter-chip.status-inactive')?.textContent).toBe(
    'Superseded 1'
  )
})

test('Copy and Archive use the app-owned sidecar bridge', async () => {
  render(<Handoffs />)

  fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))
  await waitFor(() =>
    expect(copyHandoffPrompt).toHaveBeenCalledWith(
      '/record/rivermill/handoffs/2026-07-30-example-handoff.md'
    )
  )
  expect(showToast).toHaveBeenCalledWith('Prompt copied · marked picked up')

  fireEvent.click(screen.getByRole('button', { name: 'Archive handoff' }))
  await waitFor(() =>
    expect(archiveHandoff).toHaveBeenCalledWith(
      '/record/rivermill/handoffs/2026-07-30-example-handoff.md'
    )
  )
  expect(showToast).toHaveBeenCalledWith('Handoff archived · the document is unchanged')
})

test('a refused Copy or Archive (main returns null) shows the failure, never a false success', async () => {
  copyHandoffPrompt.mockResolvedValue(null)
  archiveHandoff.mockResolvedValue(null)
  render(<Handoffs />)

  fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not copy the prompt'))
  expect(showToast).not.toHaveBeenCalledWith('Prompt copied · marked picked up')

  fireEvent.click(screen.getByRole('button', { name: 'Archive handoff' }))
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not archive the handoff'))
  expect(showToast).not.toHaveBeenCalledWith('Handoff archived · the document is unchanged')
})

test('a refused reveal (main returns false) says it could not show the file', async () => {
  render(<Handoffs />)
  fireEvent.click(screen.getByRole('button', { name: 'Show handoff file' }))
  await waitFor(() => expect(revealHandoff).toHaveBeenCalled())
  expect(showToast).not.toHaveBeenCalledWith('Could not show the handoff file')

  revealHandoff.mockResolvedValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Show handoff file' }))
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not show the handoff file'))
})

test('every handoff row exposes its own keyboard-focusable Copy action', async () => {
  const { container } = render(<Handoffs />)

  const copyButtons = screen.getAllByRole('button', { name: /^Copy .* prompt$/ })
  expect(copyButtons).toHaveLength(snapshot.handoffs.length)
  expect(copyButtons[0].getAttribute('tabindex')).not.toBe('-1')

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Copy Rivermill — collect the installed build prompt'
    })
  )

  await waitFor(() =>
    expect(copyHandoffPrompt).toHaveBeenCalledWith(
      '/record/rivermill/handoffs/2026-07-29-second-handoff.md'
    )
  )
  expect(container.querySelector('.ho-split')?.classList.contains('detail-open')).toBe(false)
})

test('every handoff row exposes its own Archive action', async () => {
  const { container } = render(<Handoffs />)

  const archiveButtons = screen.getAllByRole('button', { name: /^Archive .* handoff$/ })
  expect(archiveButtons).toHaveLength(snapshot.handoffs.length)
  expect(archiveButtons[0].getAttribute('tabindex')).not.toBe('-1')

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Archive Rivermill — collect the installed build handoff'
    })
  )

  await waitFor(() =>
    expect(archiveHandoff).toHaveBeenCalledWith(
      '/record/rivermill/handoffs/2026-07-29-second-handoff.md'
    )
  )
  expect(container.querySelector('.ho-split')?.classList.contains('detail-open')).toBe(false)
})

test('selecting a handoff opens a full-width narrow detail state with a keyboard back path', () => {
  const { container } = render(<Handoffs />)

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Open Rivermill — collect the installed build'
    })
  )

  expect(container.querySelector('.ho-split')?.classList.contains('detail-open')).toBe(true)
  expect(screen.getByRole('button', { name: 'Back to handoffs' })).toBeTruthy()

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(container.querySelector('.ho-split')?.classList.contains('detail-open')).toBe(false)
})

test('handoff states and history use the shared filled status pills', () => {
  const { container } = render(<Handoffs />)

  expect(container.querySelectorAll('.ho-row .status-text')).toHaveLength(0)
  expect(container.querySelector('.ho-row .status-chip.status-ready')?.textContent).toBe(
    'Ready for an agent'
  )
  expect(container.querySelector('.ho-row .status-chip.status-waiting')?.textContent).toBe(
    'Waiting on you'
  )
  expect(container.querySelector('.ho-row .ho-history.status-inactive')?.textContent).toBe(
    'never picked up'
  )
})

test('the main row actions have direct keyboard paths', async () => {
  render(<Handoffs />)

  fireEvent.keyDown(window, { key: 'ArrowDown' })
  fireEvent.keyDown(window, { key: 'c' })

  await waitFor(() =>
    expect(copyHandoffPrompt).toHaveBeenCalledWith(
      '/record/rivermill/handoffs/2026-07-29-second-handoff.md'
    )
  )
})

// An archived handoff comes back from the same button.
test('an archived handoff offers Restore, which restores it through the sidecar bridge', async () => {
  const original = snapshot.handoffs[0]
  snapshot.handoffs[0] = handoff({ history: { kind: 'archived', at: '2026-07-30T10:00:00.000Z' } })
  try {
    render(<Handoffs />)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Restore Rivermill — continue the clean reading view handoff'
      })
    )
    await waitFor(() =>
      expect(unarchiveHandoff).toHaveBeenCalledWith(
        '/record/rivermill/handoffs/2026-07-30-example-handoff.md'
      )
    )
    expect(archiveHandoff).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Handoff restored · it counts as ready again')
  } finally {
    snapshot.handoffs[0] = original
  }
})
