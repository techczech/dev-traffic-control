import type { QaSnapshot, SerializableRun } from '../../../shared/ipc'
import type { PoolTier } from '../../../main/qa/pool'
import type { ReleaseFeature, ReleaseFeatureStatus } from '../../../main/qa/releaseRecords'
import { formatDenseAge, formatDenseDay, formatFullAge } from './dateVocabulary'
import {
  cappedList,
  compareNewest,
  countInWords,
  handoffsReadyMore,
  type CappedList
} from './fleet'
import { runAgeSource } from './format'
import { projectRounds, roundRollupLine } from './project'
import {
  featureStatus,
  isHandoffReady,
  isRequestOwed,
  isThreadOwed,
  projectStandings,
  type Housekeeping,
  type ProjectStanding
} from './projectStanding'
import { RELEASE_STATE_WORDS, featureReachedAt, type ReleaseStateWord } from './releases'
import { threadsForProject } from './roadmap'
import { specRows } from './specs'

/**
 * The project home (ADR-0016 amendment, mockup states 9–12): everything about
 * one project on Overview, as a pure function of the snapshot.
 *
 * Nothing here decides what the project owes. The *Waiting on you* list is the
 * set `projectStandings` counts — the same four predicates, item by item — so
 * the home's count and the rail row's count are one sum. A test holds the two
 * together.
 *
 * Every list is drawn at real volumes: the newest few rows and a quiet closing
 * row counting the rest (the fleet's `handoffPanel` pattern). Headers keep the
 * full number.
 */

/** Rows a list section draws before its closing row. */
export const HOME_LIST_LIMIT = 4
/** Features the release card draws; a release is bounded, but not small. */
export const HOME_FEATURE_LIMIT = 8
/** Questions the release block states before its closing row. */
export const HOME_QUESTION_LIMIT = 4

/** Where a row leads. Every row on the home is a way in, never a count. */
export type HomeTarget =
  | { kind: 'runner'; path: string }
  | { kind: 'thread'; project: string; thread: string }
  | { kind: 'note'; path: string }
  | { kind: 'surface'; surface: 'inbox' | 'specs' | 'releases' | 'roadmap' | 'handoffs' }
  /** A feature waiting on his verdict: opens the verdict sheet at it (ticket 21). */
  | { kind: 'verdict'; id: string }

export interface HomeRow {
  /** Unique on the page — the keyboard selection's address. */
  key: string
  title: string
  at: string
  /** The dense date; `''` when the record carries none. */
  age: string
  /** A second, quieter line; only a round carries one (its rollup). */
  detail?: string
  /** Where a request stands (Dominik 2026-09-27: "no status on lots of items"). */
  state?: { label: string; tone: 'you' | 'started' | 'done' }
  target: HomeTarget
}

export interface HomeList<T = HomeRow> extends CappedList<T> {
  /** The full count, for the section header. */
  total: number
}

export interface HomeFeatureRow {
  key: string
  id: string
  title: string
  status: ReleaseFeatureStatus
  /** One of the five fixed words, never reworded. */
  state: ReleaseStateWord
  /** When it reached that state ({@link featureReachedAt}); `''` when unknown. */
  at: string
  /** The dense date after the pill, as on Recent requests; `''` when unknown. */
  age: string
}

/**
 * One feature the release is stopped on. The title leads, because it says what
 * changed; the how-to-check steps never lead (Dominik 2026-09-23: "the titles
 * are horrible ... not just give the first command").
 */
export interface HomeReleaseQuestion {
  key: string
  id: string
  title: string
  /** The first line of what the feature is, `''` when the record has none. */
  detail: string
  /** The how-to-check steps, whole, for the verdict sheet; never shown in the block. */
  howToCheck: string
  /** "asked Thu 11 Sep" — the full form, because this is a detail line. */
  asked: string
}

/**
 * The release needs him (mockup state 10): features in the release in flight
 * are waiting on his verdict. When set, this block takes the top of the
 * surface and the features it names are not repeated in *Waiting on you*.
 */
export interface HomeReleaseCall {
  version: string
  heading: string
  /** "waiting since 11 Sep" — `''` when the record carries no date. */
  since: string
  /** Every waiting feature, the first few drawn; `total` is the heading's count. */
  questions: HomeList<HomeReleaseQuestion>
  /** Every waiting feature in order, for the verdict sheet to walk. */
  all: HomeReleaseQuestion[]
}

