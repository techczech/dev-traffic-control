import type { QaReport } from '../../../main/qa/types'
import type {
  QaSnapshot,
  ReadingProgress,
  ReadingProgressState,
  SerializableRun
} from '../../../shared/ipc'
import { parseDocBlocks, runsText } from './richtext'
import { runAgeSource } from './format'
import { runRequestKey } from './inbox'
import { scopeIncludes } from '../../../shared/windowScope'
import type { WindowScope } from '../../../shared/windowScope'

export type SpecState = 'Needs your comment' | 'In conversation' | 'Answered' | 'Being written'
export type SpecFilter = 'open' | 'answered' | 'all'

export interface SpecProgressDisplay {
  ratio: number
  phrase: string
  sectionSlug?: string
}

export interface SpecRowModel {
  requestPath: string
  requestKey: string
  app: string
  title: string
  state: SpecState
  openable: boolean
  ageSource: string
  sectionCount: number
  questionCount: number
  commentCount: number
  sectionMarkCount: number
  progress: SpecProgressDisplay
}

export interface SpecQuestionModel {
  key: string
  requestPath: string
  requestKey: string
  app: string
  documentTitle: string
  headingId: string
  headingTitle: string
  sectionIndex: number
  sectionCount: number
  id: string
  question: string
  options: string[]
  context: string
  choice: string
  answered: boolean
}

export interface ResolvedReadingPosition {
  sectionIndex: number
  sectionSlug: string
  sectionTitle: string
  readThrough: boolean
}

/**
 * The reading list. `scope` is the window's scope, passed in as an argument so
 * the scoping is testable without rendering (ADR-0016 § 1) — a document is
 * filed under its record-repo project, which is what a scope names.
 */
export function specRows(
  snapshot: QaSnapshot,
  scope: WindowScope,
  progress: ReadingProgressState
): SpecRowModel[] {
  return snapshot.runs
    .filter(
      (run) =>
        run.request.mode === 'doc-review' && !run.resolvedAt && scopeIncludes(scope, [run.project])
    )
    .map((run) => rowFromRun(snapshot.root, run, progress))
    .sort(compareSpecRows)
}

/** Every review decision, kept contiguous with the document it came from. */
export function specQuestions(snapshot: QaSnapshot, scope: WindowScope): SpecQuestionModel[] {
  return snapshot.runs
    .filter(
      (run) =>
        run.request.mode === 'doc-review' && !run.resolvedAt && scopeIncludes(scope, [run.project])
    )
    .flatMap((run) => questionsFromRun(snapshot.root, run))
}

function questionsFromRun(root: string, run: SerializableRun): SpecQuestionModel[] {
  const document = run.request.document
  if (!document) return []
  const requestKey = runRequestKey(root, run)
  const answerById = new Map(
    (documentItem(run.report)?.decisions ?? []).map((decision) => [decision.id, decision])
  )
  let headingId = ''
  let headingTitle = ''
  let context = ''
  const questions: SpecQuestionModel[] = []

  for (const block of parseDocBlocks(document.bodyMarkdown)) {
    if (block.kind === 'heading') {
      headingId = block.id
      headingTitle = runsText(block.runs)
      context = ''
      continue
    }
    if (block.kind === 'para') {
      context = runsText(block.runs)
      continue
    }
    if (block.kind !== 'decision') continue
    const answer = answerById.get(block.id)
    const choice = answer?.choice ?? ''
    questions.push({
      key: `${requestKey}#${block.id}`,
      requestPath: run.request.path,
      requestKey,
      app: run.request.app?.trim() || run.project,
      documentTitle: run.request.title,
      headingId,
      headingTitle,
      sectionIndex: Math.max(
        0,
        document.headings.findIndex((heading) => heading.id === headingId)
      ),
      sectionCount: document.headings.length,
      id: block.id,
      question: runsText(block.question),
      options: block.options,
      context,
      choice,
      answered: !!choice.trim()
    })
  }
  return questions
}

export function filterSpecRows(
  rows: readonly SpecRowModel[],
  filter: SpecFilter,
  query: string
): SpecRowModel[] {
  const needle = query.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (filter === 'open' && row.state === 'Answered') return false
    if (filter === 'answered' && row.state !== 'Answered') return false
    return !needle || `${row.app}\n${row.title}`.toLocaleLowerCase().includes(needle)
  })
}

