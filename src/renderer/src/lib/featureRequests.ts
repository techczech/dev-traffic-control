import type { PoolIdea } from '../../../main/qa/pool'
import { isFeatureRequest, type RequestFate } from '../../../main/qa/featureRequest'
import type { QaSnapshot } from '../../../shared/ipc'
import type { WindowScope } from '../../../shared/windowScope'
import { derivePendingVersion } from './roadmapReleases'
import {
  REQUEST_GROUPS,
  REQUEST_GROUP_LABELS,
  actionsForFate,
  fateLabel,
  groupOfFate,
  isRequestIdeaOwed,
  readEntries,
  releaseOfIdea,
  unansweredReply,
  type RequestAction,
  type RequestEntry,
  type RequestGroup
} from './requestFate'

/**
 * The Feature requests tab as a pure function of the snapshot: every
 * roadmap idea the reviewer said (`by: reviewer`), in the window's scope, grouped by what
 * became of it. Nothing here writes; the answers are written by the card
 * through the existing roadmap idea write.
 */

export interface RequestQuote {
  text: string
  /** "in a test request"; `''` when the file does not say. */
  where: string
  /** "29 Sep"; `''` when the file does not say. */
  when: string
  /** A `dtc://` link to where the reviewer said it, if the file gave one. */
  link: string
}

export interface FeatureRequestRow {
  /** `project/id`: unique across All projects. */
  key: string
  project: string
  id: string
  title: string
  /** `YYYY-MM-DD` the idea was added; `''` when it carries none. */
  added: string
  /** "29 Sep"; `''` when the idea carries no date. */
  addedLabel: string
  fate: RequestFate | undefined
  group: RequestGroup
  fateLabel: string
  plan: string
  context: string
  quotes: RequestQuote[]
  /** The release the plan is aimed at ({@link releaseOfIdea}). */
  release: string
  /** The project's pending release version ({@link derivePendingVersion}); `''` when none. */
  pending: string
  /** "1 Oct": when the reviewer approved it for the Roadmap; `''` when the reviewer has not. */
  approvedLabel: string
  /** The agent's note on the fate: which release, merged into what, why declined. */
  fateNote: string
  related: string[]
  /** No `plan` or no usable `fate`: the agent owes the reviewer one. */
  noPlan: boolean
  /** Waiting on the reviewer, and the reviewer has not answered since the agent last spoke. */
  owed: boolean
  /** The reviewer's last entry when the agent has not answered it yet. */
  answered: RequestEntry | undefined
  entries: RequestEntry[]
  actions: RequestAction[]
  body: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "29 Sep" from `2026-09-29` (the year only when it is not this one). */
export function dayLabel(value: string, now: Date): string {
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!day) return value
  const year = Number(day[1])
  return `${Number(day[3])} ${MONTHS[Number(day[2]) - 1] ?? ''}${year === now.getFullYear() ? '' : ` ${year}`}`
}

/** "in a review", from "a review"; a place already starting "in" is kept. */
export function whereLabel(where: string): string {
  const trimmed = where.trim()
  if (!trimmed) return ''
  return /^in\s/i.test(trimmed) ? trimmed : `in ${trimmed}`
}

/**
 * The agent's note without its leading "in <release>", which the release chip
 * already says: "in 0.4.0-beta.2, installed 30 Sep" reads "installed 30 Sep".
 */
export function noteBesideRelease(note: string): string {
  return note.replace(/^in\s+v?\d\S*?[,.;]?(?:\s+|$)/i, '').trim()
}

function approvedLabelOf(entries: readonly RequestEntry[], now: Date): string {
  const approvals = entries.filter(
    (entry) => entry.by === 'reviewer' && /^approved/i.test(entry.answer)
  )
  const at = approvals[approvals.length - 1]?.at
  return at ? dayLabel(at, now) : ''
}

export function rowForIdea(
  project: string,
  idea: PoolIdea,
  now: Date,
  pending = ''
): FeatureRequestRow {
  const request = idea.request
  const fate = request?.fate
  const entries = readEntries(idea.bodyMarkdown ?? '').entries
  const quotes: RequestQuote[] = (request?.quotes ?? []).map((text, index) => {
    const said =
      request?.said[index] ?? (request?.quotes.length === 1 ? request?.said[0] : undefined)
    return {
      text,
      where: whereLabel(said?.where ?? ''),
      when: said?.when ? dayLabel(said.when, now) : '',
      link: said?.link ?? ''
    }
  })
  // A request with a `said` but no `quote` still shows where the reviewer said it.
  if (quotes.length === 0 && request?.said.length) {
    for (const said of request.said) {
      quotes.push({
        text: '',
        where: whereLabel(said.where),
        when: said.when ? dayLabel(said.when, now) : '',
        link: said.link
      })
    }
  }
  return {
    key: `${project}/${idea.id}`,
    project,
    id: idea.id,
    title: idea.title,
    added: idea.added ?? '',
    addedLabel: idea.added ? dayLabel(idea.added, now) : '',
    fate,
    group: groupOfFate(fate),
    fateLabel: fateLabel(idea, pending),
    plan: request?.plan ?? '',
    context: request?.context ?? '',
    quotes,
    release: releaseOfIdea(idea),
    pending,
    approvedLabel: approvedLabelOf(entries, now),
    fateNote: noteBesideRelease(request?.fateNote ?? ''),
    related: request?.related ?? [],
    noPlan: !request?.plan || !fate,
    owed: isRequestIdeaOwed(idea),
    answered: unansweredReply(entries),
    entries,
    actions: actionsForFate(fate),
    body: idea.bodyMarkdown ?? ''
  }
}

