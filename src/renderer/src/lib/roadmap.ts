import type { QaSnapshot, SerializableRun } from '../../../shared/ipc'
import type {
  DecisionAnswer,
  PictureMarkup,
  FlagEntry,
  ItemStatus,
  Observation,
  QaReport,
  QuoteEntry,
  ReportItem,
  SectionMark,
  Thread
} from '../../../main/qa/types'
import { miniSpineCells, runRequestKey } from './inbox'
import { hasRequestIdentity } from '../../../shared/requestIdentity'
import { runAgeSource } from './format'
import { answeredCount } from './runnerState'
import { scopeIncludes } from '../../../shared/windowScope'
import type { WindowScope } from '../../../shared/windowScope'

// The roadmap surfaces (ADR-0010 hi-fi) read from the thread record plus the
// existing runs. Anything needing git/session harvest (investment, output,
// commit counts) is slice 3 — these helpers expose only what is real and let
// the UI degrade honestly, never inventing a number.

export const UNFILED = '_unfiled'

/** Open threads belonging to one app surface, newest movement first. */
export function threadsForProject(threads: readonly Thread[], project: string): Thread[] {
  return threads
    .filter(
      (thread) =>
        thread.state !== 'retired' &&
        (thread.projects.length > 0 ? thread.projects : [UNFILED]).includes(project)
    )
    .sort(
      (left, right) => right.lastAt.localeCompare(left.lastAt) || left.id.localeCompare(right.id)
    )
}

export interface ReportWorkEvidence {
  hasWork: boolean
  statuses: number
  comments: number
  flags: number
  quotes: number
  sectionMarks: number
  decisions: number
  screenshots: number
  observations: number
  noteFiles: number
}

type MutableEvidence = Omit<ReportWorkEvidence, 'hasWork'>
type EvidenceClassifiers<Entry> = {
  [Key in keyof Entry]-?: (entry: Entry, evidence: MutableEvidence) => void
}
type ItemEvidenceClassifiers = EvidenceClassifiers<ReportItem>
type ReportEvidenceClassifiers = EvidenceClassifiers<QaReport>

const ignoresItemField = (): void => undefined
const ignoresReportField = (): void => undefined
const ignoresNestedField = (): void => undefined
const hasText = (value: string | undefined): boolean => !!value?.trim()

const FLAG_ENTRY_EVIDENCE: EvidenceClassifiers<FlagEntry> = {
  expectedIndex: ignoresNestedField,
  text: ignoresNestedField,
  comment: (flag, evidence) => {
    if (hasText(flag.comment)) evidence.comments += 1
  }
}

const QUOTE_ENTRY_EVIDENCE: EvidenceClassifiers<QuoteEntry> = {
  text: ignoresNestedField,
  comment: (quote, evidence) => {
    if (hasText(quote.comment)) evidence.comments += 1
  },
  section: ignoresNestedField,
  number: ignoresNestedField
}

const SECTION_MARK_EVIDENCE: EvidenceClassifiers<SectionMark> = {
  section: ignoresNestedField,
  comment: (mark, evidence) => {
    if (hasText(mark.comment)) evidence.comments += 1
  }
}

/** A marked-up picture (ticket 30) is a picture he made; each typed note is a comment. */
function considerMarkups(markups: PictureMarkup[] | undefined, evidence: MutableEvidence): void {
  for (const markup of markups ?? []) {
    evidence.screenshots += 1
    evidence.comments += markup.marks.filter((mark) => hasText(mark.text)).length
  }
}

const DECISION_ANSWER_EVIDENCE: EvidenceClassifiers<DecisionAnswer> = {
  id: ignoresNestedField,
  question: ignoresNestedField,
  choice: (decision, evidence) => {
    if (hasText(decision.choice)) evidence.decisions += 1
  },
  comment: (decision, evidence) => {
    if (hasText(decision.comment)) evidence.comments += 1
  },
  markups: (decision, evidence) => considerMarkups(decision.markups, evidence)
}

