import type { SerializableRun, QaSnapshot } from '../../../shared/ipc'
import type { ItemStatus } from '../../../main/qa/types'
import { runAgeSource } from './format'
import { scopeIncludes } from '../../../shared/windowScope'
import type { WindowScope } from '../../../shared/windowScope'
import {
  hasRequestIdentity,
  requestIdentity,
  legacyRequestIdentity
} from '../../../shared/requestIdentity'

export interface InboxRow {
  run: SerializableRun
  /** The best timestamp available for the row's age label. */
  ageSource: string
  /** Not yet opened (request identity absent from the seen set). */
  isNew: boolean
}

export interface InboxGroup {
  project: string
  rows: InboxRow[]
}

/** The repository-relative request path — the key for seen/archive/tick state. */
export function requestKey(recordRoot: string, path: string): string {
  return requestIdentity(recordRoot, path)
}

export function runRequestKey(recordRoot: string, run: SerializableRun): string {
  return requestIdentity(recordRoot, run.request.path)
}

function rowOf(
  run: SerializableRun,
  identity: string,
  allIdentities: readonly string[],
  seen: ReadonlySet<string>,
  seenLoaded = true
): InboxRow {
  return {
    run,
    ageSource: runAgeSource(run),
    isNew: !seenLoaded || !hasRequestIdentity(seen, identity, allIdentities)
  }
}

/**
 * The Inbox rows: every run that is not done and not archived, grouped by
 * project, newest first within each group (by request-date prefix, then
 * filename). Groups are ordered by their newest row. `seen`/`archived` are
 * app-local basename sets; omitting them hides nothing and
 * marks everything NEW. Legacy basename membership is
 * retained only as the ambiguous-migration read fallback.
 *
 * `scope` is the window's scope, passed in as an argument so the scoping is
 * testable without rendering. Under *All projects* every
 * project's group is shown; in a project, only that project's.
 */
export function inboxRows(
  s: QaSnapshot,
  scope: WindowScope,
  seen: ReadonlySet<string> = new Set(),
  archived: ReadonlySet<string> = new Set(),
  seenLoaded = true
): InboxGroup[] {
  const byProject = new Map<string, InboxRow[]>()
  const allIdentities = s.runs.map((run) => runRequestKey(s.root, run))
  for (const run of s.runs) {
    if (run.resolvedAt) continue
    if (!scopeIncludes(scope, [run.project])) continue
    const identity = runRequestKey(s.root, run)
    if (hasRequestIdentity(archived, identity, allIdentities)) continue
    const row = rowOf(run, identity, allIdentities, seen, seenLoaded)
    const rows = byProject.get(run.project)
    if (rows) rows.push(row)
    else byProject.set(run.project, [row])
  }

  const groups: InboxGroup[] = []
  for (const [project, rows] of byProject) {
    rows.sort(compareRows)
    groups.push({ project, rows })
  }
  groups.sort((a, b) => {
    const byNewest = compareRows(a.rows[0], b.rows[0])
    return byNewest !== 0 ? byNewest : a.project.localeCompare(b.project)
  })
  return groups
}

/** Archived, not-done runs, newest first — the recoverable bin. */
export function archivedRows(
  s: QaSnapshot,
  scope: WindowScope,
  archived: ReadonlySet<string>
): InboxRow[] {
  const rows: InboxRow[] = []
  const allIdentities = s.runs.map((run) => runRequestKey(s.root, run))
  for (const run of s.runs) {
    if (run.resolvedAt) continue
    if (!scopeIncludes(scope, [run.project])) continue
    const identity = runRequestKey(s.root, run)
    if (!hasRequestIdentity(archived, identity, allIdentities)) continue
    rows.push(rowOf(run, identity, allIdentities, new Set()))
  }
  rows.sort(compareRows)
  return rows
}

/** How many not-done runs sit in the inbox and how many are unopened (NEW). */
export function inboxCounts(
  s: QaSnapshot,
  scope: WindowScope,
  seen: ReadonlySet<string>,
  archived: ReadonlySet<string>,
  seenLoaded = true
): { total: number; fresh: number } {
  let total = 0
  let fresh = 0
  const allIdentities = s.runs.map((run) => runRequestKey(s.root, run))
  for (const run of s.runs) {
    if (run.resolvedAt) continue
    if (!scopeIncludes(scope, [run.project])) continue
    const identity = runRequestKey(s.root, run)
    if (hasRequestIdentity(archived, identity, allIdentities)) continue
    total++
    if (!seenLoaded || !hasRequestIdentity(seen, identity, allIdentities)) fresh++
  }
  return { total, fresh }
}

export { legacyRequestIdentity }

/** Newest first: date desc, then filename desc for stable tie-breaking. */
function compareRows(a: InboxRow, b: InboxRow): number {
  if (a.ageSource !== b.ageSource) return a.ageSource < b.ageSource ? 1 : -1
  return a.run.request.path < b.run.request.path ? 1 : -1
}

/**
 * Per-item verdict cells for a run's mini-spine: the report's status by item
 * id, or all `unanswered` when the run has no report yet. A review is one
 * document — its single cell is the disposition (request.items is empty for
 * doc-review, which would otherwise render no spine at all).
 */
export function miniSpineCells(run: SerializableRun): ItemStatus[] {
  if (run.request.mode === 'doc-review') {
    const doc = run.report?.items.find((i) => i.id === 'document')
    return [doc?.status ?? 'unanswered']
  }
  const byId = new Map((run.report?.items ?? []).map((i) => [i.id, i.status]))
  return run.request.items.map((it) => byId.get(it.id) ?? 'unanswered')
}
