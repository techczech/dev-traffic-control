import type { QaSnapshot, SerializableRun } from '../../../shared/ipc'
import { ALL_PROJECTS } from '../../../shared/windowScope'
import { formatDenseAge } from './dateVocabulary'
import { runAgeSource } from './format'
import { inboxRows } from './inbox'
import {
  fleetCounts,
  inRailOrder,
  isHandoffReady,
  owedPhrase,
  projectStandings,
  type FleetCounts,
  type Housekeeping,
  type ProjectStanding,
  type RailGroup
} from './projectStanding'

/**
 * *All projects* as a place (ADR-0016 § 1, mockup states 16 and 17): the
 * fleet's Overview and its Inbox, as pure functions of the snapshot.
 *
 * Nothing here decides what a project owes. That is `projectStandings`, the one
 * definition the rail groups by; the rows, the tiles and the handoffs panel are
 * all read off it, so the Overview and the rail beside it cannot disagree about
 * the same project on the same screen.
 */

// ---------------------------------------------------------------------------
// Overview — "Where each project stands"

export type FleetSort = 'needs-you' | 'last-moved' | 'name' | 'release' | 'most-owed'

// Newest first is the default: a project that
// moved minutes ago must never sit mid-table.
export const DEFAULT_FLEET_SORT: FleetSort = 'last-moved'

export const FLEET_SORT_LABELS: Record<FleetSort, string> = {
  'last-moved': 'Newest first',
  'needs-you': 'Needs you first',
  name: 'Project name',
  release: 'Release',
  'most-owed': 'Most owed'
}

export const FLEET_SORTS = Object.keys(FLEET_SORT_LABELS) as FleetSort[]

export function isFleetSort(value: unknown): value is FleetSort {
  return typeof value === 'string' && (FLEET_SORTS as string[]).includes(value)
}

/** One line per project: where it stands. */
export interface FleetRow {
  slug: string
  name: string
  group: RailGroup
  needsYou: boolean
  /** The release version it stands at; `''` when it has no release record. */
  release: string
  /** What it owes — or, when nothing, what is moving there instead. */
  owes: string
  /** When it last moved, in the dense form; `''` when nothing ever has. */
  last: string
  lastAt: string
  owedTotal: number
}

export interface FleetHandoff {
  path: string
  slug: string
  name: string
  title: string
  at: string
  age: string
}

export type FleetTarget =
  | { kind: 'runner'; path: string }
  | { kind: 'thread'; project: string; thread: string }
  | { kind: 'project'; slug: string }

/** One thing that moved somewhere in the fleet. */
export interface FleetEvent {
  key: string
  slug: string
  name: string
  text: string
  at: string
  age: string
  target: FleetTarget
}

/**
 * How many handoffs the panel draws before it stops. State 17 puts both side
 * panels above the fold; a real record with twenty-one handoffs ready pushed
 * *Latest* below it at every width.
 */
export const HANDOFF_PANEL_LIMIT = 4

/**
 * A list drawn at real volumes: the first few rows, and a quiet closing row
 * counting the rest. The caller's full list stays whole — its length is what a
 * header or a tile says — and only what is rendered is capped.
 */
export interface CappedList<T> {
  /** The first few, in the order they are drawn. */
  shown: T[]
  /** How many are not drawn; 0 means no closing row. */
  hidden: number
  /** The quiet closing row, or `''` when nothing is hidden. */
  moreLabel: string
}

export function cappedList<T>(
  items: readonly T[],
  limit: number,
  more: (hidden: number) => string
): CappedList<T> {
  const shown = items.slice(0, Math.max(0, limit))
  const hidden = items.length - shown.length
  return { shown, hidden, moreLabel: hidden > 0 ? more(hidden) : '' }
}

export type HandoffPanel = CappedList<FleetHandoff>

/** What the Handoffs ready panel draws from the full list. */
export function handoffPanel(
  handoffs: readonly FleetHandoff[],
  limit = HANDOFF_PANEL_LIMIT
): HandoffPanel {
  return cappedList(handoffs, limit, handoffsReadyMore)
}

