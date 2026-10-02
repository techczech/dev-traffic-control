import type { PoolIdea, PoolTier, ProjectPool } from '../../../main/qa/pool'
import type { ProjectRelease } from '../../../main/qa/releaseRecords'
import { compareReleaseVersions, versionCore } from '../../../shared/releaseVersionOrder'
import { readEntries } from './requestFate'

/**
 * The Roadmap grouped by release (ticket 42), as a pure function of one
 * project's pool and release records. Nothing here writes: a move is the
 * caller's `roadmap:write-idea` edit of the idea's `candidate`.
 *
 * - The **pending version** is the next minor after the highest release record
 *   (0.22.0 in flight gives 0.23.0). It is never a file. When that release
 *   ships, or a newer record appears, the highest record moves and so does the
 *   pending version: nothing is retyped.
 * - An idea is **on the Roadmap** when it is approved: `fate` planned or
 *   building, or no `by: reviewer` at all (legacy ideas count as approved).
 */

export { versionCore }
export type RoadmapSource = 'you' | 'agent'
export type RoadmapFilter = 'everything' | 'you' | 'agent'
export type RoadmapGroupKind = 'pending' | 'release' | 'unscheduled'

export const TIER_LABELS: Record<PoolTier, string> = {
  functionality: 'Functionality',
  'quality-of-life': 'Quality of life',
  delight: 'Delight'
}

const TIER_RANK: Record<PoolTier, number> = { functionality: 0, 'quality-of-life': 1, delight: 2 }

export interface RoadmapCard {
  id: string
  title: string
  tier: PoolTier
  tierLabel: string
  source: RoadmapSource
  /** His first quote, when he said it; `''` otherwise. */
  quote: string
  /** `YYYY-MM-DD` of his approval entry; `''` for ideas never approved here. */
  approvedAt: string
  /** The `x.y.z` core of the idea's candidate; `''` when it has none. */
  candidate: string
}

export interface RoadmapGroup {
  /** `pending`, `unscheduled`, or the version core. */
  key: string
  kind: RoadmapGroupKind
  /** The version for `pending` and `release` groups. */
  version: string
  label: string
  cards: RoadmapCard[]
}

export interface RoadmapView {
  pending: string | undefined
  /** The release in flight, for "0.35.0 is in flight in Releases"; `''` when none. */
  inFlight: string
  groups: RoadmapGroup[]
  /** Cards per group key before the filter, for the Move to… menu. */
  counts: Record<string, number>
}

/** The next minor release: 0.22.0 gives 0.23.0. */
export function nextMinor(version: string): string {
  const [major, minor] = versionCore(version).split('.').map(Number)
  return `${major}.${minor + 1}.0`
}

/** The highest release record's version (shipped or not), or `''` when there is none. */
export function highestRecorded(release: ProjectRelease | undefined): string {
  if (release?.kind !== 'recorded') return ''
  return (
    release.versions
      .map((entry) => versionCore(entry.version))
      .filter(Boolean)
      .sort(compareReleaseVersions)
      .pop() ?? ''
  )
}

/**
 * The pending version, or `undefined` when no release record exists to derive it
 * from. `started` is the version he typed into the fallback "Start a new pending
 * release"; it counts only while there is no record, and once a record at or
 * above it exists the derived version takes over.
 */
export function derivePendingVersion(
  release: ProjectRelease | undefined,
  started?: string
): string | undefined {
  const highest = highestRecorded(release)
  const typed = versionCore(started)
  if (highest) {
    const derived = nextMinor(highest)
    return typed && compareReleaseVersions(typed, derived) > 0 ? typed : derived
  }
  return typed || undefined
}

function recordedCores(release: ProjectRelease | undefined): Set<string> {
  return new Set(
    release?.kind === 'recorded' ? release.versions.map((entry) => versionCore(entry.version)) : []
  )
}

/** Approved ideas sit on the Roadmap; an idea waiting for his yes stays in Feature requests. */
export function isOnRoadmap(idea: PoolIdea): boolean {
  if (idea.state !== 'pool') return false
  const fate = idea.request?.fate
  if (fate === 'built' || fate === 'merged' || fate === 'declined') return false
  if (idea.request?.by === 'reviewer') return fate === 'planned' || fate === 'building'
  return true
}

function approvedAt(idea: PoolIdea): string {
  const entries = readEntries(idea.bodyMarkdown).entries
  const approvals = entries.filter(
    (entry) => entry.by === 'reviewer' && /^approved/i.test(entry.answer)
  )
  return approvals[approvals.length - 1]?.at ?? ''
}

