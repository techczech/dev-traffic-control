import type { QaSnapshot, SerializableRun } from '../../../shared/ipc'
import type { Handoff } from '../../../main/qa/handoffs'
import type {
  ProjectRelease,
  ReleaseFeature,
  ReleaseFeatureStatus
} from '../../../main/qa/releaseRecords'
import type { Thread } from '../../../main/qa/types'
import type { WindowScope } from '../../../shared/windowScope'
import { formatDenseAge } from './dateVocabulary'
import { runAgeSource } from './format'
import { isRequestIdeaOwed } from './requestFate'
import { displayProjectName } from './projectSidebar'
import { UNFILED } from './roadmap'
import { requestIdentity } from '../../../shared/requestIdentity'

/**
 * What every project owes him, and how the project list is grouped and ordered
 * (ADR-0016 § 2 and § 4).
 *
 * This is the *one* definition of "needs you": a verdict owed — an unanswered
 * request, or a feature waiting on him — or a handoff sitting ready. Nothing
 * else qualifies, because a signal he learns to discount is worse than no
 * signal. The project rail groups by it and the *All projects* rollup counts
 * with it; two definitions would let the rail and the fleet view disagree about
 * the same project on the same screen.
 *
 * Everything here is a pure function of the repository snapshot plus one
 * piece of his housekeeping. Until 2026-09-23 app-local archive state
 * deliberately did not reach it ("the rail is a reading of the record, not of
 * his housekeeping"). Ticket 22 reverses that at his request: what he
 * archives, singly or with Archive old, is his declaration that it is stale,
 * so it stops counting as owed. `Housekeeping` carries exactly that, and every
 * reader of the owed count takes the same value so none can disagree.
 */

export type RailGroup = 'needs-you' | 'ticking-along' | 'quiet'

export const RAIL_GROUP_LABELS: Record<RailGroup, string> = {
  'needs-you': 'Needs you',
  'ticking-along': 'Ticking along',
  quiet: 'Quiet'
}

const RAIL_GROUP_ORDER: readonly RailGroup[] = ['needs-you', 'ticking-along', 'quiet']

/** Nothing has moved for a week — the app's existing coldness threshold. */
const COLD_MS = 7 * 24 * 60 * 60 * 1000

/** The five things that can be owed. Their sum is the "N waiting" count. */
export interface ProjectOwed {
  /** Unanswered requests: a run that is neither finished nor chat-resolved. */
  requests: number
  /** Release features he has been asked to judge. */
  features: number
  /** Open threads whose move is his. */
  decisions: number
  /** Handoffs written, never picked up, still live. */
  handoffs: number
  /** Feature requests with fate `waiting` that he has not answered (ticket 38). */
  suggestions: number
  total: number
}

export type ReleaseStanding =
  { kind: 'in-flight'; version: string } | { kind: 'shipped'; version: string } | { kind: 'none' }

/** One project as the list sees it. Shared by the rail and the fleet rollup. */
export interface ProjectStanding {
  slug: string
  name: string
  owed: ProjectOwed
  /** ADR-0016 § 4. True exactly when something is owed. */
  needsYou: boolean
  group: RailGroup
  release: ReleaseStanding
  /** Features an agent is working on — being built, or built and tested. */
  building: number
  openThreads: number
  /** Most recent movement anywhere in the project; `''` when nothing has. */
  lastAt: string
  /** The stalest owed thing; `''` when nothing is owed. */
  oldestOwedAt: string
}

/** The name the titlebar and the rail both use, so they cannot disagree. */
export function projectDisplayName(
  releases: readonly ProjectRelease[] | undefined,
  slug: string
): string {
  const release = (releases ?? []).find(
    (candidate) => candidate.kind === 'recorded' && candidate.project === slug
  )
  const app = release?.kind === 'recorded' ? release.record.app?.trim() : ''
  return app || displayProjectName(slug)
}

/**
 * A handoff sitting ready to pick up: written, still live, and never picked up.
 * One already in hand is work in progress, not an invitation.
 */
export function isHandoffReady(handoff: Handoff): boolean {
  return (
    handoff.history.kind === 'never-picked-up' &&
    handoff.state !== 'superseded' &&
    handoff.state !== 'done'
  )
}