const OBSERVATION_EVIDENCE: EvidenceClassifiers<Observation> = {
  id: ignoresNestedField,
  text: (observation, evidence) => {
    if (hasText(observation.text)) evidence.observations += 1
  },
  screenshots: (observation, evidence) => {
    if (!hasText(observation.text) && observation.screenshots.length > 0) {
      evidence.observations += 1
    }
  },
  markups: (observation, evidence) => considerMarkups(observation.markups, evidence)
}

function considerNested<Entry>(
  entry: Entry,
  evidence: MutableEvidence,
  classifiers: EvidenceClassifiers<Entry>
): void {
  for (const key of Object.keys(classifiers) as Array<keyof Entry>) {
    classifiers[key](entry, evidence)
  }
}

/**
 * Every ReportItem field is classified here. The mapped type is deliberately
 * exhaustive: adding a field to ReportItem fails typecheck until this map says
 * whether the field is evidence. Each nested evidence object has the same
 * exhaustive classifier boundary.
 */
const REPORT_ITEM_EVIDENCE: ItemEvidenceClassifiers = {
  id: ignoresItemField,
  title: ignoresItemField,
  status: (item, evidence) => {
    if (item.status !== 'unanswered') evidence.statuses += 1
  },
  comment: (item, evidence) => {
    if (hasText(item.comment)) evidence.comments += 1
  },
  flagged: (item, evidence) => {
    evidence.flags += item.flagged.length
    for (const flag of item.flagged) {
      considerNested(flag, evidence, FLAG_ENTRY_EVIDENCE)
    }
  },
  quotes: (item, evidence) => {
    evidence.quotes += item.quotes.length
    for (const quote of item.quotes) {
      considerNested(quote, evidence, QUOTE_ENTRY_EVIDENCE)
    }
  },
  screenshots: (item, evidence) => {
    evidence.screenshots += item.screenshots.length
  },
  sectionMarks: (item, evidence) => {
    evidence.sectionMarks += item.sectionMarks?.length ?? 0
    for (const mark of item.sectionMarks ?? []) {
      considerNested(mark, evidence, SECTION_MARK_EVIDENCE)
    }
  },
  decisions: (item, evidence) => {
    // An undecided answer counts only for the pictures he marked up on it.
    const worked =
      item.decisions?.filter(
        (decision) => hasText(decision.choice) || (decision.markups?.length ?? 0) > 0
      ) ?? []
    for (const decision of worked) {
      considerNested(decision, evidence, DECISION_ANSWER_EVIDENCE)
    }
  },
  markups: (item, evidence) => considerMarkups(item.markups, evidence),
  removed: ignoresItemField
}

function considerItem(item: ReportItem, evidence: MutableEvidence): void {
  for (const consider of Object.values(REPORT_ITEM_EVIDENCE)) consider(item, evidence)
}

/**
 * Every QaReport field is classified here for the same reason. Lifecycle and
 * identity fields are explicitly non-evidence; observations, linked notes and
 * item fields are the run-level evidence channels.
 */
const QA_REPORT_EVIDENCE: ReportEvidenceClassifiers = {
  id: ignoresReportField,
  title: ignoresReportField,
  app: ignoresReportField,
  version: ignoresReportField,
  build: ignoresReportField,
  startedAt: ignoresReportField,
  completedAt: ignoresReportField,
  noteFiles: (report, evidence) => {
    evidence.noteFiles += report.noteFiles.filter(hasText).length
  },
  mode: ignoresReportField,
  observations: (report, evidence) => {
    for (const observation of report.observations ?? []) {
      considerNested(observation, evidence, OBSERVATION_EVIDENCE)
    }
  },
  observationSeq: ignoresReportField,
  items: (report, evidence) => {
    for (const item of report.items) considerItem(item, evidence)
  }
}