function cardOf(idea: PoolIdea): RoadmapCard {
  return {
    id: idea.id,
    title: idea.title,
    tier: idea.tier,
    tierLabel: TIER_LABELS[idea.tier],
    source: idea.request?.by === 'reviewer' ? 'you' : 'agent',
    quote: idea.request?.quotes[0] ?? '',
    approvedAt: approvedAt(idea),
    candidate: versionCore(idea.candidateRelease)
  }
}

/** Existing order first (tier, then position); approvals follow in the order he gave them. */
function compareCards(
  left: RoadmapCard & { position: number },
  right: RoadmapCard & { position: number }
): number {
  if (!!left.approvedAt !== !!right.approvedAt) return left.approvedAt ? 1 : -1
  if (left.approvedAt !== right.approvedAt) return left.approvedAt.localeCompare(right.approvedAt)
  return TIER_RANK[left.tier] - TIER_RANK[right.tier] || left.position - right.position
}

export function matchesRoadmapFilter(
  card: RoadmapCard,
  idea: PoolIdea,
  filter: RoadmapFilter,
  query: string
): boolean {
  if (filter === 'you' && card.source !== 'you') return false
  if (filter === 'agent' && card.source !== 'agent') return false
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return `${idea.title}\n${card.quote}\n${idea.bodyMarkdown}`.toLocaleLowerCase().includes(needle)
}

export function roadmapView(
  pool: ProjectPool | null | undefined,
  release: ProjectRelease | undefined,
  options: { filter?: RoadmapFilter; query?: string; started?: string } = {}
): RoadmapView {
  const filter = options.filter ?? 'everything'
  const query = options.query ?? ''
  const pending = derivePendingVersion(release, options.started)
  const records = recordedCores(release)
  const inFlight = release?.kind === 'recorded' ? versionCore(release.inFlightVersion) : ''

  const buckets = new Map<string, Array<RoadmapCard & { position: number }>>()
  const counts: Record<string, number> = {}
  for (const idea of pool?.ideas ?? []) {
    if (!isOnRoadmap(idea)) continue
    const card = cardOf(idea)
    // A candidate whose release has a record is in Releases now, not on the Roadmap.
    if (card.candidate && records.has(card.candidate)) continue
    let key = 'unscheduled'
    if (card.candidate) {
      if (pending && card.candidate === pending) key = 'pending'
      else if (!pending || compareReleaseVersions(card.candidate, pending) > 0) key = card.candidate
    }
    counts[key] = (counts[key] ?? 0) + 1
    if (!matchesRoadmapFilter(card, idea, filter, query)) continue
    buckets.set(key, [...(buckets.get(key) ?? []), { ...card, position: idea.position }])
  }

  const take = (key: string): RoadmapCard[] =>
    (buckets.get(key) ?? []).sort(compareCards).map((entry) => {
      const { position: _position, ...card } = entry
      void _position
      return card
    })

  const groups: RoadmapGroup[] = []
  if (pending) {
    groups.push({
      key: 'pending',
      kind: 'pending',
      version: pending,
      label: `Pending – ${pending}`,
      cards: take('pending')
    })
  }
  const later = new Set<string>()
  for (const key of new Set([...buckets.keys(), ...Object.keys(counts)])) {
    if (key !== 'pending' && key !== 'unscheduled') later.add(key)
  }
  for (const version of [...later].sort(compareReleaseVersions)) {
    groups.push({
      key: version,
      kind: 'release',
      version,
      label: version,
      cards: take(version)
    })
  }
  groups.push({
    key: 'unscheduled',
    kind: 'unscheduled',
    version: '',
    label: 'Unscheduled',
    cards: take('unscheduled')
  })
  return { pending, inFlight, groups, counts }
}

export interface MoveTarget {
  key: string
  kind: RoadmapGroupKind
  /** The `candidate` to write; `null` clears it. */
  candidate: string | null
  label: string
  count: number
  current: boolean
}

/** The Move to… menu for one card: every group, the card's own marked current. */
export function moveTargets(view: RoadmapView, cardId: string): MoveTarget[] {
  const own = view.groups.find((group) => group.cards.some((card) => card.id === cardId))?.key
  return view.groups.map((group) => ({
    key: group.key,
    kind: group.kind,
    candidate: group.kind === 'unscheduled' ? null : group.version,
    label: group.kind === 'pending' ? `${group.version} · pending` : group.label,
    count: view.counts[group.key] ?? 0,
    current: group.key === own
  }))
}

/** A typed release for "A new release…": a version, later than the pending one. */
export function newReleaseCandidate(text: string, pending: string | undefined): string | null {
  const typed = text.trim()
  if (!/^v?\d+\.\d+(?:\.\d+)?$/.test(typed)) return null
  const core = versionCore(typed)
  if (pending && compareReleaseVersions(core, pending) <= 0) return null
  return core
}
