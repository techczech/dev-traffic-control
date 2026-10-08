/** Who filed which record, the waiting set and the band count. Pure over what a scan returned and what the store holds. */

import type { Scope } from './paths'
import { whenMs } from './scan'
import type { ScanEntry } from './scan'

/**
 * A record (request, roadmap idea or release record) this mod saw an agent write. Shared across
 * sessions in `$.store`, and used for display only: the pane's "From this session" section and
 * the line saying which session asked. `filedAt` is the time of the latest write of the record.
 */
export type RegistryEntry = { path: string; sessionId: string; project: string; filedAt: number; /** The filing session's label at filing time. */ label?: string }
export type Registry = Record<string, RegistryEntry>

/**
 * The records this session itself filed, kept in its own `$.state` (no other session can write
 * it). Keyed by record path. `filedAt` is the first time this session wrote the record, `lastAt`
 * the latest. `dtc_answers` uses the first time to tell an answer given before the request was
 * filed from one given after.
 */
export type LocalFiling = { project: string; filedAt: number; lastAt?: number }
export type LocalFilings = Record<string, LocalFiling>

/** Records this session's filing; the first filing time is kept when the same record is written again, and the latest noted beside it. */
export function recordLocalFiling(local: LocalFilings, path: string, filing: LocalFiling): LocalFilings {
  const held = local[path]
  const lastAt = Math.max(held?.lastAt ?? held?.filedAt ?? filing.filedAt, filing.lastAt ?? filing.filedAt)
  return { ...local, [path]: { project: filing.project, filedAt: held === undefined ? filing.filedAt : Math.min(held.filedAt, filing.filedAt), lastAt } }
}

/** Records a filing; filing the same path again replaces the entry. */
export function recordFiling(registry: Registry, entry: RegistryEntry): Registry {
  return { ...registry, [entry.path]: entry }
}

export function inScope(entry: { project: string }, scope: Scope): boolean {
  return scope.kind === 'hub' || scope.project === entry.project
}

function newestFirst(a: ScanEntry, b: ScanEntry): number {
  return whenMs(b) - whenMs(a) || (a.rel < b.rel ? -1 : 1)
}

/** Answers waiting in scope (completed, uncollected reports; reviewer entries on ideas; release verdicts), newest first. */
export function waitingSet(entries: readonly ScanEntry[], scope: Scope): ScanEntry[] {
  return entries.filter(e => e.state === 'waiting' && inScope(e, scope)).sort(newestFirst)
}

/** Answer files in scope that could not be read (`state: 'malformed'`): listed, never counted or collected. */
export function unreadableSet(entries: readonly ScanEntry[], scope: Scope): ScanEntry[] {
  return entries.filter(e => e.state === 'malformed' && inScope(e, scope)).sort((a, b) => (a.rel < b.rel ? -1 : 1))
}

/** Opened, not finished: opened with no report, or a report with no `completedAt`. */
export function openedNotFinished(entries: readonly ScanEntry[], scope: Scope): ScanEntry[] {
  return entries.filter(e => (e.state === 'opened' || e.state === 'in-progress') && inScope(e, scope)).sort((a, b) => (a.rel < b.rel ? -1 : 1))
}

/** The band count: the answers waiting in scope. An answer leaves it when the agent writes its receipt. */
export function bandCount(entries: readonly ScanEntry[], scope: Scope): number {
  return waitingSet(entries, scope).length
}
