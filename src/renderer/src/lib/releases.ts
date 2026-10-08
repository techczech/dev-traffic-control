import type {
  ProjectRelease,
  ReleaseFeature,
  ReleaseFeatureStatus,
  ReleaseVersion,
  ReleaseVerdict
} from '../../../main/qa/releaseRecords'
import type { PoolIdea, ProjectPool } from '../../../main/qa/pool'
import { compareReleaseVersions } from '../../../shared/releaseVersionOrder'

export const RELEASE_STATE_WORDS = {
  notstarted: 'Not started',
  building: 'Being built',
  built: 'Built and tested',
  you: 'Waiting on you',
  done: 'Done'
} as const satisfies Record<ReleaseFeatureStatus, string>

export type ReleaseStateWord = (typeof RELEASE_STATE_WORDS)[ReleaseFeatureStatus]

export interface ReleaseBoardFeatureRow {
  kind: 'feature'
  id: string
  title: string
  state: ReleaseStateWord
  status: ReleaseFeatureStatus
  prose?: string
  howToCheck?: string
  answerable: boolean
  /** `since:` from the ledger — the day it reached its declared state. */
  since?: string
  answer?: {
    verdict: ReleaseVerdict
    comment: string
    at: string
    /** Project-relative verdict pictures. */
    screenshots?: string[]
  }
}

export interface ReleaseBoardGroundworkRow {
  kind: 'groundwork'
  id: string
  title: string
  prose?: string
  unlocks?: string
  answerable: false
}

export type ReleaseBoardItem = ReleaseBoardFeatureRow | ReleaseBoardGroundworkRow

export interface ReleaseBoardCounts {
  notstarted: number
  building: number
  built: number
  you: number
  done: number
}

interface ReleaseBoardReleaseRow {
  project: string
  app: string
  version: string
  release: string
  needsYou: boolean
  collapsed: boolean
  counts: ReleaseBoardCounts
  features: ReleaseBoardItem[]
  answerable: boolean
  shippable: boolean
}

export type ReleaseBoardRow =
  | (ReleaseBoardReleaseRow & {
      kind: 'recorded'
      updated?: string
      path: string
    })
  | (ReleaseBoardReleaseRow & {
      kind: 'proposed'
      label: 'Proposed'
      answerable: false
      shippable: false
    })
  | {
      kind: 'nothing-recorded'
      project: string
      app: string
    }

export interface ReleaseVersionGroup {
  release: ReleaseVersion
  fixes: ReleaseVersion[]
}

/** Keeps a shipped fix beneath the release named by its shipment record. */
export function groupReleaseVersions(versions: readonly ReleaseVersion[]): ReleaseVersionGroup[] {
  const byVersion = new Map(versions.map((version) => [version.version, version]))
  const fixes = new Map<string, ReleaseVersion[]>()
  const releases: ReleaseVersion[] = []

  for (const version of versions) {
    const parent = version.shipment?.fixesTo
    if (parent && byVersion.has(parent)) {
      const grouped = fixes.get(parent) ?? []
      grouped.push(version)
      fixes.set(parent, grouped)
    } else {
      releases.push(version)
    }
  }

  releases.sort((left, right) => compareReleaseVersions(right.version, left.version))
  return releases.map((release) => ({
    release,
    fixes: [...(fixes.get(release.version) ?? [])].sort((left, right) =>
      compareReleaseVersions(right.version, left.version)
    )
  }))
}

/** Turns the main process's per-project release records into the board's four row cases. */
export function releaseBoardRows(
  releases: readonly ProjectRelease[],
  pools: readonly ProjectPool[] = []
): ReleaseBoardRow[] {
  return releases.flatMap((release) => toBoardRows(release, pools)).sort(compareBoardRows)
}

function toBoardRows(release: ProjectRelease, pools: readonly ProjectPool[]): ReleaseBoardRow[] {
  if (release.kind === 'nothing-recorded') {
    const proposed = proposedRowsFor(release.project, release.project, pools, new Set())
    return proposed.length > 0
      ? proposed
      : [{ kind: 'nothing-recorded', project: release.project, app: release.project }]
  }

  const declaredReleaseNames = new Set(
    release.versions.flatMap((version) =>
      [version.version, version.record.release].filter(
        (candidate): candidate is string => !!candidate?.trim()
      )
    )
  )
  return [
    toRecordedBoardRow(release, pools),
    ...proposedRowsFor(
      release.project,
      release.record.app?.trim() || release.project,
      pools,
      declaredReleaseNames
    )
  ]
}

function toRecordedBoardRow(
  release: Extract<ProjectRelease, { kind: 'recorded' }>,
  pools: readonly ProjectPool[]
): Extract<ReleaseBoardRow, { kind: 'recorded' }> {
  const declaredIds = new Set(release.record.features.map((feature) => feature.id))
  const features = [
    ...release.record.features.map(toFeatureRow),
    ...promotedIdeasFor(release, pools)
      .filter((idea) => !declaredIds.has(idea.id))
      .map(toPromotedFeatureRow)
  ]
  const counts = emptyCounts()
  for (const feature of features) {
    if (feature.kind === 'feature') counts[feature.status] += 1
  }
  const featureRows = features.filter(
    (feature): feature is ReleaseBoardFeatureRow => feature.kind === 'feature'
  )

  return {
    kind: 'recorded',
    project: release.project,
    app: release.record.app?.trim() || release.project,
    version: release.record.version,
    release: release.record.release?.trim() || release.record.version,
    updated: release.record.updated,
    path: release.record.path,
    needsYou: counts.you > 0,
    collapsed: featureRows.length > 0 && featureRows.every((feature) => feature.status === 'done'),
    counts,
    features,
    answerable: featureRows.some((feature) => feature.answerable),
    shippable: release.inFlightVersion === release.record.version
  }
}