/**
 * An unanswered request: neither finished nor resolved in chat. A verdict owed.
 * The rail counts these and the project home lists them, through this one test.
 */
/** What he has archived: request identities and thread ids (ticket 22). */
export interface Housekeeping {
  root: string
  requests: ReadonlySet<string>
  threads: ReadonlySet<string>
}

export function isRequestOwed(run: SerializableRun, housekeeping?: Housekeeping): boolean {
  if (run.status === 'done' || run.resolvedAt) return false
  return !housekeeping?.requests.has(requestIdentity(housekeeping.root, run.request.path))
}

/** An open thread whose move is his — a decision owed, unless he archived it. */
export function isThreadOwed(thread: Thread, housekeeping?: Housekeeping): boolean {
  if (thread.state === 'retired' || thread.move !== 'me') return false
  return !housekeeping?.threads.has(thread.id)
}

/**
 * Where a release feature stands. The same expression the Releases board uses,
 * so a feature cannot be "Waiting on you" there and invisible here.
 */
export function featureStatus(feature: ReleaseFeature): ReleaseFeatureStatus {
  return feature.status ?? feature.declaredState ?? 'notstarted'
}

/** Every project in the record, with what it owes and where that puts it. */
export function projectStandings(
  snapshot: QaSnapshot,
  now: Date = new Date(),
  housekeeping?: Housekeeping
): ProjectStanding[] {
  const standings = new Map<string, Mutable>()
  for (const slug of snapshot.projects) {
    standings.set(slug, blank(slug, projectDisplayName(snapshot.releases, slug)))
  }
  const find = (slug: string): Mutable | undefined =>
    slug === UNFILED ? undefined : standings.get(slug)

  for (const run of snapshot.runs) {
    const standing = find(run.project)
    if (!standing) continue
    const at = runAgeSource(run)
    moved(standing, at)
    if (!isRequestOwed(run, housekeeping)) continue
    standing.owed.requests += 1
    owedAt(standing, at)
  }

  for (const thread of snapshot.threads) {
    if (thread.state === 'retired') continue
    for (const slug of thread.projects.length ? thread.projects : [UNFILED]) {
      const standing = find(slug)
      if (!standing) continue
      standing.openThreads += 1
      moved(standing, thread.lastAt)
      if (!isThreadOwed(thread, housekeeping)) continue
      standing.owed.decisions += 1
      owedAt(standing, thread.lastAt)
    }
  }

  for (const handoff of snapshot.handoffs) {
    const standing = find(handoff.project)
    if (!standing) continue
    moved(standing, handoff.updated)
    if (!isHandoffReady(handoff)) continue
    standing.owed.handoffs += 1
    owedAt(standing, handoff.updated)
  }

  for (const pool of snapshot.pools ?? []) {
    const standing = find(pool.project)
    if (!standing) continue
    for (const idea of pool.ideas) {
      if (!isRequestIdeaOwed(idea)) continue
      standing.owed.suggestions += 1
      owedAt(standing, idea.added ?? '')
    }
  }

  for (const release of snapshot.releases) {
    const standing = find(release.project)
    if (!standing || release.kind !== 'recorded') continue
    const version = release.record.version
    const shipped = release.versions.some(
      (candidate) => candidate.version === version && !!candidate.shipment
    )
    standing.release = shipped ? { kind: 'shipped', version } : { kind: 'in-flight', version }
    const updated = release.record.updated ?? ''
    moved(standing, updated)
    for (const feature of release.record.features) {
      if (feature.kind !== 'feature') continue
      const status = featureStatus(feature)
      if (status === 'you') {
        standing.owed.features += 1
        owedAt(standing, updated)
      } else if (status === 'building' || status === 'built') {
        standing.building += 1
      }
    }
  }

  return [...standings.values()].map((standing) => settle(standing, now))
}

/**
 * The fleet's totals, taken from the standings. The rail's *All projects* count
 * and the *All projects* Overview tiles both read these, so the number beside
 * the pinned row and the number on the tile are one sum, never two.
 */
