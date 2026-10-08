import { describe, expect, test, vi } from 'vitest'
import type { QaRequest } from '../../../../main/qa/types'
import * as lightRun from '../lightRun'
import {
  LIGHT_RUN_SHORTCUTS,
  cancelPendingReportSave,
  lightRunLayout,
  lightVerdictPresentation,
  nextMainCheckIndex,
  selectRunnerSurface,
  shouldShowLightComment,
  showParkedDot
} from '../lightRun'

function request(overrides: Partial<QaRequest> = {}): QaRequest {
  return {
    id: 'light',
    title: 'Light request',
    labels: {},
    mode: 'light',
    items: [],
    parked: [],
    degraded: false,
    raw: '',
    path: '/qa/light.md',
    ...overrides
  }
}

describe('light-run surface policy', () => {
  test('a degraded explicit-light request uses the degraded surface before light handover', () => {
    expect(selectRunnerSurface(request({ degraded: true }), false)).toBe('degraded')
  })

  test('the detailed hatch has a route back to the light surface', () => {
    expect(selectRunnerSurface(request(), true)).toBe('test')
  })

  test('normalised doc-review mode selects the review surface despite label casing', () => {
    expect(
      selectRunnerSurface(
        request({ mode: 'doc-review', labels: { kind: 'Doc-Review' }, degraded: false }),
        false
      )
    ).toBe('review')
  })

  test('text-entry and activatable targets are classified independently', () => {
    const isTextEntryTarget = Reflect.get(lightRun, 'isTextEntryTarget')
    const isActivatableTarget = Reflect.get(lightRun, 'isActivatableTarget')

    expect(typeof isTextEntryTarget).toBe('function')
    expect(typeof isActivatableTarget).toBe('function')

    const selectors: string[] = []
    const target = {
      closest(selector: string): object | null {
        selectors.push(selector)
        return selector.includes('button') ? {} : null
      }
    } as unknown as EventTarget

    expect((isTextEntryTarget as (value: EventTarget) => boolean)(target)).toBe(false)
    expect((isActivatableTarget as (value: EventTarget) => boolean)(target)).toBe(true)
    expect(selectors).toEqual([
      'input, textarea, [contenteditable]',
      'button, a, select, [role="button"]'
    ])
  })

  test.each([
    ['partial', 'partial', 'Partial verdict from the detailed view'],
    ['skip', 'skipped', 'Skipped in the detailed view']
  ] as const)('%s has a visible neutral presentation', (status, chip, title) => {
    expect(lightVerdictPresentation(status)).toEqual({
      rowClass: ' lr-neutral',
      chip,
      title
    })
  })

  test('a retained comment remains visible after the item is changed to pass', () => {
    expect(shouldShowLightComment('pass', 'grey placeholder')).toBe(true)
    expect(shouldShowLightComment('fail', '')).toBe(true)
    expect(shouldShowLightComment('pass', '')).toBe(false)
  })

  // Everything works is never drawn; Finish is the one way out.
  test('a parked-only request hides the check section, and Everything works is never drawn', () => {
    expect(lightRunLayout(0)).toEqual({
      showChecks: false,
      showEverythingWorks: false
    })
    expect(lightRunLayout(1)).toEqual({
      showChecks: true,
      showEverythingWorks: false
    })
  })

  test('moving from a materialised parked item starts at the first main check', () => {
    expect(nextMainCheckIndex(['one', 'two'], 'also-optional', 1)).toBe(0)
    expect(nextMainCheckIndex(['one', 'two'], 'one', 1)).toBe(1)
  })

  test('a materialised parked row drops the redundant reference dot', () => {
    expect(showParkedDot(false)).toBe(true)
    expect(showParkedDot(true)).toBe(false)
  })

  test('terminal actions cancel the queued autosave and mark it clean', () => {
    vi.useFakeTimers()
    const queuedSave = vi.fn()
    const timerRef: { current: number | ReturnType<typeof setTimeout> | null } = {
      current: setTimeout(queuedSave, 400)
    }
    const dirtyRef = { current: true }

    cancelPendingReportSave(timerRef, dirtyRef)
    vi.advanceTimersByTime(400)

    expect(queuedSave).not.toHaveBeenCalled()
    expect(timerRef.current).toBeNull()
    expect(dirtyRef.current).toBe(false)
    vi.useRealTimers()
  })

  test('the shared light shortcut list contains the real light-run keys', () => {
    expect(
      LIGHT_RUN_SHORTCUTS.filter((shortcut) => shortcut.hint).flatMap((shortcut) => shortcut.keys)
    ).toEqual(['Space', 'F', 'A', 'O', 'S', 'T', '1', '9', '⇧F', 'Esc'])
  })

  test('the shared light shortcut list carries compact key-bar labels', () => {
    expect(
      LIGHT_RUN_SHORTCUTS.filter((shortcut) => shortcut.hint).map((shortcut) => shortcut.short)
    ).toEqual([
      'Works',
      'Problem',
      'All good',
      'Observation',
      'Steps',
      'All steps',
      'Focus',
      'Finish',
      'Back'
    ])
  })

  test('light-run hints follow the same check and detail layout as the surface', () => {
    const lightRunHints = Reflect.get(lightRun, 'lightRunHints')
    expect(typeof lightRunHints).toBe('function')

    const parkedOnly = request({
      parked: [{ id: 'also-export', text: 'Try export' }]
    })
    expect(
      (lightRunHints as (value: QaRequest) => typeof LIGHT_RUN_SHORTCUTS)(parkedOnly).map(
        (shortcut) => shortcut.short
      )
    ).toEqual(['Observation', 'Finish', 'Back'])

    const flat = request({
      items: [{ id: 'one', title: 'One', context: 'It works.', steps: [], expected: [], notes: [] }]
    })
    expect(
      (lightRunHints as (value: QaRequest) => typeof LIGHT_RUN_SHORTCUTS)(flat).map(
        (shortcut) => shortcut.short
      )
    ).toEqual(['Works', 'Problem', 'All good', 'Observation', 'Focus', 'Finish', 'Back'])

    const detailed = request({
      items: [
        {
          id: 'one',
          title: 'One',
          context: 'It works.',
          steps: ['Open it'],
          expected: [],
          notes: []
        }
      ]
    })
    expect(
      (lightRunHints as (value: QaRequest) => typeof LIGHT_RUN_SHORTCUTS)(detailed).map(
        (shortcut) => shortcut.short
      )
    ).toEqual([
      'Works',
      'Problem',
      'All good',
      'Observation',
      'Steps',
      'All steps',
      'Focus',
      'Finish',
      'Back'
    ])
  })
})
