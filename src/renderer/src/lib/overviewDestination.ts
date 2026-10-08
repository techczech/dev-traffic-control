import type { WindowScope } from '../../../shared/windowScope'

/** The sole choice of content for the first tab. */
export function overviewDestination(
  scope: WindowScope
): { kind: 'fleet' } | { kind: 'project-home'; slug: string } {
  return scope.kind === 'all' ? { kind: 'fleet' } : { kind: 'project-home', slug: scope.slug }
}
