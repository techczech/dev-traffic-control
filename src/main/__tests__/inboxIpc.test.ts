import { describe, expect, test, vi } from 'vitest'
import type { InboxState, OpenRunResult } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import {
  createInboxStateHandlers,
  type InboxStateSender,
  type InboxStateStoreLike
} from '../inboxIpc'

class FakeStore implements InboxStateStoreLike {
  private seen: string[] = []
  private archived: string[] = []

  get(): InboxState {
    return { seen: [...this.seen], archived: [...this.archived] }
  }

  markSeen(basename: string): void {
    if (!this.seen.includes(basename)) this.seen.push(basename)
  }

  archive(basename: string): void {
    if (!this.archived.includes(basename)) this.archived.push(basename)
  }

  unarchive(basename: string): void {
    this.archived = this.archived.filter((value) => value !== basename)
  }

  archiveMany(requests: readonly string[]): void {
    for (const key of requests) this.archive(key)
  }

  unarchiveThread(): void {}
}

function sender(destroyed = false): {
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn<(channel: string, state: InboxState) => void>>
} {
  return {
    isDestroyed: () => destroyed,
    send: vi.fn<(channel: string, state: InboxState) => void>()
  } satisfies InboxStateSender
}

const opened: OpenRunResult = {
  request: {
    id: 'request',
    title: 'Request',
    labels: {},
    mode: 'test',
    items: [],
    parked: [],
    degraded: false,
    raw: '',
    path: '/qa/project/2026-07-27-request.md'
  },
  report: {
    id: 'request',
    title: 'Request',
    startedAt: '2026-07-27T10:00:00.000Z',
    noteFiles: [],
    items: []
  },
  exists: false
}

describe('inbox-state IPC seam', () => {
  test('pushes authoritative state after openRun, markSeen, archive and unarchive', async () => {
    const store = new FakeStore()
    const openRun = vi.fn(async () => opened)
    const target = sender()
    const handlers = createInboxStateHandlers(store, openRun)

    await expect(handlers.openRun(target, '/qa/project/2026-07-27-request.md')).resolves.toBe(
      opened
    )
    handlers.markSeen(target, 'another-request')
    handlers.archive(target, 'archived-request')
    handlers.unarchive(target, 'archived-request')

    expect(openRun).toHaveBeenCalledWith('/qa/project/2026-07-27-request.md')
    expect(target.send).toHaveBeenCalledTimes(4)
    expect(target.send.mock.calls.map((call) => call[0])).toEqual([
      IPC.inboxStateChanged,
      IPC.inboxStateChanged,
      IPC.inboxStateChanged,
      IPC.inboxStateChanged
    ])
    expect(target.send.mock.calls.map((call) => call[1])).toEqual([
      { seen: ['2026-07-27-request'], archived: [] },
      { seen: ['2026-07-27-request', 'another-request'], archived: [] },
      {
        seen: ['2026-07-27-request', 'another-request'],
        archived: ['archived-request']
      },
      { seen: ['2026-07-27-request', 'another-request'], archived: [] }
    ])
  })

  test('does not send when the serialised state is unchanged', () => {
    const store = new FakeStore()
    const target = sender()
    const handlers = createInboxStateHandlers(
      store,
      vi.fn(async () => opened)
    )

    handlers.pushState(target)
    handlers.pushState(target)
    store.markSeen('changed')
    handlers.pushState(target)
    handlers.pushState(target)

    expect(target.send).toHaveBeenCalledTimes(2)
    expect(target.send.mock.calls[1][1]).toEqual({ seen: ['changed'], archived: [] })
  })

  test('guards every state push when the sender has been destroyed', async () => {
    const store = new FakeStore()
    const target = sender(true)
    const handlers = createInboxStateHandlers(
      store,
      vi.fn(async () => opened)
    )

    handlers.pushState(target)
    await handlers.openRun(target, '/qa/project/2026-07-27-request.md')
    handlers.markSeen(target, 'another-request')
    handlers.archive(target, 'archived-request')
    handlers.unarchive(target, 'archived-request')

    expect(target.send).not.toHaveBeenCalled()
  })

  test('an IPC mutation replies only to its invoking renderer', () => {
    const store = new FakeStore()
    const first = sender()
    const second = sender()
    const handlers = createInboxStateHandlers(
      store,
      vi.fn(async () => opened)
    )

    handlers.markSeen(first, 'from-first-window')

    expect(first.send).toHaveBeenCalledOnce()
    expect(second.send).not.toHaveBeenCalled()
  })
})
