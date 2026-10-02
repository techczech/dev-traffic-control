import type { Handoff } from '../../../main/qa/handoffs'
import type { Thread } from '../../../main/qa/types'
import type { SerializableRun } from '../../../shared/ipc'
import { formatDenseDay } from './dateVocabulary'
import type { FeatureRequestRow } from './featureRequests'
import { inlinePlain } from './inlineEmphasis'

/**
 * What a *Waiting on you* row says (ticket 37): the kind of action it is, the
 * title, a count line, and the button that does it. Nothing here decides what
 * is owed — `isRequestOwed`, `isThreadOwed` and `isHandoffReady` still do. This
 * only describes a row that those predicates already let in.
 */

export type WaitingKind = 'answer' | 'test' | 'decide' | 'pickup'
export type WaitingIcon = 'check' | 'release' | 'review' | 'thread' | 'handoff'

/** The row's own words, in the order it reads them. */
export interface WaitingMeta {
  kind: WaitingKind
  icon: WaitingIcon
  /** The tag: Test, Decide, Pick up or Answer. */
  tag: string
  /** The bold start of the count line: "4 checks", "Never picked up". */
  lead: string
  /** The rest of the count line, with its own leading separator. */
  rest: string
  /** A thread's latest entry, one line; `''` for the other kinds. */
  snippet: string
  /** Done out of total, drawn as dots; `null` when the kind counts nothing. */
  progress: { done: number; total: number } | null
  /** The button: always "Open"; the tag beside the title already says what kind of action it is. */
  action: string
  /** Waiting two weeks or more: the age turns red. */
  old: boolean
}

export const WAITING_KIND_ORDER: readonly WaitingKind[] = ['answer', 'test', 'decide', 'pickup']

/** Rows drawn before the closing "N more waiting on you" row. */
export const WAITING_LIMIT = 10

const DAY_MS = 86_400_000
const OLD_DAYS = 14

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Whole calendar days between `at` and `now`; `null` when `at` is not a date. */
export function daysWaiting(at: string, now: Date): number | null {
  const value = new Date(at)
  if (!at || Number.isNaN(value.getTime())) return null
  const day = (date: Date): number =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
  return Math.max(0, day(now) - day(value))
}

