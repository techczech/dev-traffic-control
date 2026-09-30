import { dashLabel } from './dashLabel'
import type { QaSnapshot } from '../../../shared/ipc'
import type { WindowScope } from '../../../shared/windowScope'
import type { View } from '../state/app'
import { projectDisplayName } from './projectStanding'

const APP = 'Dev Traffic Control'

/**
 * The macOS window title.
 *
 * Links open new windows, so windows accumulate and a title that reads
 * "Dev Traffic Control" on every one of them tells Dominik nothing in the
 * Window menu, in Mission Control, or when hovering the Dock. The title names
 * what this particular window is holding: the app, the project it is scoped
 * to, and the thing open inside it.
 *
 * Kept pure and in the renderer because only the renderer knows the scope and
 * the view. Electron takes the window title from `document.title`, so setting
 * it here is the whole mechanism — no IPC, and no second source of truth.
 */
export function windowTitle(
  scope: WindowScope | null,
  view: View,
  snapshot: QaSnapshot | null,
  onFrontPage: boolean
): string {
  const parts = [APP]

  if (onFrontPage) return `${APP} — Projects`

  if (scope?.kind === 'project') {
    // Dev Traffic Control keeps its own records, so its project is named after
    // the app. Without this the title reads "Dev Traffic Control — Dev Traffic
    // Control — …", which is the one project where the title is least useful.
    const project = projectDisplayName(snapshot?.releases, scope.slug)
    if (project !== APP) parts.push(project)
  } else if (scope?.kind === 'all') {
    parts.push('All projects')
  }

  const open = openThing(view, snapshot, scope)
  if (open) parts.push(open)

  return parts.join(' — ')
}

/** What this window has open, in Dominik's words rather than the view's kind. */
function openThing(
  view: View,
  snapshot: QaSnapshot | null,
  scope: WindowScope | null
): string | null {
  switch (view.kind) {
    case 'runner': {
      const run = snapshot?.runs.find((candidate) => candidate.request.path === view.path)
      return run?.request.title ?? 'Request'
    }
    case 'note': {
      if (!('path' in view)) return 'New note'
      const note = snapshot?.notes.find((candidate) => candidate.path === view.path)
      return note?.title ?? 'Note'
    }
    case 'thread':
      return 'Thread'
    case 'dashboard':
      return dashLabel(scope)
    case 'inbox':
      return 'Inbox'
    case 'specs':
      return 'Specs'
    case 'releases':
      return 'Releases'
    case 'roadmap':
      return 'Roadmap'
    case 'handoffs':
      return 'Handoffs'
    case 'settings':
      return 'Settings'
    case 'get-started':
      return 'Get started'
    default:
      return null
  }
}

/**
 * The build marker, short enough to sit in the footer without shouting.
 *
 * Dominik, 2026-09-13: "move the app version to smaller in footer … no need
 * for v or alpha just 0.21.0-a.3". So `0.21.0-alpha.4` reads `0.21.0-a.4`, and
 * a plain release keeps its bare number.
 */
export function shortVersion(version: string): string {
  return version
    .replace(/-alpha\./, '-a.')
    .replace(/-beta\./, '-b.')
    .replace(/^v/, '')
}
