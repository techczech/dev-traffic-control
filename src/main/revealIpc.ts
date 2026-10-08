import { confineHandoffPath, confineRevealPath } from './confinement'
import type { QaSnapshot } from '../shared/ipc'

export interface RevealHandlerDeps {
  recordRoot: () => string
  snapshot: () => Pick<QaSnapshot, 'handoffs'> | null
  showItemInFolder: (fullPath: string) => void
}

/**
 * The main-process boundary for Show in Finder. A handoff reveals only when it
 * is a handoff in the current snapshot; any other path only when it resolves
 * inside the record root. A refused path returns `false` and reveals nothing.
 */
export function createRevealHandlers(deps: RevealHandlerDeps): {
  revealHandoff: (handoffPath: unknown) => boolean
  revealPath: (filePath: unknown) => Promise<boolean>
} {
  return {
    revealHandoff(handoffPath) {
      const confined = confineHandoffPath(handoffPath, deps.snapshot())
      if (!confined) return false
      deps.showItemInFolder(confined)
      return true
    },
    async revealPath(filePath) {
      const confined = await confineRevealPath(deps.recordRoot(), filePath)
      if (!confined) return false
      deps.showItemInFolder(confined)
      return true
    }
  }
}