export interface FleetCounts {
  /** Everything owed across the fleet — the rail's "N waiting". */
  waiting: number
  /** Projects in *Needs you*. */
  needsYou: number
  releasesInFlight: number
  handoffsReady: number
  projects: number
}

export function fleetCounts(standings: readonly ProjectStanding[]): FleetCounts {
  let waiting = 0
  let needsYou = 0
  let releasesInFlight = 0
  let handoffsReady = 0
  for (const standing of standings) {
    waiting += standing.owed.total
    handoffsReady += standing.owed.handoffs
    if (standing.needsYou) needsYou += 1
    if (standing.release.kind === 'in-flight') releasesInFlight += 1
  }
  return { waiting, needsYou, releasesInFlight, handoffsReady, projects: standings.length }
}

/**
 * The rail's ordering: the three groups in their fixed order, *Needs you*
 * stalest first, the other two by latest movement. Exported so the fleet
 * Overview's "Needs you first" is this order and not a second opinion of it.
 */
export function inRailOrder(standings: readonly ProjectStanding[]): ProjectStanding[] {
  return RAIL_GROUP_ORDER.flatMap((group) =>
    standings
      .filter((standing) => standing.group === group)
      .sort(group === 'needs-you' ? byStalestOwed : byLatestMovement)
  )
}

/** One rail row: a name, what the project owes, and whether it is in scope. */
export interface RailRow {
  slug: string
  name: string
  group: RailGroup
  /** The standing line — release in flight and what is moving. */
  lead: string
  /** What is owed, drawn apart because it is the reason the row is up here. */
  owes?: string
  current: boolean
}

export interface RailSection {
  group: RailGroup
  label: string
  rows: RailRow[]
}

export interface ProjectRailModel {
  /** Pinned above the groups: a scope of its own, not a fallback. */
  all: { waiting: number; current: boolean }
  sections: RailSection[]
  /** Every project in the record, however the filter has narrowed the list. */
  projectCount: number
  matched: number
  /** How fresh the reading is, in the dense form. */
  synced: string
}

/**
 * The snapshot as the rail draws it: *All projects* with the fleet's waiting
 * count, then the three groups, each ordered by the question it answers —
 * *Needs you* stalest first, because the oldest owed thing is the one at risk
 * of being forgotten; the other two by most recent movement.
 *
 * An empty group is omitted rather than drawn with a heading and no rows.
 */
export function projectRail(
  snapshot: QaSnapshot | null,
  scope: WindowScope,
  now: Date = new Date(),
  query = '',
  housekeeping?: Housekeeping
): ProjectRailModel {
  if (!snapshot) {
    return {
      all: { waiting: 0, current: scope.kind === 'all' },
      sections: [],
      projectCount: 0,
      matched: 0,
      synced: ''
    }
  }
  const standings = projectStandings(snapshot, now, housekeeping)
  const { waiting } = fleetCounts(standings)
  const needle = query.trim().toLocaleLowerCase()
  const matching = needle
    ? standings.filter(
        (standing) =>
          standing.name.toLocaleLowerCase().includes(needle) ||
          standing.slug.toLocaleLowerCase().includes(needle)
      )
    : standings

  const ordered = inRailOrder(matching)
  const sections: RailSection[] = []
  for (const group of RAIL_GROUP_ORDER) {
    const rows = ordered
      .filter((standing) => standing.group === group)
      .map((standing) => toRow(standing, scope, now))
    if (rows.length > 0) sections.push({ group, label: RAIL_GROUP_LABELS[group], rows })
  }

  return {
    all: { waiting, current: scope.kind === 'all' },
    sections,
    projectCount: standings.length,
    matched: matching.length,
    synced: formatDenseAge(snapshot.scannedAt, now)
  }
}

type Mutable = Omit<ProjectStanding, 'needsYou' | 'group'>

function blank(slug: string, name: string): Mutable {
  return {
    slug,
    name,
    owed: { requests: 0, features: 0, decisions: 0, handoffs: 0, suggestions: 0, total: 0 },
    release: { kind: 'none' },
    building: 0,
    openThreads: 0,
    lastAt: '',
    oldestOwedAt: ''
  }
}

