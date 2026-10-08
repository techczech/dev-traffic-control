import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'

const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()

const app = vi.hoisted(() => ({
  snapshot: null as unknown,
  housekeeping: undefined,
  archiveOld: vi.fn(),
  showToast: vi.fn()
}))

vi.mock('../../state/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/app')>()),
  useApp: () => app
}))

import { ArchiveOld } from '../ArchiveOld'

afterEach(() => {
  cleanup()
  app.archiveOld.mockReset()
  app.showToast.mockReset()
})

function record(): QaSnapshot {
  const run = (project: string, name: string, at: string) => ({
    project,
    status: 'waiting',
    request: { path: `/record/${project}/${name}.md` },
    requestMtime: at,
    report: null
  })
  return {
    root: '/record',
    projects: ['tangram', 'rivermill'],
    runs: [run('tangram', 'ten', ago(10)), run('rivermill', 'forty', ago(40))],
    threads: [{ id: 't-old', projects: ['rivermill'], state: 'open', move: 'me', lastAt: ago(20) }],
    handoffs: [],
    releases: []
  } as unknown as QaSnapshot
}

test('the reviewer picks the age, sees each count, and confirming archives exactly those items', async () => {
  app.snapshot = record()
  app.archiveOld.mockResolvedValue({ requests: 1, threads: 1, handoffs: 0 })
  render(<ArchiveOld scope={{ kind: 'all' }} />)

  fireEvent.click(screen.getByRole('button', { name: /Archive old/ }))
  const sheet = screen.getByRole('dialog', { name: 'Archive old items' })
  const ages = within(sheet).getAllByRole('radio')
  expect(ages).toHaveLength(3)
  expect(within(sheet).getByText('Older than 7 days').parentElement?.textContent).toContain(
    '3 items'
  )
  expect(within(sheet).getByText('Older than 14 days').parentElement?.textContent).toContain(
    '2 items'
  )
  expect(within(sheet).getByText('Older than 30 days').parentElement?.textContent).toContain(
    '1 item'
  )

  // 14 days is the starting choice.
  fireEvent.click(within(sheet).getByRole('button', { name: 'Archive 2 items' }))
  await waitFor(() => expect(app.archiveOld).toHaveBeenCalledTimes(1))
  expect(app.archiveOld).toHaveBeenCalledWith({
    requests: ['rivermill/forty.md'],
    threads: ['t-old'],
    handoffs: []
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining('Archived 2 old items'))
})

test('inside a project only that project is offered, and nothing old means nothing to confirm', () => {
  app.snapshot = record()
  render(<ArchiveOld scope={{ kind: 'project', slug: 'tangram' }} />)
  fireEvent.click(screen.getByRole('button', { name: /Archive old/ }))
  const sheet = screen.getByRole('dialog', { name: 'Archive old items' })
  expect(within(sheet).getByText('Older than 7 days').parentElement?.textContent).toContain(
    '1 item'
  )
  const confirm = within(sheet).getByRole('button', { name: 'Nothing that old' })
  expect((confirm as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(app.archiveOld).not.toHaveBeenCalled()
})