/** "3 more handoffs ready" — the fleet panel and the project home say it alike. */
export function handoffsReadyMore(hidden: number): string {
  return `${hidden} more handoff${hidden === 1 ? '' : 's'} ready`
}

export interface FleetOverviewModel {
  tiles: FleetCounts & { synced: string }
  rows: FleetRow[]
  handoffs: FleetHandoff[]
  latest: FleetEvent[]
}

export function fleetOverview(
  snapshot: QaSnapshot,
  now: Date = new Date(),
  sort: FleetSort = DEFAULT_FLEET_SORT,
  latestLimit = 6,
  housekeeping?: Housekeeping
): FleetOverviewModel {
  const standings = projectStandings(snapshot, now, housekeeping)
  const bySlug = new Map(standings.map((standing) => [standing.slug, standing]))
  const ideas = rankedIdeas(snapshot)

  const rows = sortStandings(standings, sort).map((standing) =>
    toFleetRow(standing, ideas.get(standing.slug) ?? 0, now)
  )

  // Exactly the handoffs the standings counted as owed, so the panel's length
  // is the tile's number.
  const handoffs: FleetHandoff[] = snapshot.handoffs
    .filter((handoff) => bySlug.has(handoff.project) && isHandoffReady(handoff))
    .sort((left, right) => compareNewest(left.updated, right.updated))
    .map((handoff) => ({
      path: handoff.path,
      slug: handoff.project,
      name: bySlug.get(handoff.project)!.name,
      title: handoff.title,
      at: handoff.updated,
      age: formatDenseAge(handoff.updated, now)
    }))

  return {
    tiles: { ...fleetCounts(standings), synced: formatDenseAge(snapshot.scannedAt, now) },
    rows,
    handoffs,
    latest: fleetLatest(snapshot, bySlug, now, latestLimit)
  }
}

function sortStandings(standings: ProjectStanding[], sort: FleetSort): ProjectStanding[] {
  if (sort === 'needs-you') return inRailOrder(standings)
  const byName = (left: ProjectStanding, right: ProjectStanding): number =>
    left.name.localeCompare(right.name)
  const copy = [...standings]
  switch (sort) {
    case 'name':
      return copy.sort(byName)
    case 'last-moved':
      return copy.sort(
        (left, right) => compareNewest(left.lastAt, right.lastAt) || byName(left, right)
      )
    case 'most-owed':
      return copy.sort((left, right) => right.owed.total - left.owed.total || byName(left, right))
    case 'release':
      return copy.sort((left, right) => {
        const a = releaseVersion(left)
        const b = releaseVersion(right)
        if (a !== b) {
          if (!a) return 1
          if (!b) return -1
          return b.localeCompare(a, undefined, { numeric: true })
        }
        return byName(left, right)
      })
  }
}

function releaseVersion(standing: ProjectStanding): string {
  return standing.release.kind === 'none' ? '' : standing.release.version
}

function toFleetRow(standing: ProjectStanding, ideas: number, now: Date): FleetRow {
  return {
    slug: standing.slug,
    name: standing.name,
    group: standing.group,
    needsYou: standing.needsYou,
    release: releaseVersion(standing),
    owes: standing.needsYou ? owedPhrase(standing.owed, 'table') : movingPhrase(standing, ideas),
    last: formatDenseAge(standing.lastAt, now),
    lastAt: standing.lastAt,
    owedTotal: standing.owed.total
  }
}

/** A project that owes nothing still says something true about itself. */
function movingPhrase(standing: ProjectStanding, ideas: number): string {
  if (standing.building > 0) return `${standing.building} being built`
  if (standing.openThreads > 0) {
    return `${standing.openThreads} thread${standing.openThreads === 1 ? '' : 's'} open`
  }
  if (ideas > 0) return `${ideas} idea${ideas === 1 ? '' : 's'} ranked`
  return 'nothing owed'
}

function rankedIdeas(snapshot: QaSnapshot): Map<string, number> {
  const counts = new Map<string, number>()
  for (const pool of snapshot.pools ?? []) {
    const ranked = pool.ideas.filter((idea) => idea.state === 'pool').length
    if (ranked > 0) counts.set(pool.project, ranked)
  }
  return counts
}

