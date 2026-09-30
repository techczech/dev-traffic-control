import type { ItemStatus, QaRequest } from '../../../main/qa/types'

export type RunnerSurface = 'review' | 'degraded' | 'light' | 'test'

export interface LightVerdictPresentation {
  rowClass: string
  chip: string | null
  title: string | undefined
}

export interface LightRunLayout {
  showChecks: boolean
  showEverythingWorks: boolean
}

export interface LightRunShortcut {
  keys: readonly string[]
  label: string
  short: string
  hint: boolean
  requiresChecks?: boolean
  requiresDetail?: boolean
}

export const LIGHT_RUN_SHORTCUTS: readonly LightRunShortcut[] = [
  {
    keys: ['↓', 'J'],
    label: 'Move to the next check',
    short: 'Next',
    hint: false,
    requiresChecks: true
  },
  {
    keys: ['↑', 'K'],
    label: 'Move to the previous check',
    short: 'Previous',
    hint: false,
    requiresChecks: true
  },
  {
    keys: ['Space'],
    label: 'Toggle works for the focused check',
    short: 'Works',
    hint: true,
    requiresChecks: true
  },
  {
    keys: ['F'],
    label: 'Toggle a problem for the focused check',
    short: 'Problem',
    hint: true,
    requiresChecks: true
  },
  {
    keys: ['A'],
    label: 'Mark everything works and finish',
    short: 'All good',
    hint: true,
    requiresChecks: true
  },
  { keys: ['O'], label: 'Add an observation', short: 'Observation', hint: true },
  {
    keys: ['S'],
    label: 'Open or close this check’s Steps',
    short: 'Steps',
    hint: true,
    requiresDetail: true
  },
  {
    keys: ['T'],
    label: 'Open or close every Steps drawer',
    short: 'All steps',
    hint: true,
    requiresDetail: true
  },
  {
    keys: ['1', '9'],
    label: 'Focus check by number',
    short: 'Focus',
    hint: true,
    requiresChecks: true
  },
  { keys: ['⇧F'], label: 'Finish the light run', short: 'Finish', hint: true },
  {
    keys: ['⌘V'],
    label: 'Paste a screenshot onto the focused target',
    short: 'Screenshot',
    hint: false
  },
  { keys: ['Esc'], label: 'Back', short: 'Back', hint: true }
]

export function selectRunnerSurface(request: QaRequest, detailed: boolean): RunnerSurface {
  if (request.mode === 'doc-review') return 'review'
  if (request.degraded) return 'degraded'
  if (request.mode === 'light' && !detailed) return 'light'
  return 'test'
}

function matchesTarget(target: EventTarget | null, selector: string): boolean {
  const candidate = target as { closest?: (selector: string) => unknown } | null
  if (typeof candidate?.closest !== 'function') return false
  return Boolean(candidate.closest(selector))
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  return matchesTarget(target, 'input, textarea, [contenteditable]')
}

export function isActivatableTarget(target: EventTarget | null): boolean {
  return matchesTarget(target, 'button, a, select, [role="button"]')
}

export function lightVerdictPresentation(status: ItemStatus): LightVerdictPresentation {
  if (status === 'pass') return { rowClass: ' lr-ok', chip: null, title: undefined }
  if (status === 'fail') return { rowClass: ' lr-bad', chip: null, title: undefined }
  if (status === 'partial') {
    return {
      rowClass: ' lr-neutral',
      chip: 'partial',
      title: 'Partial verdict from the detailed view'
    }
  }
  if (status === 'skip') {
    return {
      rowClass: ' lr-neutral',
      chip: 'skipped',
      title: 'Skipped in the detailed view'
    }
  }
  return { rowClass: '', chip: null, title: undefined }
}

export function shouldShowLightComment(status: ItemStatus, comment: string): boolean {
  return status === 'fail' || comment.length > 0
}

export function lightRunLayout(mainCheckCount: number): LightRunLayout {
  const hasChecks = mainCheckCount > 0
  // Everything works is no longer drawn (2026-09-26): Finish is the one way
  // out, and the ticks already say what works. Its keyboard command stays.
  return { showChecks: hasChecks, showEverythingWorks: false }
}

export function lightRunHints(request: QaRequest): readonly LightRunShortcut[] {
  const layout = lightRunLayout(request.items.length)
  const hasDetail = request.items.some((item) => item.steps.length > 0 || item.expected.length > 0)
  return LIGHT_RUN_SHORTCUTS.filter(
    (shortcut) =>
      shortcut.hint &&
      (!shortcut.requiresChecks || layout.showChecks) &&
      (!shortcut.requiresDetail || hasDetail)
  )
}

export function nextMainCheckIndex(
  mainCheckIds: readonly string[],
  focusedId: string | null,
  delta: number
): number {
  if (mainCheckIds.length === 0) return -1
  const current = focusedId ? mainCheckIds.indexOf(focusedId) : -1
  if (current < 0) return 0
  return Math.min(Math.max(current + delta, 0), mainCheckIds.length - 1)
}

export function showParkedDot(materialised: boolean): boolean {
  return !materialised
}

export function cancelPendingReportSave(
  timerRef: { current: number | ReturnType<typeof setTimeout> | null },
  dirtyRef: { current: boolean }
): void {
  if (timerRef.current !== null) clearTimeout(timerRef.current)
  timerRef.current = null
  dirtyRef.current = false
}
