import type { QaSnapshot } from '../../../shared/ipc'
import { scopeProject, type WindowScope } from '../../../shared/windowScope'

/** Where a window goes when the reviewer leaves or finishes a record. */
export type RecordExit = { kind: 'home'; project: string } | { kind: 'dashboard' }

/**
 * Leaving a record lands on the record's own project home, where the record
 * sits among its siblings — never straight on the dashboard of everything,
 * which is precisely the place a window's scope says it is not. The snapshot
 * names the record's project when the record is in it; the window's scope
 * covers a record the snapshot has not caught up with (a linked window is born
 * scoped to its project); the dashboard survives only when neither knows.
 */
export function recordExit(
  requestPath: string,
  snapshot: Pick<QaSnapshot, 'runs'> | null | undefined,
  scope: WindowScope | undefined
): RecordExit {
  const run = snapshot?.runs.find((candidate) => candidate.request.path === requestPath)
  if (run) return { kind: 'home', project: run.project }
  const slug = scopeProject(scope)
  if (slug) return { kind: 'home', project: slug }
  return { kind: 'dashboard' }
}

/**
 * Takes the exit. A project home is reached the one way every "show me this
 * project" is (`openProject`), which enters the project first when the window
 * is scoped elsewhere; the home names no project of its own.
 */
export function followRecordExit(
  exit: RecordExit,
  nav: { openProject: (slug: string) => void; navigate: (view: { kind: 'dashboard' }) => void }
): void {
  if (exit.kind === 'home') nav.openProject(exit.project)
  else nav.navigate({ kind: 'dashboard' })
}