/**
 * Latest across the fleet: requests landing and finishing, handoffs written,
 * releases shipped and thread entries — newest first. Only projects in the
 * record appear, the same set the table lists.
 */
function fleetLatest(
  snapshot: QaSnapshot,
  bySlug: Map<string, ProjectStanding>,
  now: Date,
  limit: number
): FleetEvent[] {
  const events: Omit<FleetEvent, 'age' | 'name'>[] = []

  for (const run of snapshot.runs) {
    if (!bySlug.has(run.project)) continue
    const target: FleetTarget = { kind: 'runner', path: run.request.path }
    const landed = runAgeSource(run)
    if (landed) {
      events.push({
        key: `landed:${run.request.path}`,
        slug: run.project,
        text: `${run.request.title} — request landed`,
        at: landed,
        target
      })
    }
    const finished = run.report?.completedAt
    if (finished) {
      events.push({
        key: `finished:${run.request.path}`,
        slug: run.project,
        text: `${run.request.title} — finished`,
        at: finished,
        target
      })
    }
  }

  for (const handoff of snapshot.handoffs) {
    if (!bySlug.has(handoff.project) || !handoff.updated) continue
    events.push({
      key: `handoff:${handoff.path}`,
      slug: handoff.project,
      text: `${handoff.title} — handoff written`,
      at: handoff.updated,
      target: { kind: 'project', slug: handoff.project }
    })
  }

  for (const release of snapshot.releases) {
    if (release.kind !== 'recorded' || !bySlug.has(release.project)) continue
    for (const version of release.versions) {
      if (!version.shipment?.shippedAt) continue
      events.push({
        key: `shipped:${release.project}:${version.version}`,
        slug: release.project,
        text: `${version.version} shipped`,
        at: version.shipment.shippedAt,
        target: { kind: 'project', slug: release.project }
      })
    }
  }

  for (const thread of snapshot.threads) {
    const slug = thread.projects.find((project) => bySlug.has(project))
    if (!slug) continue
    for (const entry of thread.entries) {
      events.push({
        key: `entry:${entry.path}`,
        slug,
        text: entry.title ?? thread.title,
        at: entry.at,
        target: { kind: 'thread', project: slug, thread: thread.id }
      })
    }
  }

  return events
    .filter((event) => !!event.at)
    .sort((left, right) => compareNewest(left.at, right.at) || left.key.localeCompare(right.key))
    .slice(0, limit)
    .map((event) => ({
      ...event,
      name: bySlug.get(event.slug)!.name,
      age: formatDenseAge(event.at, now)
    }))
}

// ---------------------------------------------------------------------------
// Inbox — every open request across projects

export type FleetInboxFilter = 'everything' | 'waiting' | 'building'
export type FleetInboxSort = 'newest' | 'oldest' | 'project'

export const FLEET_INBOX_FILTER_LABELS: Record<FleetInboxFilter, string> = {
  everything: 'Everything',
  waiting: 'Waiting on you',
  building: 'Being built'
}

export const FLEET_INBOX_SORT_LABELS: Record<FleetInboxSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  project: 'By project'
}

export function isFleetInboxSort(value: unknown): value is FleetInboxSort {
  return typeof value === 'string' && value in FLEET_INBOX_SORT_LABELS
}

/**
 * Whose move an open request is. One still to answer is waiting on him; one he
 * has finished stays in the Inbox until an agent collects it, and is then the
 * agent's to act on — drawn as *Being built* in state 16.
 */
export type FleetRequestState = 'waiting' | 'building'

export interface FleetInboxRow {
  run: SerializableRun
  path: string
  slug: string
  /** The product name, said first because under this scope it is unknown. */
  name: string
  title: string
  at: string
  state: FleetRequestState
  isNew: boolean
}

export interface FleetInboxModel {
  rows: FleetInboxRow[]
  /** Distinct projects among the rows shown. */
  projectCount: number
  /** Rows per filter, before the search narrows them. */
  counts: Record<FleetInboxFilter, number>
}

export interface FleetInboxOptions {
  query?: string
  filter?: FleetInboxFilter
  sort?: FleetInboxSort
}

