import type { QaSnapshot } from '../../../shared/ipc'
import type { WindowScope } from '../../../shared/windowScope'
import { openRequestCount } from './featureRequests'
import { inboxCounts } from './inbox'
import { isHandoffReady, projectStandings, type Housekeeping } from './projectStanding'

/**
 * What each tab holds for the window's scope:
 *
 * - Inbox: the open requests the Inbox lists.
 * - Releases: features of the release in flight waiting on the reviewer's verdict.
 * - Roadmap: ideas in the pool (not promoted, not set aside).
 * - Feature requests: requests the reviewer made that are not finished, in
 *   the window's scope. Unlike the project tabs it applies under All projects.
 * - Handoffs: handoffs ready to continue.
 *
 * Specs keeps its own "wants you" badge. Under All projects only the Inbox
 * applies; the project tabs are off there and carry no count.
 */
export type TabCounts = Partial<
  Record<'inbox' | 'releases' | 'roadmap' | 'requests' | 'handoffs', number>
>

/** A count that cannot be read is 0: a bad record must not take the tab bar down. */
function safely(count: () => number): number {
  try {
    return count()
  } catch {
    return 0
  }
}

export function surfaceCounts(
  snapshot: QaSnapshot,
  scope: WindowScope,
  seen: ReadonlySet<string>,
  archived: ReadonlySet<string>,
  housekeeping?: Housekeeping
): TabCounts {
  const inbox = safely(() => inboxCounts(snapshot, scope, seen, archived).total)
  const requests = safely(() => openRequestCount(snapshot, scope))
  if (scope.kind !== 'project') return { inbox, requests }
  const slug = scope.slug
  let standing: ReturnType<typeof projectStandings>[number] | undefined
  try {
    standing = projectStandings(snapshot, new Date(), housekeeping).find(
      (candidate) => candidate.slug === slug
    )
  } catch {
    standing = undefined
  }
  const pool = snapshot.pools?.find((candidate) => candidate.project === slug)
  return {
    inbox,
    requests,
    releases: standing?.owed.features ?? 0,
    roadmap: pool ? pool.ideas.filter((idea) => idea.state === 'pool').length : 0,
    handoffs: snapshot.handoffs.filter(
      (handoff) => handoff.project === slug && isHandoffReady(handoff)
    ).length
  }
}