export function needsSpecCount(rows: readonly SpecRowModel[]): number {
  return rows.filter((row) => row.state === 'Needs your comment').length
}

const STATE_ORDER: Record<SpecState, number> = {
  'Needs your comment': 0,
  'In conversation': 1,
  'Being written': 2,
  Answered: 3
}

function rowFromRun(
  root: string,
  run: SerializableRun,
  allProgress: ReadingProgressState
): SpecRowModel {
  const document = run.request.document
  const body = document?.bodyMarkdown ?? ''
  const requestKey = runRequestKey(root, run)
  const state = specState(run, body)
  const item = documentItem(run.report)
  const decisions = item?.decisions ?? []
  const answeredDecisionIds = new Set(
    decisions.filter((decision) => decision.choice.trim()).map((decision) => decision.id)
  )
  const questionCount = parseDocBlocks(body).filter(
    (block) => block.kind === 'decision' && !answeredDecisionIds.has(block.id)
  ).length
  return {
    requestPath: run.request.path,
    requestKey,
    app: run.request.app?.trim() || run.project,
    title: run.request.title,
    state,
    openable: state !== 'Being written',
    ageSource: runAgeSource(run),
    sectionCount: document?.headings.length ?? 0,
    questionCount,
    commentCount: item?.quotes.length ?? 0,
    sectionMarkCount: item?.sectionMarks?.length ?? 0,
    progress: progressDisplay(state, document?.headings ?? [], allProgress[requestKey])
  }
}

function specState(run: SerializableRun, body: string): SpecState {
  if (!body.trim()) return 'Being written'
  if (run.report?.completedAt) return 'Answered'
  if (hasReviewFeedback(run.report) && !run.collection) return 'In conversation'
  return 'Needs your comment'
}

function hasReviewFeedback(report: QaReport | null): boolean {
  const item = documentItem(report)
  if (!item) return false
  return (
    item.status !== 'unanswered' ||
    !!item.comment.trim() ||
    item.quotes.length > 0 ||
    (item.sectionMarks?.length ?? 0) > 0 ||
    (item.decisions?.some((decision) => !!decision.choice.trim() || !!decision.comment?.trim()) ??
      false)
  )
}

function documentItem(report: QaReport | null): QaReport['items'][number] | undefined {
  return report?.items.find((item) => item.id === 'document')
}

function progressDisplay(
  state: SpecState,
  headings: NonNullable<SerializableRun['request']['document']>['headings'],
  stored: ReadingProgress | undefined
): SpecProgressDisplay {
  if (state === 'Being written') {
    return { ratio: 0, phrase: 'Not ready to read — it will appear here finished' }
  }
  if (state === 'Answered') return { ratio: 1, phrase: 'Read through' }
  if (!stored || headings.length === 0) return { ratio: 0, phrase: 'Not opened' }
  const resolved = resolveReadingPosition(headings, stored)
  if (!resolved || resolved.readThrough) return { ratio: 1, phrase: 'Read through' }
  return {
    ratio: (resolved.sectionIndex + 1) / headings.length,
    phrase: `Read to “${resolved.sectionTitle}”`,
    sectionSlug: resolved.sectionSlug
  }
}

export function resolveReadingPosition(
  headings: NonNullable<SerializableRun['request']['document']>['headings'],
  stored: ReadingProgress | undefined
): ResolvedReadingPosition | null {
  if (!stored || headings.length === 0) return null
  const exact = headings.findIndex((heading) => heading.id === stored.sectionSlug)
  const index = exact >= 0 ? exact : stored.sectionIndex
  if (index >= headings.length) {
    const last = headings[headings.length - 1]
    return {
      sectionIndex: headings.length - 1,
      sectionSlug: last.id,
      sectionTitle: last.title,
      readThrough: true
    }
  }
  const bestIndex = Math.max(0, index)
  const best = headings[bestIndex]
  return {
    sectionIndex: bestIndex,
    sectionSlug: best.id,
    sectionTitle: best.title,
    readThrough: false
  }
}

function compareSpecRows(a: SpecRowModel, b: SpecRowModel): number {
  const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state]
  if (byState !== 0) return byState
  if (a.ageSource !== b.ageSource) return a.ageSource < b.ageSource ? 1 : -1
  return a.requestPath.localeCompare(b.requestPath)
}