export type HomeRelease =
  | { kind: 'in-flight' | 'shipped'; version: string; features: HomeList<HomeFeatureRow> }
  | { kind: 'none'; sentence: string }

export interface HomeLane {
  tier: PoolTier
  label: string
  count: number
}

export interface ProjectHomeModel {
  slug: string
  name: string
  /** A folder holding nothing at all (mockup state 12). */
  empty: boolean
  standing: ProjectStanding
  releaseCall: HomeReleaseCall | null
  waiting: HomeList
  release: HomeRelease
  requests: HomeList
  notes: HomeList
  threads: HomeList
  handoffs: HomeList
  specs: HomeList
  /**
   * The project's named rounds — its round subfolders — newest first, each
   * with its rollup. Loose records are not a round: they are the requests and
   * notes lists. Carried over from the retired ADR-0006 project view (ticket 12).
   */
  rounds: HomeList
  roadmap: { total: number; lanes: HomeLane[] }
}

const LANES: ReadonlyArray<{ tier: PoolTier; label: string }> = [
  { tier: 'functionality', label: 'Functionality' },
  { tier: 'quality-of-life', label: 'Quality of life' },
  { tier: 'delight', label: 'Delight' }
]

/** The board's order: what needs him, then what is moving, then the rest. */
const FEATURE_ORDER: Record<ReleaseFeatureStatus, number> = {
  you: 0,
  building: 1,
  built: 2,
  notstarted: 3,
  done: 4
}

/**
 * The home of `slug`, or `null` when the record has no such project.
 */