/** "20d", "4d", "today", "2mo": how long a row has waited, as drawn. */
export function formatWaited(at: string, now: Date): string {
  const days = daysWaiting(at, now)
  if (days === null) return ''
  if (days === 0) return 'today'
  if (days < 60) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

export function isOldWait(at: string, now: Date): boolean {
  return (daysWaiting(at, now) ?? 0) >= OLD_DAYS
}

/**
 * A request with no title carries its file name as the title. Show it as words:
 * the date dropped, hyphens to spaces, first letter capitalised.
 */
export function humaniseRequestTitle(title: string, path: string): string {
  const base = (path.split(/[\\/]/).pop() ?? '').replace(/\.md$/i, '')
  if (!base || title.replace(/\.md$/i, '') !== base) return title
  const words = base
    .replace(/^\d{4}-\d{2}-\d{2}[-_\s]*/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  if (!words) return title
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function runTitle(run: SerializableRun): string {
  return humaniseRequestTitle(run.request.title, run.request.path)
}

/** ```decision fences in a request's text. */
export function countDecisionFences(markdown: string): number {
  return (markdown.match(/^[ \t]*(`{3,}|~{3,})[ \t]*decision\b/gim) ?? []).length
}

/** Decisions he has picked, from the report's single review item. */
export function decidedFromReport(run: SerializableRun): number {
  const item = run.report?.items[0]
  return (item?.decisions ?? []).filter((decision) => !!decision.choice).length
}

/** One line of a thread's latest entry, marks removed. */
export function entrySnippet(body: string, max = 180): string {
  const text = inlinePlain(
    body
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*]\s+)/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function waitingForRun(run: SerializableRun, at: string, now: Date): WaitingMeta {
  const old = isOldWait(at, now)
  if (run.request.mode === 'doc-review') {
    const total = countDecisionFences(run.request.document?.bodyMarkdown ?? run.request.raw)
    const decided = Math.min(decidedFromReport(run), total)
    return {
      kind: 'decide',
      icon: 'review',
      tag: 'Decide',
      lead: total > 0 ? plural(total, 'decision') : 'A document to review',
      rest: total > 0 ? ` · ${decided} decided` : '',
      snippet: '',
      progress: total > 0 ? { done: decided, total } : null,
      action: 'Open',
      old
    }
  }
  const total = run.request.items.length
  const answered = new Map((run.report?.items ?? []).map((item) => [item.id, item.status]))
  const done = run.request.items.filter(
    (item) => (answered.get(item.id) ?? 'unanswered') !== 'unanswered'
  ).length
  return {
    kind: 'test',
    icon: 'check',
    tag: 'Test',
    lead: total > 0 ? plural(total, 'check') : 'A check to run',
    rest: total > 0 ? ` · ${done} done` : '',
    snippet: '',
    progress: total > 0 ? { done, total } : null,
    action: 'Open',
    old
  }
}

export function waitingForThread(thread: Thread, now: Date): WaitingMeta {
  const latest = thread.entries[thread.entries.length - 1]
  return {
    kind: 'answer',
    icon: 'thread',
    tag: 'Answer',
    lead: '',
    rest: '',
    snippet: entrySnippet(latest?.body ?? ''),
    progress: null,
    action: 'Open',
    old: isOldWait(thread.lastAt, now)
  }
}

/**
 * A feature request waiting on his pick (ticket 38): an Answer row whose count
 * line asks the question, then says where he asked it and what the plan is.
 */
export function waitingForRequest(request: FeatureRequestRow, now: Date): WaitingMeta {
  const first = request.actions[0]
  const asked = request.quotes.find((quote) => quote.where || quote.when)
  const askedPart = asked
    ? ` · you asked ${[asked.where, asked.when].filter(Boolean).join(', ')}`
    : ''
  const planPart = request.plan ? ` · plan: ${entrySnippet(request.plan, 90)}` : ''
  return {
    kind: 'answer',
    icon: 'thread',
    tag: 'Answer',
    lead: first ? `${first.label}?` : 'Your pick?',
    rest: `${askedPart}${planPart}`,
    snippet: '',
    progress: null,
    action: first?.label ?? 'Answer',
    old: isOldWait(request.added, now)
  }
}

export function waitingForHandoff(at: string, now: Date): WaitingMeta {
  return {
    kind: 'pickup',
    icon: 'handoff',
    tag: 'Pick up',
    lead: 'Never picked up',
    rest: at ? ` · written ${formatDenseDay(at, now)}` : '',
    snippet: '',
    progress: null,
    action: 'Open',
    old: isOldWait(at, now)
  }
}

/** A release feature waiting on his verdict. `done` is features already settled. */
export function waitingForFeature(
  at: string,
  now: Date,
  counts: { total: number; done: number }
): WaitingMeta {
  return {
    kind: 'test',
    icon: 'release',
    tag: 'Test',
    lead: plural(counts.total, 'feature'),
    rest: ` · ${counts.done} done`,
    snippet: '',
    progress: { done: counts.done, total: counts.total },
    action: 'Open',
    old: isOldWait(at, now)
  }
}

// --- how the card arranges its rows ------------------------------------------

export type WaitingLayout = 'kind' | 'newest'
export const WAITING_LAYOUTS: readonly WaitingLayout[] = ['kind', 'newest']
export const WAITING_LAYOUT_LABELS: Record<WaitingLayout, string> = {
  kind: 'Group',
  newest: 'Sort'
}
export const WAITING_LAYOUT_STORAGE_KEY = 'dtc.waitingLayout'
export const DEFAULT_WAITING_LAYOUT: WaitingLayout = 'kind'

export function isWaitingLayout(value: unknown): value is WaitingLayout {
  return value === 'kind' || value === 'newest'
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function readWaitingLayout(storage = defaultStorage()): WaitingLayout {
  try {
    const value = storage?.getItem(WAITING_LAYOUT_STORAGE_KEY)
    // beta.3 remembered 'oldest'; the card now only knows newest first.
    if (value === 'oldest') {
      writeWaitingLayout('newest', storage)
      return 'newest'
    }
    return isWaitingLayout(value) ? value : DEFAULT_WAITING_LAYOUT
  } catch {
    return DEFAULT_WAITING_LAYOUT
  }
}

export function writeWaitingLayout(value: WaitingLayout, storage = defaultStorage()): void {
  try {
    storage?.setItem(WAITING_LAYOUT_STORAGE_KEY, value)
  } catch {
    // A store that refuses the write costs him the remembered layout, nothing else.
  }
}

export interface Arrangeable {
  key: string
  at: string
  wait: WaitingMeta
}

export interface WaitingGroup<T> {
  kind: WaitingKind
  label: string
  /** "1 thread", "5 to test": how many are in the group, drawn or not. */
  sub: string
  rows: T[]
}

export interface ArrangedWaiting<T> {
  /** Every row drawn, in drawn order — the keyboard's reading order. */
  shown: T[]
  /** Set in the By kind layout; `null` in Newest first. */
  groups: WaitingGroup<T>[] | null
  hidden: number
  moreLabel: string
}

const GROUP_LABEL: Record<WaitingKind, string> = {
  answer: 'Answer',
  test: 'Test',
  decide: 'Decide',
  pickup: 'Pick up'
}

function groupSub(kind: WaitingKind, count: number): string {
  switch (kind) {
    case 'answer':
      return `${count} to answer`
    case 'test':
      return `${count} to test`
    case 'decide':
      return plural(count, 'review')
    case 'pickup':
      return plural(count, 'handoff')
  }
}

/** Newest first; a row with no date sorts last, then by key so the order is stable. */
function compareNewest(left: Arrangeable, right: Arrangeable): number {
  const a = Date.parse(left.at)
  const b = Date.parse(right.at)
  const aOk = !Number.isNaN(a)
  const bOk = !Number.isNaN(b)
  if (aOk && bOk && a !== b) return b - a
  if (aOk !== bOk) return aOk ? -1 : 1
  return left.key.localeCompare(right.key)
}

export function arrangeWaiting<T extends Arrangeable>(
  rows: readonly T[],
  layout: WaitingLayout,
  limit: number = WAITING_LIMIT
): ArrangedWaiting<T> {
  const ordered =
    layout === 'newest'
      ? [...rows].sort(compareNewest)
      : WAITING_KIND_ORDER.flatMap((kind) =>
          rows.filter((row) => row.wait.kind === kind).sort(compareNewest)
        )
  const shown = ordered.slice(0, Math.max(0, limit))
  const hidden = ordered.length - shown.length
  const groups =
    layout === 'kind'
      ? WAITING_KIND_ORDER.flatMap((kind): WaitingGroup<T>[] => {
          const inGroup = shown.filter((row) => row.wait.kind === kind)
          if (inGroup.length === 0) return []
          const all = ordered.filter((row) => row.wait.kind === kind).length
          return [{ kind, label: GROUP_LABEL[kind], sub: groupSub(kind, all), rows: inGroup }]
        })
      : null
  return {
    shown,
    groups,
    hidden,
    moreLabel: hidden > 0 ? `${hidden} more waiting on you` : ''
  }
}

// --- With your agents ---------------------------------------------------------

export interface AgentMove {
  key: string
  title: string
  at: string
  age: string
  /** "Agent's move · <what the latest entry says>". */
  detail: string
}

export function agentThreadDetail(thread: Thread): string {
  const snippet = entrySnippet(thread.entries[thread.entries.length - 1]?.body ?? '', 110)
  return snippet ? `Agent's move · ${snippet}` : "Agent's move"
}

export function agentHandoffDetail(handoff: Handoff): string {
  const snippet = entrySnippet(handoff.resume ?? '', 110)
  return snippet ? `Agent's move · ${snippet}` : "Agent's move · handoff"
}
