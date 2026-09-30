import type { QaSnapshot } from '../../../shared/ipc'
import type { WindowScope } from '../../../shared/windowScope'
import { inboxCounts } from './inbox'
import { isHandoffReady, projectStandings, type Housekeeping } from './projectStanding'

/**
 * Ticket 19, unparked 2026-09-26 (Dominik: the tabs "should indicate when
 * empty or how many items"). What each tab holds for the window's scope:
 *
 * - Inbox: the open requests the Inbox lists.
 * - Releases: features of the release in flight waiting on his verdict.
 * - Roadmap: ideas in the pool (not promoted, not set aside).
 * - Handoffs: handoffs ready to continue.
 *
 * Specs keeps its own "wants you" badge. Under All projects only the Inbox
 * applies; the project tabs are off there and carry no count.
 */
export type TabCounts = Partial<Record<'inbox' | 'releases' | 'roadmap' | 'handoffs', number>>

export function surfaceCounts(
  snapshot: QaSnapshot,
  scope: WindowScope,
  seen: ReadonlySet<string>,
  archived: ReadonlySet<string>,
  housekeeping?: Housekeeping
): TabCounts {
  const inbox = inboxCounts(snapshot, scope, seen, archived).total
  if (scope.kind !== 'project') return { inbox }
  const slug = scope.slug
  const standing = projectStandings(snapshot, new Date(), housekeeping).find(
    (candidate) => candidate.slug === slug
  )
  const pool = snapshot.pools?.find((candidate) => candidate.project === slug)
  return {
    inbox,
    releases: standing?.owed.features ?? 0,
    roadmap: pool ? pool.ideas.filter((idea) => idea.state === 'pool').length : 0,
    handoffs: snapshot.handoffs.filter(
      (handoff) => handoff.project === slug && isHandoffReady(handoff)
    ).length
  }
}