export function projectHome(
  snapshot: QaSnapshot,
  slug: string,
  now: Date = new Date(),
  limit = HOME_LIST_LIMIT,
  housekeeping?: Housekeeping
): ProjectHomeModel | null {
  const standing = projectStandings(snapshot, now, housekeeping).find(
    (candidate) => candidate.slug === slug
  )
  if (!standing) return null

  const dated = (at: string): { at: string; age: string } => ({
    at,
    age: formatDenseAge(at, now)
  })

  const runs = snapshot.runs.filter((run) => run.project === slug)
  const threads = threadsForProject(snapshot.threads, slug)
  const handoffs = snapshot.handoffs.filter((handoff) => handoff.project === slug)
  const notes = snapshot.notes.filter((note) => note.project === slug)
  const recorded = snapshot.releases.find(
    (release) => release.project === slug && release.kind === 'recorded'
  )
  const record = recorded?.kind === 'recorded' ? recorded.record : null
  const features = (record?.features ?? []).filter(
    (feature): feature is ReleaseFeature => feature.kind === 'feature'
  )
  const ideas = (snapshot.pools ?? []).find((pool) => pool.project === slug)?.ideas ?? []
  const recordedAt = record?.updated ?? ''

  // --- the release needs him --------------------------------------------------
  const waitingFeatures = features.filter((feature) => featureStatus(feature) === 'you')
  const waitingQuestions: HomeReleaseQuestion[] = waitingFeatures.map((feature) => ({
    key: `call:${feature.id}`,
    id: feature.id,
    title: feature.title,
    detail: detailFor(feature),
    howToCheck: (feature.howToCheck ?? '').trim(),
    asked: recordedAt ? `asked ${formatFullAge(recordedAt, now)}` : ''
  }))
  const releaseCall: HomeReleaseCall | null =
    standing.release.kind === 'in-flight' && waitingFeatures.length > 0
      ? {
          version: standing.release.version,
          heading: `${standing.release.version} is stopped on ${countInWords(
            waitingFeatures.length,
            'verdict'
          )}`,
          since: recordedAt ? `waiting since ${formatDenseAge(recordedAt, now)}` : '',
          questions: homeList(
            waitingQuestions,
            HOME_QUESTION_LIMIT,
            (n) => `${n} more waiting on your verdict`
          ),
          all: waitingQuestions
        }
      : null

  // --- waiting on you: exactly what the standing counts ----------------------
  const owed: HomeRow[] = [
    ...runs
      .filter((run) => isRequestOwed(run, housekeeping))
      .map((run) => ({
        key: `waiting:run:${run.request.path}`,
        title: run.request.title,
        ...dated(runAgeSource(run)),
        target: { kind: 'runner', path: run.request.path } as HomeTarget
      })),
    ...threads
      .filter((thread) => isThreadOwed(thread, housekeeping))
      .map((thread) => ({
        key: `waiting:thread:${thread.id}`,
        title: thread.title,
        ...dated(thread.lastAt),
        target: { kind: 'thread', project: slug, thread: thread.id } as HomeTarget
      })),
    ...handoffs.filter(isHandoffReady).map((handoff) => ({
      key: `waiting:handoff:${handoff.path}`,
      title: handoff.title,
      ...dated(handoff.updated),
      target: { kind: 'surface', surface: 'handoffs' } as HomeTarget
    })),
    // Features waiting on him are the release block's when there is one; a
    // shipped release's stragglers still owe, so they are listed here.
    ...(releaseCall ? [] : waitingFeatures).map((feature) => ({
      key: `waiting:feature:${feature.id}`,
      title: feature.title,
      ...dated(recordedAt),
      target: { kind: 'surface', surface: 'releases' } as HomeTarget
    }))
  ]
  const waiting = homeList(newestFirst(owed), limit, (n) => `${n} more waiting on you`)

  // --- the release ------------------------------------------------------------
  const release: HomeRelease =
    standing.release.kind === 'none'
      ? {
          kind: 'none',
          sentence: `Nobody has declared what ${standing.name} is working towards.`
        }
      : {
          kind: standing.release.kind,
          version: standing.release.version,
          features: homeList(
            features
              .map((feature, index) => ({ feature, index, status: featureStatus(feature) }))
              .sort(
                (left, right) =>
                  FEATURE_ORDER[left.status] - FEATURE_ORDER[right.status] ||
                  left.index - right.index
              )
              .map(({ feature, status }) => {
                const at = featureReachedAt(feature)
                return {
                  key: `feature:${feature.id}`,
                  id: feature.id,
                  title: feature.title,
                  status,
                  state: RELEASE_STATE_WORDS[status],
                  at,
                  age: at ? formatDenseDay(at, now) : ''
                }
              }),
            HOME_FEATURE_LIMIT,
            (n) => `${n} more feature${n === 1 ? '' : 's'}`
          )
        }

  // --- the lists --------------------------------------------------------------
  const requests = homeList(
    newestFirst(
      runs.map((run) => ({
        key: `request:${run.request.path}`,
        title: run.request.title,
        ...dated(runAgeSource(run)),
        state: requestState(run),
        target: { kind: 'runner', path: run.request.path } as HomeTarget
      }))
    ),
    limit,
    (n) => `${n} more request${n === 1 ? '' : 's'}`
  )

  const noteRows = homeList(
    newestFirst(
      notes.map((note) => ({
        key: `note:${note.path}`,
        title: note.title,
        ...dated(filenameDate(note.path)),
        target: { kind: 'note', path: note.path } as HomeTarget
      }))
    ),
    limit,
    (n) => `${n} more note${n === 1 ? '' : 's'}`
  )

  const threadRows = homeList(
    threads.map((thread) => ({
      key: `thread:${thread.id}`,
      title: thread.title,
      ...dated(thread.lastAt),
      target: { kind: 'thread', project: slug, thread: thread.id } as HomeTarget
    })),
    limit,
    (n) => `${n} more open thread${n === 1 ? '' : 's'}`
  )

  const handoffRows = homeList(
    newestFirst(
      handoffs.filter(isHandoffReady).map((handoff) => ({
        key: `handoff:${handoff.path}`,
        title: handoff.title,
        ...dated(handoff.updated),
        target: { kind: 'surface', surface: 'handoffs' } as HomeTarget
      }))
    ),
    limit,
    handoffsReadyMore
  )

  // The Specs tab's own reading list and order, scoped to this project.
  const specs = homeList(
    specRows(snapshot, { kind: 'project', slug }, {}).map((row) => ({
      key: `spec:${row.requestPath}`,
      title: row.title,
      ...dated(row.ageSource),
      target: row.openable
        ? ({ kind: 'runner', path: row.requestPath } as HomeTarget)
        : ({ kind: 'surface', surface: 'specs' } as HomeTarget)
    })),
    limit,
    (n) => `${n} more spec${n === 1 ? '' : 's'}`
  )

  // A round is entered at its newest request, else its newest note: both
  // lists are newest first, so the first of each is the way in.
  const rounds = homeList(
    projectRounds(snapshot, slug).flatMap((round): HomeRow[] => {
      if (round.round === null) return []
      const newestRun = round.runs[0]
      const newestNote = round.notes[0]
      const target: HomeTarget | null = newestRun
        ? { kind: 'runner', path: newestRun.request.path }
        : newestNote
          ? { kind: 'note', path: newestNote.path }
          : null
      if (!target) return []
      return [
        {
          key: `round:${round.round}`,
          title: round.round,
          ...dated(round.latest),
          detail: roundRollupLine(round.rollup),
          target
        }
      ]
    }),
    limit,
    (n) => `${n} more round${n === 1 ? '' : 's'}`
  )

  const lanes = LANES.map(({ tier, label }) => ({
    tier,
    label,
    count: ideas.filter((idea) => idea.state === 'pool' && idea.tier === tier).length
  }))

  const empty =
    runs.length === 0 &&
    notes.length === 0 &&
    handoffs.length === 0 &&
    ideas.length === 0 &&
    !recorded &&
    !snapshot.threads.some((thread) => thread.projects.includes(slug))

  return {
    slug,
    name: standing.name,
    empty,
    standing,
    releaseCall,
    waiting,
    release,
    requests,
    notes: noteRows,
    threads: threadRows,
    handoffs: handoffRows,
    specs,
    rounds,
    roadmap: { total: lanes.reduce((sum, lane) => sum + lane.count, 0), lanes }
  }
}

