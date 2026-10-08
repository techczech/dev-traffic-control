import { confineHandoffPath } from './confinement'
import {
  archiveHandoff,
  markHandoffPickedUp,
  readHandoffFile,
  unarchiveHandoff,
  type HandoffSidecar
} from './qa/handoffs'
import type { QaSnapshot } from '../shared/ipc'

export interface HandoffHandlerDeps {
  snapshot: () => Pick<QaSnapshot, 'handoffs'> | null
  refreshAfterWrite: () => void
  writeClipboard: (text: string) => void
  now: () => string
}

/**
 * The main-process boundary for the handoff sidecar writes the renderer can
 * ask for. Every path goes through `confineHandoffPath` first; a refused path
 * returns `null` and reads, writes and copies nothing.
 */
export function createHandoffHandlers(deps: HandoffHandlerDeps): {
  copyPrompt: (handoffPath: unknown) => Promise<HandoffSidecar | null>
  archive: (handoffPath: unknown) => Promise<HandoffSidecar | null>
  unarchive: (handoffPath: unknown) => Promise<HandoffSidecar | null>
} {
  const confine = (handoffPath: unknown): string | null =>
    confineHandoffPath(handoffPath, deps.snapshot())

  return {
    async copyPrompt(handoffPath) {
      const confined = confine(handoffPath)
      if (!confined) return null
      const handoff = await readHandoffFile(confined)
      const state = await markHandoffPickedUp(confined, deps.now)
      deps.writeClipboard(handoff.relaunchPrompt)
      return state
    },
    async archive(handoffPath) {
      const confined = confine(handoffPath)
      if (!confined) return null
      const state = await archiveHandoff(confined, deps.now)
      deps.refreshAfterWrite()
      return state
    },
    async unarchive(handoffPath) {
      const confined = confine(handoffPath)
      if (!confined) return null
      const state = await unarchiveHandoff(confined)
      deps.refreshAfterWrite()
      return state
    }
  }
}
