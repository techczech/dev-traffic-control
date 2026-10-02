import type { ProjectListPresentation } from './railVisibility'

/**
 * Ticket 23 (ADR-0016 amendment 2026-09-25). Project focus mode and project quick browsing mode
 * were two modes in one and must be very different.
 *
 * - Browse (wide only): the project list runs full height on the left, and the
 *   project name and tabs sit in the pane beside it.
 * - Focus: no list; the project name and tabs are in the title bar.
 * - A narrow window is always focus mode: the list is its own front page, and
 *   the tabs keep their own row because the title bar has no room for them.
 */
export type ListMode = 'browse' | 'focus'

export interface ShellLayout {
  /** The list sits beside the content. */
  rail: boolean
  /** Where the project name and the six tabs go. */
  header: 'pane' | 'titlebar' | 'titlebar-row'
  /** The list button (browse ⇄ focus) exists only where both modes can. */
  listToggle: boolean
}

export function shellLayout(presentation: ProjectListPresentation, mode: ListMode): ShellLayout {
  if (presentation !== 'rail') return { rail: false, header: 'titlebar-row', listToggle: false }
  return mode === 'browse'
    ? { rail: true, header: 'pane', listToggle: true }
    : { rail: false, header: 'titlebar', listToggle: true }
}