/**
 * The keyboard's reading order through the home: the release block, then the
 * wide column top to bottom, then the narrow one — the order the eye takes.
 */
export function homeReadingOrder(model: ProjectHomeModel): string[] {
  const keys = (list: HomeList<{ key: string }>): string[] => list.shown.map((row) => row.key)
  const releaseKeys = model.release.kind === 'none' ? [] : keys(model.release.features)
  const lanes =
    model.roadmap.total > 0 ? model.roadmap.lanes.map((lane) => `lane:${lane.tier}`) : []
  const wide = [
    ...keys(model.waiting),
    ...releaseKeys,
    ...keys(model.requests),
    ...keys(model.notes)
  ]
  const narrow =
    model.release.kind === 'none'
      ? [
          ...keys(model.threads),
          ...lanes,
          ...keys(model.handoffs),
          ...keys(model.specs),
          ...keys(model.rounds)
        ]
      : [
          ...lanes,
          ...keys(model.threads),
          ...keys(model.handoffs),
          ...keys(model.specs),
          ...keys(model.rounds)
        ]
  return [
    ...(model.releaseCall?.questions.shown.map((question) => question.key) ?? []),
    ...wide,
    ...narrow
  ]
}

function homeList<T>(
  items: readonly T[],
  limit: number,
  more: (hidden: number) => string
): HomeList<T> {
  return { ...cappedList(items, limit, more), total: items.length }
}

function newestFirst<T extends { at: string; key: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (left, right) => compareNewest(left.at, right.at) || left.key.localeCompare(right.key)
  )
}

/** What a feature is, in one line; never its how-to-check steps, never its title again. */
function detailFor(feature: ReleaseFeature): string {
  const line = firstLine(feature.prose)
  return line === feature.title ? '' : line
}

function firstLine(text: string | undefined): string {
  return (
    (text ?? '')
      .trim()
      .split(/\n\s*\n/)[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? ''
  )
}

/** Where a request stands, in three words he reads at a glance. */
export function requestState(run: SerializableRun): NonNullable<HomeRow['state']> {
  if (run.status === 'done' || run.resolvedAt) return { label: 'Finished', tone: 'done' }
  if (run.status === 'in-progress') return { label: 'Started', tone: 'started' }
  return { label: 'Waiting on you', tone: 'you' }
}

/** Notes carry their date in the file name, as every record file does. */
function filenameDate(path: string): string {
  return (path.split(/[\\/]/).pop() ?? '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
}
