import { basename } from 'node:path'
import { IPC } from '../shared/ipc'
import type { InboxState, OpenRunResult } from '../shared/ipc'

export interface InboxStateSender {
  isDestroyed: () => boolean
  send: (channel: string, state: InboxState) => void
}

export interface InboxStateStoreLike {
  get: () => InboxState
  markSeen: (basename: string) => void
  archive: (basename: string) => void
  unarchive: (basename: string) => void
  archiveMany: (requests: readonly string[], threads: readonly string[]) => void
  unarchiveThread: (id: string) => void
}

type OpenRun = (requestPath: string) => Promise<OpenRunResult>

/**
 * The main-process boundary for every inbox-state push. It keeps one
 * serialised fingerprint per renderer so unchanged watcher snapshots do not
 * trigger a second full-tree render, and it guards every sender consistently.
 */
export function createInboxStateHandlers(
  store: InboxStateStoreLike,
  openRun: OpenRun
): {
  pushState: (sender: InboxStateSender) => InboxState
  openRun: (
    sender: InboxStateSender,
    requestPath: string,
    requestIdentity?: string
  ) => Promise<OpenRunResult>
  markSeen: (sender: InboxStateSender, requestBasename: string) => InboxState
  archive: (sender: InboxStateSender, requestBasename: string) => InboxState
  unarchive: (sender: InboxStateSender, requestBasename: string) => InboxState
  archiveMany: (
    sender: InboxStateSender,
    requests: readonly string[],
    threads: readonly string[]
  ) => InboxState
  unarchiveThread: (sender: InboxStateSender, id: string) => InboxState
} {
  const lastSerialised = new WeakMap<object, string>()

  const pushState = (sender: InboxStateSender): InboxState => {
    const state = store.get()
    if (sender.isDestroyed()) return state
    const serialised = JSON.stringify(state)
    if (lastSerialised.get(sender) === serialised) return state
    sender.send(IPC.inboxStateChanged, state)
    lastSerialised.set(sender, serialised)
    return state
  }

  return {
    pushState,
    openRun(sender, requestPath, requestIdentity = basename(requestPath, '.md')) {
      store.markSeen(requestIdentity)
      const result = openRun(requestPath)
      pushState(sender)
      return result
    },
    markSeen(sender, requestBasename) {
      store.markSeen(requestBasename)
      return pushState(sender)
    },
    archive(sender, requestBasename) {
      store.archive(requestBasename)
      return pushState(sender)
    },
    unarchive(sender, requestBasename) {
      store.unarchive(requestBasename)
      return pushState(sender)
    },
    archiveMany(sender, requests, threads) {
      store.archiveMany(requests, threads)
      return pushState(sender)
    },
    unarchiveThread(sender, id) {
      store.unarchiveThread(id)
      return pushState(sender)
    }
  }
}
