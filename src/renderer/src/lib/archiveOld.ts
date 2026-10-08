import type { ArchiveOldInput, QaSnapshot } from '../../../shared/ipc'
import { requestIdentity } from '../../../shared/requestIdentity'
import { runAgeSource } from './format'
import { isHandoffReady, isRequestOwed, isThreadOwed, type Housekeeping } from './projectStanding'
import { UNFILED } from './roadmap'

/**
 * Many projects show owed items that are out of date, so the reviewer needs a
 * way to say "archive old". The reviewer picks the age
 * each time, seeing how many items each age would clear.
 *
 * Candidates are exactly what the owed count counts, minus release features,
 * which need a verdict and are never archived. The age is the item's own date:
 * when the request last moved, the thread's last entry, the handoff's
 * `updated`. An item with no readable date is never treated as old.
 */
export const ARCHIVE_AGES = [7, 14, 30] as const
export type ArchiveAge = (typeof ARCHIVE_AGES)[number]

export interface ArchiveOldCandidates extends ArchiveOldInput {
  total: number
}

export function archiveOldCandidates(
  snapshot: QaSnapshot,
  scope: { kind: 'all' } | { kind: 'project'; slug: string },
  days: number,
  now: Date,
  housekeeping?: Housekeeping
): ArchiveOldCandidates {
  const cutoff = now.getTime() - days * 86_400_000
  const old = (at: string | undefined): boolean => {
    const time = at ? new Date(at).getTime() : NaN
    return Number.isFinite(time) && time < cutoff
  }
  const inScope = (project: string): boolean =>
    project !== UNFILED && (scope.kind === 'all' || project === scope.slug)

  const requests = snapshot.runs
    .filter((run) => inScope(run.project) && isRequestOwed(run, housekeeping))
    .filter((run) => old(runAgeSource(run)))
    .map((run) => requestIdentity(snapshot.root, run.request.path))
  const threads = snapshot.threads
    .filter(
      (thread) =>
        thread.projects.some(inScope) && isThreadOwed(thread, housekeeping) && old(thread.lastAt)
    )
    .map((thread) => thread.id)
  const handoffs = snapshot.handoffs
    .filter(
      (handoff) => inScope(handoff.project) && isHandoffReady(handoff) && old(handoff.updated)
    )
    .map((handoff) => handoff.path)

  return { requests, threads, handoffs, total: requests.length + threads.length + handoffs.length }
}