/** One report-wide answer to “has the reviewer done work here, and in which channels?” */
export function reportWorkEvidence(report: QaReport | null | undefined): ReportWorkEvidence {
  const evidence: MutableEvidence = {
    statuses: 0,
    comments: 0,
    flags: 0,
    quotes: 0,
    sectionMarks: 0,
    decisions: 0,
    screenshots: 0,
    observations: 0,
    noteFiles: 0
  }
  if (report) {
    for (const consider of Object.values(QA_REPORT_EVIDENCE)) consider(report, evidence)
  }
  return {
    hasWork: Object.values(evidence).some((count) => count > 0),
    ...evidence
  }
}

export type RunRowStateName =
  | 'unknown'
  | 'never-opened'
  | 'opened'
  | 'part-answered'
  | 'all-answered'
  | 'report-error'
  | 'finished'

export type RunRowShape = 'degraded' | 'parked-only'

export interface RunRowState {
  state: RunRowStateName
  shape?: RunRowShape
  answered: number
  total: number
  completedAt: string | null
  evidence?: ReportWorkEvidence
  reviewDisposition?: ItemStatus
  collectionAgent?: string
  collectionTracking?: boolean
}

/**
 * The history a run row can state without opening the run. Progress counts
 * only the request's checks: materialised `also-` items remain optional
 * reference and never inflate the check count (ADR-0011 §4).
 */
export function runRowState(
  run: SerializableRun,
  seen: ReadonlySet<string>,
  seenLoaded: boolean,
  identityContext: {
    root: string
    runs: readonly SerializableRun[]
    receiptsStartAt?: string
  }
): RunRowState {
  const report = run.report
  const review = run.request.mode === 'doc-review'
  const total = review ? 1 : run.request.degraded ? 0 : run.request.items.length
  if (run.reportError) {
    return { state: 'report-error', answered: 0, total, completedAt: null }
  }
  const document = review ? report?.items.find((item) => item.id === 'document') : undefined
  const checkIds = new Set(review ? ['document'] : run.request.items.map((item) => item.id))
  const answered = report
    ? answeredCount({
        ...report,
        items: report.items.filter((item) => checkIds.has(item.id))
      })
    : 0
  const completedAt = report?.completedAt ?? null
  const reviewDisposition = document?.status ?? ('unanswered' as ItemStatus)
  const dispositionSet = reviewDisposition !== 'unanswered'
  const evidence = reportWorkEvidence(report)
  const evidenceNeedsDetail =
    evidence.hasWork &&
    (evidence.statuses !== answered ||
      evidence.comments > 0 ||
      evidence.flags > 0 ||
      evidence.quotes > 0 ||
      evidence.sectionMarks > 0 ||
      evidence.decisions > 0 ||
      evidence.screenshots > 0 ||
      evidence.observations > 0 ||
      evidence.noteFiles > 0)
  const evidenceFields = evidenceNeedsDetail ? { evidence } : {}
  const shape: RunRowShape | undefined = run.request.degraded
    ? 'degraded'
    : !review && run.request.items.length === 0 && run.request.parked.length > 0
      ? 'parked-only'
      : undefined
  const shapeFields = shape ? { shape } : {}
  const reviewFields = review
    ? {
        ...(completedAt || dispositionSet ? { reviewDisposition } : {})
      }
    : {}

  if (completedAt) {
    const collectionTracking =
      !review &&
      !!identityContext.receiptsStartAt &&
      Date.parse(completedAt) > Date.parse(identityContext.receiptsStartAt)
    return {
      state: 'finished',
      answered,
      total,
      completedAt,
      ...shapeFields,
      ...evidenceFields,
      ...reviewFields,
      ...(collectionTracking ? { collectionTracking } : {}),
      ...(collectionTracking && run.collection ? { collectionAgent: run.collection.agent } : {})
    }
  }
  if (total > 0 && answered === total) {
    return {
      state: 'all-answered',
      answered,
      total,
      completedAt,
      ...shapeFields,
      ...evidenceFields,
      ...reviewFields
    }
  }
  if (evidence.hasWork) {
    return {
      state: 'part-answered',
      answered,
      total,
      completedAt,
      ...shapeFields,
      ...evidenceFields,
      ...reviewFields
    }
  }
  const identity = runRequestKey(identityContext.root, run)
  const allIdentities = identityContext.runs.map((candidate) =>
    runRequestKey(identityContext.root, candidate)
  )
  if (report || hasRequestIdentity(seen, identity, allIdentities)) {
    return { state: 'opened', answered, total, completedAt, ...shapeFields, ...reviewFields }
  }
  if (!seenLoaded) {
    return { state: 'unknown', answered, total, completedAt, ...shapeFields, ...reviewFields }
  }
  return { state: 'never-opened', answered, total, completedAt, ...shapeFields }
}

