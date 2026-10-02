import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PoolIdea } from '../../../../main/qa/pool'
import type { QaSnapshot } from '../../../../shared/ipc'

/**
 * Ticket 38. The Feature requests tab lists what he said by what became of it,
 * opens a request as the card, and writes his answer back through the existing
 * roadmap idea write (`writePoolIdea`, action `edit`) as a reviewer entry.
 */

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  scope: { kind: 'project', slug: 'app' } as { kind: string; slug?: string },
  view: { kind: 'requests' } as { kind: string; idea?: string; project?: string },
  navigate: vi.fn(),
  setScope: vi.fn(),
  showToast: vi.fn(),
  markSeen: vi.fn(),
  helpOpen: false,
  switcherOpen: false,
  housekeeping: undefined
}))
vi.mock('../../state/app', () => ({ useApp: () => app }))

import { FeatureRequests } from '../FeatureRequests'
import { CommandProvider } from '../../commands/provider'

const writePoolIdea = vi.fn()

function idea(
  id: string,
  request: Record<string, unknown>,
  extra: Partial<PoolIdea> = {}
): PoolIdea {
  return {
    id,
    title: `Title ${id}`,
    tier: 'functionality',
    added: '2026-09-29',
    bodyMarkdown: 'The longer story.',
    state: 'pool',
    path: `/r/app/roadmap/${id}.md`,
    position: 1,
    isNew: false,
    request: {
      by: 'reviewer',
      said: [{ where: 'a review', when: '2026-09-29', link: '' }],
      quotes: [`words of ${id}`],
      related: [],
      ...request
    },
    ...extra
  } as PoolIdea
}

function snapshot(ideas: PoolIdea[]): QaSnapshot {
  return {
    root: '/r',
    scannedAt: '2026-10-01T10:00:00Z',
    projects: ['app'],
    runs: [],
    notes: [],
    threads: [],
    entries: [],
    handoffs: [],
    // 0.22.0 is in flight, so the pending release is 0.23.0.
    releases: [
      {
        kind: 'recorded',
        project: 'app',
        record: {},
        versions: [{ version: '0.22.0', record: {} }],
        inFlightVersion: '0.22.0'
      }
    ],
    pools: [{ project: 'app', directory: '/r/app/roadmap', ideas, degradedOrder: false }]
  } as unknown as QaSnapshot
}

beforeEach(() => {
  app.navigate.mockReset()
  app.showToast.mockReset()
  app.scope = { kind: 'project', slug: 'app' }
  app.view = { kind: 'requests' }
  writePoolIdea.mockReset()
  Object.defineProperty(window, 'qa', {
    value: { writePoolIdea },
    configurable: true,
    writable: true
  })
  app.snapshot = snapshot([
    idea('wait', { fate: 'waiting', plan: 'Do the thing', context: 'Why it came up' }),
    idea('owed', {}),
    idea(
      'plan',
      { fate: 'planned', plan: 'Later', related: ['wait', 'ticket-9'] },
      {
        candidateRelease: '0.23.0'
      }
    ),
    idea('done', { fate: 'built', plan: 'Done' })
  ])
})
afterEach(cleanup)

function renderTab(): void {
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <FeatureRequests />
    </CommandProvider>
  )
}

test('groups by fate, with the banner counting what has no plan and Finished folded', () => {
  renderTab()
  const headers = [...document.querySelectorAll('.roadmap-lane-header strong')].map(
    (node) => node.textContent
  )
  expect(headers).toEqual(['Waiting on you', 'No plan yet', 'On the roadmap', 'Finished'])
  expect(screen.getByRole('status').textContent).toContain(
    '1 without a plan: the agent owes these.'
  )
  expect(screen.queryByText('Title done')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Finished/, expanded: false }))
  expect(screen.getByText('Title done')).toBeTruthy()
})

test('a request with no plan says the agent owes one', () => {
  renderTab()
  const row = document.querySelector('[data-request-row="app/owed"]')!
  expect(row.textContent).toContain('No plan recorded. The agent owes you one.')
  expect(row.querySelector('.fate.none')?.textContent).toBe('No plan yet')
})

test('a waiting request opens as the card with its fate buttons', () => {
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: 'Title wait' }))
  const card = screen.getByRole('article', { name: 'Title wait' })
  expect(within(card).getByText('You asked for')).toBeTruthy()
  expect(within(card).getByText('“words of wait”')).toBeTruthy()
  expect(within(card).getByText('Why it came up')).toBeTruthy()
  expect(within(card).getByText('Do the thing')).toBeTruthy()
  expect(
    within(card)
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => ['Approve → Roadmap', 'Change it', 'Not now'].includes(text ?? ''))
  ).toEqual(['Approve → Roadmap', 'Change it', 'Not now'])
  // The plan names the pending release it would go into.
  expect(within(card).getByText('0.23.0 · pending')).toBeTruthy()
})

  // Every row opens its card, including rows with no answer buttons.