/**
 * The Inbox under *All projects*: the same open requests the per-project Inbox
 * lists (via `inboxRows`, so "open" has one meaning), flattened into one list,
 * newest first by default, each row naming its project.
 */
export function fleetInbox(
  snapshot: QaSnapshot,
  local: {
    seen?: ReadonlySet<string>
    archived?: ReadonlySet<string>
    seenLoaded?: boolean
  } = {},
  options: FleetInboxOptions = {}
): FleetInboxModel {
  const { query = '', filter = 'everything', sort = 'newest' } = options
  const names = new Map(
    projectStandings(snapshot).map((standing) => [standing.slug, standing.name])
  )
  const all: FleetInboxRow[] = inboxRows(
    snapshot,
    ALL_PROJECTS,
    local.seen,
    local.archived,
    local.seenLoaded ?? true
  )
    .flatMap((group) => group.rows)
    .map((row) => ({
      run: row.run,
      path: row.run.request.path,
      slug: row.run.project,
      name: names.get(row.run.project) ?? row.run.project,
      title: row.run.request.title,
      at: row.ageSource,
      state: row.run.status === 'done' ? 'building' : 'waiting',
      isNew: row.isNew
    }))

  const counts: Record<FleetInboxFilter, number> = {
    everything: all.length,
    waiting: all.filter((row) => row.state === 'waiting').length,
    building: all.filter((row) => row.state === 'building').length
  }

  const needle = query.trim().toLocaleLowerCase()
  const rows = all
    .filter((row) => filter === 'everything' || row.state === filter)
    .filter(
      (row) =>
        !needle ||
        row.title.toLocaleLowerCase().includes(needle) ||
        row.name.toLocaleLowerCase().includes(needle) ||
        row.slug.toLocaleLowerCase().includes(needle)
    )
    .sort(inboxComparator(sort))

  return { rows, projectCount: new Set(rows.map((row) => row.slug)).size, counts }
}

function inboxComparator(sort: FleetInboxSort): (a: FleetInboxRow, b: FleetInboxRow) => number {
  const newest = (a: FleetInboxRow, b: FleetInboxRow): number =>
    compareNewest(a.at, b.at) || (a.path < b.path ? 1 : a.path > b.path ? -1 : 0)
  if (sort === 'oldest') return (a, b) => -newest(a, b)
  if (sort === 'project') return (a, b) => a.name.localeCompare(b.name) || newest(a, b)
  return newest
}

// ---------------------------------------------------------------------------

/** Newest first; an empty timestamp sorts last. */
export function compareNewest(left: string, right: string): number {
  if (left === right) return 0
  if (!left) return 1
  if (!right) return -1
  return left < right ? 1 : -1
}

const NUMBER_WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve'
]

/** "seven projects" — a heading reads as a sentence, as drawn in state 16. */
export function countInWords(count: number, noun: string): string {
  const word = NUMBER_WORDS[count] ?? String(count)
  return `${word} ${noun}${count === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------------------
// His ordering, remembered per viewer. A convenience only: a missing or
// unreadable store falls back to the drawn default.

export const FLEET_SORT_STORAGE_KEY = 'dtc.fleet.overview-sort.v2'
export const FLEET_INBOX_SORT_STORAGE_KEY = 'dtc.fleet.inbox-sort.v1'

interface SortStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): SortStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readFleetSort(storage = defaultStorage()): FleetSort {
  try {
    const value = storage?.getItem(FLEET_SORT_STORAGE_KEY)
    return isFleetSort(value) ? value : DEFAULT_FLEET_SORT
  } catch {
    return DEFAULT_FLEET_SORT
  }
}

export function readFleetInboxSort(storage = defaultStorage()): FleetInboxSort {
  try {
    const value = storage?.getItem(FLEET_INBOX_SORT_STORAGE_KEY)
    return isFleetInboxSort(value) ? value : 'newest'
  } catch {
    return 'newest'
  }
}

export function writeFleetSort(key: string, value: string, storage = defaultStorage()): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // A store that refuses the write costs him the remembered order, nothing else.
  }
}