function moved(standing: Mutable, at: string): void {
  if (at && at > standing.lastAt) standing.lastAt = at
}

function owedAt(standing: Mutable, at: string): void {
  if (!at) return
  if (!standing.oldestOwedAt || at < standing.oldestOwedAt) standing.oldestOwedAt = at
}

function settle(standing: Mutable, now: Date): ProjectStanding {
  const owed = standing.owed
  const total = owed.requests + owed.features + owed.decisions + owed.handoffs + owed.suggestions
  const needsYou = total > 0
  const cold = !standing.lastAt || now.getTime() - Date.parse(standing.lastAt) >= COLD_MS
  const group: RailGroup = needsYou
    ? 'needs-you'
    : standing.building > 0 || !cold
      ? 'ticking-along'
      : 'quiet'
  return { ...standing, owed: { ...owed, total }, needsYou, group }
}

function byStalestOwed(left: ProjectStanding, right: ProjectStanding): number {
  if (left.oldestOwedAt !== right.oldestOwedAt) {
    if (!left.oldestOwedAt) return 1
    if (!right.oldestOwedAt) return -1
    return left.oldestOwedAt < right.oldestOwedAt ? -1 : 1
  }
  return left.name.localeCompare(right.name)
}

function byLatestMovement(left: ProjectStanding, right: ProjectStanding): number {
  if (left.lastAt !== right.lastAt) return left.lastAt < right.lastAt ? 1 : -1
  return left.name.localeCompare(right.name)
}

function toRow(standing: ProjectStanding, scope: WindowScope, now: Date): RailRow {
  const sub = railSub(standing, now)
  return {
    slug: standing.slug,
    name: standing.name,
    group: standing.group,
    lead: sub.lead,
    ...(sub.owes ? { owes: sub.owes } : {}),
    current: scope.kind === 'project' && scope.slug === standing.slug
  }
}

function railSub(standing: ProjectStanding, now: Date): { lead: string; owes?: string } {
  const standingPart = releasePart(standing)
  const age = formatDenseAge(standing.lastAt, now)

  if (standing.group === 'needs-you') {
    return { lead: standingPart ?? 'no release', owes: owedPhrase(standing.owed) }
  }
  if (standing.group === 'ticking-along') {
    const moving = standing.building > 0 ? `${standing.building} being built` : age
    return { lead: join(standingPart, moving) }
  }
  if (standingPart) return { lead: join(standingPart, age) }
  return { lead: age ? `nothing since ${age}` : 'no records' }
}

/** What a project stands at: the release in flight, or what it has instead. */
function releasePart(standing: ProjectStanding): string | null {
  if (standing.release.kind === 'in-flight') return standing.release.version
  if (standing.release.kind === 'shipped') return `${standing.release.version} shipped`
  if (standing.openThreads > 0) {
    return `${standing.openThreads} thread${standing.openThreads === 1 ? '' : 's'}`
  }
  return null
}

/**
 * What a project owes, in words. The rail's row is tight and says "4
 * decisions"; the fleet table has a column headed *What it owes* and draws "4
 * decisions owed" (mockup states 16 and 17). Same counts, same order.
 */
export function owedPhrase(owed: ProjectOwed, form: 'rail' | 'table' = 'rail'): string {
  const parts: string[] = []
  const verdicts = owed.requests + owed.features
  if (verdicts > 0) parts.push(`${verdicts} waiting on you`)
  if (owed.decisions > 0) {
    parts.push(
      `${owed.decisions} decision${owed.decisions === 1 ? '' : 's'}${form === 'table' ? ' owed' : ''}`
    )
  }
  if (owed.handoffs > 0) {
    parts.push(owed.handoffs === 1 ? 'handoff ready' : `${owed.handoffs} handoffs ready`)
  }
  if (owed.suggestions > 0) {
    parts.push(
      owed.suggestions === 1 ? 'suggestion to answer' : `${owed.suggestions} suggestions to answer`
    )
  }
  return parts.join(' · ')
}

function join(...parts: Array<string | null>): string {
  return parts.filter((part): part is string => !!part).join(' · ')
}