test('every row, Finished and No plan yet included, has an Open button that opens its card', () => {
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: /Finished/, expanded: false }))
  const rows = [...document.querySelectorAll('[data-request-row]')]
  expect(rows).toHaveLength(4)
  for (const row of rows) expect(within(row as HTMLElement).getByText('Open')).toBeTruthy()
  fireEvent.click(
    within(document.querySelector('[data-request-row="app/done"]')!).getByText('Open')
  )
  expect(screen.getByRole('article', { name: 'Title done' })).toBeTruthy()
  cleanup()
  renderTab()
  fireEvent.click(
    within(document.querySelector('[data-request-row="app/owed"]')!).getByText('Open')
  )
  expect(screen.getByRole('article', { name: 'Title owed' })).toBeTruthy()
})

test('Approve → Roadmap sets fate planned and the pending candidate, with his entry, through the idea edit', async () => {
  writePoolIdea.mockResolvedValue({ pool: app.snapshot!.pools[0], id: 'wait' })
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: 'Title wait' }))
  fireEvent.click(screen.getByRole('button', { name: 'Approve → Roadmap' }))
  await waitFor(() => expect(writePoolIdea).toHaveBeenCalledTimes(1))
  const input = writePoolIdea.mock.calls[0][0]
  expect(input).toMatchObject({
    project: 'app',
    action: 'edit',
    id: 'wait',
    fate: 'planned',
    candidate: '0.23.0'
  })
  expect(Object.keys(input).sort()).toEqual([
    'action',
    'appendEntry',
    'candidate',
    'fate',
    'id',
    'project'
  ])
  expect(input.appendEntry).toMatch(
    /^## Reviewer entry · \d{4}-\d{2}-\d{2} · Approved for the roadmap$/
  )
})

test('a request on the roadmap opens the Roadmap, or comes off it back to waiting', async () => {
  writePoolIdea.mockResolvedValue({ pool: app.snapshot!.pools[0], id: 'plan' })
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: 'Title plan' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open on the Roadmap' }))
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'roadmap' })
  expect(writePoolIdea).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Take it off the roadmap' }))
  await waitFor(() => expect(writePoolIdea).toHaveBeenCalledTimes(1))
  expect(writePoolIdea.mock.calls[0][0]).toMatchObject({ fate: 'waiting', candidate: null })
})

test('Ask an agent to plan this and Review all requests copy their prompts', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: 'Review all requests' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  expect(writeText.mock.calls[0][0]).toContain('in the project app')
  expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining('Copied'))
  fireEvent.click(screen.getByRole('button', { name: 'Title owed' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask an agent to plan this' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
  expect(writeText.mock.calls[1][0]).toContain('dtc://open/app/roadmap/owed.md')
})

test('Change it asks for words first, and sends them under the heading', async () => {
  writePoolIdea.mockResolvedValue({ pool: app.snapshot!.pools[0], id: 'wait' })
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: 'Title wait' }))
  fireEvent.click(screen.getByRole('button', { name: 'Change it' }))
  expect(writePoolIdea).not.toHaveBeenCalled()
  const send = screen.getByRole('button', { name: 'Send to the agent' }) as HTMLButtonElement
  expect(send.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('What should change?'), {
    target: { value: 'Make it a tab.' }
  })
  fireEvent.click(send)
  await waitFor(() => expect(writePoolIdea).toHaveBeenCalled())
  expect(writePoolIdea.mock.calls[0][0].appendEntry).toMatch(
    /## Reviewer entry · \S+ · Wants the plan changed\n\nMake it a tab\.$/
  )
})

test('a planned request offers Open on the Roadmap and Take it off, and says where it sits', () => {
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: 'Title plan' }))
  const card = screen.getByRole('article', { name: 'Title plan' })
  expect(
    within(card)
      .getAllByRole('button')
      .map((button) => button.textContent)
  ).toEqual(expect.arrayContaining(['Open on the Roadmap', 'Take it off the roadmap']))
  expect(card.textContent).toContain('On the roadmap in')
  expect(card.querySelector('.fate.planned')?.textContent).toBe('On the roadmap · 0.23.0 (pending)')
})

test('Related chips resolve to the record with its state; an unknown name stays plain', () => {
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: 'Title plan' }))
  const card = screen.getByRole('article', { name: 'Title plan' })
  const chip = within(card).getByRole('button', { name: /Title wait/ })
  expect(chip.textContent).toContain('Waiting on you')
  expect(within(card).getByText('ticket-9')).toBeTruthy()
  fireEvent.click(chip)
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'requests', project: 'app', idea: 'wait' })
})

test('under All projects the rows carry their project', () => {
  app.scope = { kind: 'all' }
  renderTab()
  expect(document.querySelector('[data-request-row="app/wait"] .t em')?.textContent).toBe('app · ')
})

test('nothing filed yet says how a request gets here', () => {
  app.snapshot = snapshot([])
  renderTab()
  expect(screen.getByText('No feature requests yet.')).toBeTruthy()
})
