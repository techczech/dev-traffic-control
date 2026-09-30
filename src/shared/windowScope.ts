/**
 * The window scope: what one window is looking at — one project, or *All
 * projects* (ADR-0016 § 1).
 *
 * The value is tagged, never a nullable slug, because three states have to stay
 * distinct: a window that has never been scoped (no value at all), a window
 * deliberately looking at everything, and a window on a named project. A
 * nullable slug collapses the first two, and they want different behaviour.
 *
 * Nothing here knows about views or history. The scope lives beside the view
 * history, never inside it — a scope popped by the back button is the complaint
 * this design exists to fix.
 */

export type WindowScope = { kind: 'all' } | { kind: 'project'; slug: string }

/** What a window remembers about where it is, persisted per window slot. */
export interface WindowScopeState {
  /** Absent until the window has deliberately been given a scope. */
  scope?: WindowScope
  /** Surface last used inside each project, oldest entry first. */
  lastSurfaceByProject: Record<string, string>
}

export const ALL_PROJECTS: WindowScope = Object.freeze({ kind: 'all' })

/**
 * How many projects' landing surfaces a window remembers. Bounded on purpose:
 * an unbounded map in a persisted file is a slow leak nobody notices until it
 * is large.
 */
export const REMEMBERED_PROJECT_SURFACES = 8

export function isWindowScope(value: unknown): value is WindowScope {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { kind?: unknown; slug?: unknown }
  if (candidate.kind === 'all') return true
  return (
    candidate.kind === 'project' &&
    typeof candidate.slug === 'string' &&
    candidate.slug.trim().length > 0
  )
}

export function sameScope(left: WindowScope | undefined, right: WindowScope | undefined): boolean {
  if (!left || !right) return left === right
  if (left.kind !== right.kind) return false
  return left.kind === 'project' && right.kind === 'project' ? left.slug === right.slug : true
}

/** The project a scope names, or null under *All projects*. */
export function scopeProject(scope: WindowScope | undefined): string | null {
  return scope?.kind === 'project' ? scope.slug : null
}

/**
 * Files a surface under the project it was used in, most recently used last,
 * dropping the least recently used once the cap is reached.
 */
export function rememberProjectSurface(
  remembered: Record<string, string>,
  slug: string,
  surface: string,
  cap = REMEMBERED_PROJECT_SURFACES
): Record<string, string> {
  const withoutSlug = Object.entries(remembered).filter(([project]) => project !== slug)
  const kept = [...withoutSlug, [slug, surface] as const].slice(-Math.max(1, cap))
  return Object.fromEntries(kept)
}

export function normaliseWindowScope(value: unknown): WindowScope | undefined {
  if (!isWindowScope(value)) return undefined
  return value.kind === 'project' ? { kind: 'project', slug: value.slug } : { kind: 'all' }
}

export function normaliseRememberedSurfaces(
  value: unknown,
  cap = REMEMBERED_PROJECT_SURFACES
): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0
  )
  return Object.fromEntries(entries.slice(-Math.max(1, cap)))
}

/**
 * Does a record belonging to `projects` fall inside `scope`?
 *
 * The one place the "does this row belong here" question is answered. Every
 * scoped surface's row builder takes the scope as an argument and asks this,
 * so the scoping is a pure decision testable without rendering — the first
 * installed build had three surfaces that never asked at all.
 *
 * A record with no project (`projects` empty) belongs to no project, so it
 * shows only under *All projects*.
 */
export function scopeIncludes(scope: WindowScope, projects: readonly string[]): boolean {
  if (scope.kind === 'all') return true
  return projects.includes(scope.slug)
}