function proposedRowsFor(
  project: string,
  app: string,
  pools: readonly ProjectPool[],
  declaredReleaseNames: ReadonlySet<string>
): Array<Extract<ReleaseBoardRow, { kind: 'proposed' }>> {
  const byVersion = new Map<string, PoolIdea[]>()
  const ideas = pools.find((pool) => pool.project === project)?.ideas ?? []
  for (const idea of ideas) {
    const version = idea.candidateRelease?.trim()
    if (idea.state !== 'promoted' || !version || declaredReleaseNames.has(version)) continue
    const grouped = byVersion.get(version) ?? []
    grouped.push(idea)
    byVersion.set(version, grouped)
  }

  return [...byVersion.entries()].map(([version, promotedIdeas]) => {
    const features = promotedIdeas.map(toPromotedFeatureRow)
    const counts = emptyCounts()
    counts.notstarted = features.length
    return {
      kind: 'proposed',
      project,
      app,
      version,
      release: version,
      label: 'Proposed',
      needsYou: false,
      collapsed: false,
      counts,
      features,
      answerable: false,
      shippable: false
    }
  })
}

function promotedIdeasFor(
  release: Extract<ProjectRelease, { kind: 'recorded' }>,
  pools: readonly ProjectPool[]
): PoolIdea[] {
  const releaseNames = new Set(
    [release.record.version, release.record.release].filter(
      (candidate): candidate is string => !!candidate?.trim()
    )
  )
  return (
    pools
      .find((pool) => pool.project === release.project)
      ?.ideas.filter(
        (idea) =>
          idea.state === 'promoted' &&
          !!idea.candidateRelease &&
          releaseNames.has(idea.candidateRelease)
      ) ?? []
  )
}

function toPromotedFeatureRow(idea: PoolIdea): ReleaseBoardFeatureRow {
  return {
    kind: 'feature',
    id: idea.id,
    title: idea.title,
    status: 'notstarted',
    state: RELEASE_STATE_WORDS.notstarted,
    ...(idea.bodyMarkdown ? { prose: idea.bodyMarkdown } : {}),
    answerable: false
  }
}

function toFeatureRow(feature: ReleaseFeature): ReleaseBoardItem {
  if (feature.kind === 'groundwork') {
    return {
      kind: 'groundwork',
      id: feature.id,
      title: feature.title,
      ...(feature.prose ? { prose: feature.prose } : {}),
      ...(feature.unlocks ? { unlocks: feature.unlocks } : {}),
      answerable: false
    }
  }

  const status = feature.status ?? feature.declaredState ?? 'notstarted'
  return {
    kind: 'feature',
    id: feature.id,
    title: feature.title,
    status,
    state: RELEASE_STATE_WORDS[status],
    ...(feature.prose ? { prose: feature.prose } : {}),
    ...(feature.howToCheck ? { howToCheck: feature.howToCheck } : {}),
    answerable: feature.declaredState === 'you',
    ...(feature.since ? { since: feature.since } : {}),
    ...(feature.answer
      ? {
          answer: {
            verdict: feature.answer.verdict,
            comment: feature.answer.comment,
            at: feature.answer.at,
            ...(feature.answer.screenshots?.length
              ? { screenshots: feature.answer.screenshots }
              : {})
          }
        }
      : {})
  }
}

/**
 * When a feature reached the state its row shows: the later of
 * the ledger's `since:` and the answer's time, because an answer changes the
 * state too. A bare `since:` day counts as the start of that day where the reviewer is;
 * on a tie the `since:` day is kept. Either alone is used as it is; neither is
 * `''`. Never the record's `updated`, which dates the ledger, not the feature.
 */
export function featureReachedAt(feature: { since?: string; answer?: { at: string } }): string {
  const since = feature.since ?? ''
  const at = feature.answer?.at ?? ''
  if (!since || !at) return since || at
  const sinceTime = instant(since)
  const atTime = instant(at)
  if (Number.isNaN(atTime)) return since
  if (Number.isNaN(sinceTime)) return at
  return atTime > sinceTime ? at : since
}

function instant(value: string): number {
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime()
    : new Date(value).getTime()
}

function emptyCounts(): ReleaseBoardCounts {
  return { notstarted: 0, building: 0, built: 0, you: 0, done: 0 }
}

function compareBoardRows(left: ReleaseBoardRow, right: ReleaseBoardRow): number {
  const leftNeedsYou = left.kind === 'recorded' && left.needsYou
  const rightNeedsYou = right.kind === 'recorded' && right.needsYou
  if (leftNeedsYou !== rightNeedsYou) return leftNeedsYou ? -1 : 1
  const appOrder = left.app.localeCompare(right.app)
  if (appOrder !== 0) return appOrder
  if (left.kind === 'nothing-recorded') return 1
  if (right.kind === 'nothing-recorded') return -1
  return compareReleaseVersions(right.version, left.version)
}