/** The best available real timestamp/date that drives a run's age. */
export function runAge(run: SerializableRun): string {
  return runAgeSource(run)
}

function openRuns(s: QaSnapshot): SerializableRun[] {
  // Chat-resolved requests (an agent wrote a .resolved.md marker) leave the
  // queue just like done ones — resurrectable by deleting the marker.
  return s.runs.filter((r) => r.status !== 'done' && !r.resolvedAt)
}

// ---- Dashboard: Waiting on you -------------------------------------------

export interface WaitItem {
  key: string
  title: string
  context?: string
  projects: string[]
  formLabel: string
  formClass: '' | 'graft' | 'sq' | 'strut'
  age: string // ISO/date for the shared date vocabulary
  cold: boolean
  runState?: RunRowState
  runCells?: ItemStatus[]
  target: { kind: 'runner'; path: string } | { kind: 'thread'; project: string; thread: string }
}

const FORM_CLASS: Record<string, WaitItem['formClass']> = {
  sidequest: 'sq',
  graft: 'graft',
  strut: 'strut'
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function threadContext(t: Thread): string {
  const last = t.entries[t.entries.length - 1]
  const line =
    (last?.body ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  return line.length > 140 ? line.slice(0, 140) + '…' : line
}

/**
 * What is blocked on the reviewer: open test/review requests (a request waiting is,
 * by definition, waiting on him) plus threads whose move is `me`. Oldest first
 * — the stalest thing needs unblocking most (the cabinet-rescue lesson).
 *
 * `scope` is the window's scope, passed in rather than read from a context so
 * the scoping can be tested without rendering anything (ADR-0016 § 1).
 */
export function waitingOnYou(
  s: QaSnapshot,
  scope: WindowScope,
  now: Date = new Date(),
  seen: ReadonlySet<string> = new Set(),
  seenLoaded = true
): WaitItem[] {
  const items: WaitItem[] = []

  for (const r of openRuns(s)) {
    if (!scopeIncludes(scope, [r.project])) continue
    const review = r.request.mode === 'doc-review'
    items.push({
      key: `run:${r.request.path}`,
      title: r.request.title,
      projects: [r.project],
      formLabel: review ? 'Review' : 'Test',
      formClass: '',
      age: runAge(r),
      cold: false,
      runState: runRowState(r, seen, seenLoaded, {
        root: s.root,
        runs: s.runs,
        receiptsStartAt: s.receiptsStartAt
      }),
      runCells: miniSpineCells(r),
      target: { kind: 'runner', path: r.request.path }
    })
  }

  for (const t of s.threads) {
    if (t.state === 'retired' || t.move !== 'me') continue
    if (!scopeIncludes(scope, t.projects.length ? t.projects : [UNFILED])) continue
    items.push({
      key: `thread:${t.id}`,
      title: t.title,
      context: threadContext(t),
      projects: t.projects.length ? t.projects : [UNFILED],
      formLabel: cap(t.form),
      formClass: FORM_CLASS[t.form] ?? '',
      age: t.lastAt,
      cold: t.cold,
      target: { kind: 'thread', project: t.projects[0] ?? UNFILED, thread: t.id }
    })
  }

  return items.sort((a, b) => ageMs(a.age, now) - ageMs(b.age, now)).reverse()
}

function ageMs(iso: string, now: Date): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : now.getTime() - t
}

// ---- Dashboard: Project vitals -------------------------------------------

export interface ProjectVital {
  project: string
  you: number // open items whose move is on the reviewer
  agents: number // open items whose move is on an agent
  lastAt: string // most recent activity ISO/date ('' if unknown)
  cold: boolean
  openThreads: number
  // Investment/output are slice-3 harvest — deliberately absent here so the UI
  // shows "—", never a fabricated bar or commit count.
}

export function projectVitals(
  s: QaSnapshot,
  scope: WindowScope,
  now: Date = new Date()
): ProjectVital[] {
  const map = new Map<string, ProjectVital>()
  const get = (p: string): ProjectVital => {
    let v = map.get(p)
    if (!v) {
      v = { project: p, you: 0, agents: 0, lastAt: '', cold: false, openThreads: 0 }
      map.set(p, v)
    }
    return v
  }

  for (const p of s.projects) if (scopeIncludes(scope, [p])) get(p)

  for (const r of openRuns(s)) {
    if (!scopeIncludes(scope, [r.project])) continue
    const v = get(r.project)
    v.you += 1 // a waiting/in-progress request is on the reviewer
    const a = runAge(r)
    if (a > v.lastAt) v.lastAt = a
  }

  for (const t of s.threads) {
    if (t.state === 'retired') continue
    for (const p of t.projects.length ? t.projects : [UNFILED]) {
      if (!scopeIncludes(scope, [p])) continue
      const v = get(p)
      v.openThreads += 1
      if (t.move === 'me') v.you += 1
      else if (t.move === 'agent') v.agents += 1
      if (t.lastAt > v.lastAt) v.lastAt = t.lastAt
    }
  }

  const COLD_MS = 7 * 24 * 60 * 60 * 1000
  const vitals = [...map.values()]
  for (const v of vitals) v.cold = !!v.lastAt && ageMs(v.lastAt, now) >= COLD_MS
  // Busiest first: things needing the reviewer, then recency.
  return vitals.sort((a, b) => b.you - a.you || (a.lastAt < b.lastAt ? 1 : -1))
}

// ---- Dashboard: Ready to dispatch ----------------------------------------

/** Open threads whose move is an agent — ready to hand off. Newest first. */
export function readyToDispatch(s: QaSnapshot, scope: WindowScope): Thread[] {
  return s.threads
    .filter(
      (t) =>
        t.state !== 'retired' &&
        t.move === 'agent' &&
        scopeIncludes(scope, t.projects.length ? t.projects : [UNFILED])
    )
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
}

// ---- Dashboard: Recent movement ------------------------------------------

export interface Movement {
  key: string
  title: string
  meta: string // "project · age"
  at: string
  kind: 'ship' | 'entry' | 'report'
  runState?: RunRowState
  runCells?: ItemStatus[]
  target?: { kind: 'runner'; path: string }
}

export function recentMovement(s: QaSnapshot, scope: WindowScope, limit = 6): Movement[] {
  const items: Movement[] = []
  for (const t of s.threads) {
    if (!scopeIncludes(scope, t.projects.length ? t.projects : [UNFILED])) continue
    for (const e of t.entries) {
      items.push({
        key: `entry:${e.path}`,
        title: e.title ?? t.title,
        meta: `${t.projects[0] ?? UNFILED}`,
        at: e.at,
        kind: 'entry'
      })
    }
  }
  for (const r of s.runs) {
    if (!scopeIncludes(scope, [r.project])) continue
    if (r.status === 'done' && r.report?.completedAt) {
      items.push({
        key: `done:${r.request.path}`,
        title: r.request.title,
        meta: r.project,
        at: r.report.completedAt,
        kind: 'report',
        runState: runRowState(r, new Set(), true, {
          root: s.root,
          runs: s.runs,
          receiptsStartAt: s.receiptsStartAt
        }),
        runCells: miniSpineCells(r),
        target: { kind: 'runner', path: r.request.path }
      })
    }
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit)
}