/** Every feature request in `scope`, newest added first. */
export function featureRequestRows(
  snapshot: QaSnapshot | null,
  scope: WindowScope,
  now: Date = new Date(),
  started: Readonly<Record<string, string>> = {}
): FeatureRequestRow[] {
  if (!snapshot) return []
  const rows: FeatureRequestRow[] = []
  for (const pool of snapshot.pools ?? []) {
    if (scope.kind === 'project' && pool.project !== scope.slug) continue
    const pending =
      derivePendingVersion(
        snapshot.releases?.find((release) => release.project === pool.project),
        started[pool.project]
      ) ?? ''
    for (const idea of pool.ideas) {
      if (!isFeatureRequest(idea.request) || idea.state === 'setaside') continue
      rows.push(rowForIdea(pool.project, idea, now, pending))
    }
  }
  return rows.sort(byNewest)
}

function byNewest(left: FeatureRequestRow, right: FeatureRequestRow): number {
  return (
    right.added.localeCompare(left.added) ||
    left.title.localeCompare(right.title) ||
    left.key.localeCompare(right.key)
  )
}

function byOldest(left: FeatureRequestRow, right: FeatureRequestRow): number {
  return (
    left.added.localeCompare(right.added) ||
    left.title.localeCompare(right.title) ||
    left.key.localeCompare(right.key)
  )
}

// --- counts and the list --------------------------------------------------------

export interface RequestTally {
  everything: number
  groups: Record<RequestGroup, number>
  /** Requests still open: the tab's badge. Finished ones are not counted. */
  open: number
  /** Not finished, with no plan or no fate: the banner's number. */
  owedPlan: number
  built: number
  merged: number
  declined: number
}

export function tallyRequests(rows: readonly FeatureRequestRow[]): RequestTally {
  const groups: Record<RequestGroup, number> = {
    waiting: 0,
    none: 0,
    planned: 0,
    finished: 0
  }
  for (const row of rows) groups[row.group] += 1
  return {
    everything: rows.length,
    groups,
    open: rows.length - groups.finished,
    owedPlan: rows.filter((row) => row.group !== 'finished' && row.noPlan).length,
    built: rows.filter((row) => row.fate === 'built').length,
    merged: rows.filter((row) => row.fate === 'merged').length,
    declined: rows.filter((row) => row.fate === 'declined').length
  }
}

export type RequestFilter = 'everything' | RequestGroup

export interface RequestListGroup {
  group: RequestGroup
  label: string
  sub: string
  rows: FeatureRequestRow[]
  /** Finished is folded until opened, unless the filter asks for it. */
  foldable: boolean
}

const GROUP_SUB: Record<RequestGroup, string> = {
  waiting: 'the agent has a plan and needs your pick',
  none: 'the agent owes you a plan for these',
  planned: 'approved; they live on the Roadmap tab now',
  finished: ''
}

function finishedSub(tally: RequestTally): string {
  return [
    tally.built ? `${tally.built} built` : '',
    tally.merged ? `${tally.merged} merged` : '',
    tally.declined ? `${tally.declined} declined` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Rows matching the filter chip, the "no plan" banner and the search words. */
export function filterRequests(
  rows: readonly FeatureRequestRow[],
  filter: RequestFilter,
  query: string
): FeatureRequestRow[] {
  const needle = query.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (filter !== 'everything' && row.group !== filter) return false
    if (!needle) return true
    const haystack = [
      row.title,
      row.plan,
      row.context,
      row.fateLabel,
      row.project,
      ...row.quotes.map((quote) => quote.text)
    ]
      .join('\n')
      .toLocaleLowerCase()
    return haystack.includes(needle)
  })
}

/** The list as drawn: groups in the fixed order, empty ones left out. */
export function groupRequests(
  rows: readonly FeatureRequestRow[],
  tally: RequestTally
): RequestListGroup[] {
  return REQUEST_GROUPS.flatMap((group): RequestListGroup[] => {
    const inGroup = rows.filter((row) => row.group === group)
    if (inGroup.length === 0) return []
    return [
      {
        group,
        label: REQUEST_GROUP_LABELS[group],
        sub: group === 'finished' ? finishedSub(tally) : GROUP_SUB[group],
        // What has waited longest for a plan leads; the rest read newest first.
        rows: [...inGroup].sort(group === 'none' ? byOldest : byNewest),
        foldable: group === 'finished'
      }
    ]
  })
}

/** The banner's sentence, or `''` when nothing is owed. */
export function noPlanBanner(count: number): string {
  return count > 0 ? `${count} without a plan: the agent owes these.` : ''
}

/** The tab bar's number: requests still open under the window's scope. */
export function openRequestCount(snapshot: QaSnapshot, scope: WindowScope): number {
  return tallyRequests(featureRequestRows(snapshot, scope)).open
}
