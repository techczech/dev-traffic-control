import { tildePath } from '../../../shared/tildePath'
import type { QaSnapshot } from '../../../shared/ipc'

import { EXAMPLE_SLUG, type ExampleOpenRefusal, type ExampleRemoveRefusal } from '../../../shared/example'

export { EXAMPLE_SLUG }

/** Where the dev-traffic-control skill lives (checked 2026-09-30). */
export const SKILL_URL =
  'https://github.com/techczech/dominiks-agent-skills/tree/main/dev/dev-traffic-control'

export const INSTALL_LINE =
  'git clone https://github.com/techczech/dominiks-agent-skills && ' +
  "cp -R dominiks-agent-skills/dev/dev-traffic-control <your agent's skills folder>"

/** The line a user pastes to their agent, naming their own records folder. */
export function setupLine(recordsFolder: string): string {
  return (
    `Use the dev-traffic-control skill. My records folder is ${tildePath(recordsFolder)}. ` +
    'When you want me to test or review something, file it there and give me the dtc:// link.'
  )
}


export function exampleRefusalMessage(reason: ExampleOpenRefusal): string {
  switch (reason) {
    case 'folder-exists':
      return `Your records folder already has a folder called ${EXAMPLE_SLUG}, so the example was not added.`
    case 'no-root':
      return 'The records folder could not be found, so the example was not added.'
    default:
      return 'The example project could not be added.'
  }
}

export function exampleRemoveMessage(reason: ExampleRemoveRefusal): string {
  switch (reason) {
    case 'not-example':
      return `${EXAMPLE_SLUG} is not the app's example any more, so it was left in place.`
    case 'absent':
      return 'The example project is already gone.'
    default:
      return 'The example project could not be removed.'
  }
}

/**
 * True when no agent has filed anything in this records folder yet: the one
 * case the empty Inbox points to Get started (ticket 34). An Inbox emptied by
 * answering keeps saying "Inbox clear".
 */
export function nothingFiledYet(snapshot: Pick<QaSnapshot, 'runs'> | null): boolean {
  return !!snapshot && snapshot.runs.length === 0
}
