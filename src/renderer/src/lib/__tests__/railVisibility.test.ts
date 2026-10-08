import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MIN_SURFACE_WIDTH_BESIDE_RAIL,
  RAIL_MIN_WINDOW_WIDTH,
  RAIL_WIDTH,
  projectListPresentation,
  railFitsWindow
} from '../railVisibility'
import { NARROW_WIDTH, WIDE_WIDTH as EXPANDED_WIDTH } from '../../../../main/windowLayout'

// A mid-width window below the rail threshold: the old 860px expanded strip.
const WIDE_WIDTH = 860

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')

describe('the rail is shown by measured width, not by a stored preference', () => {
  // The defect: the first installed build gated the rail on
  // `settings.widthPreset === 'wide'`. `wide` is a docking preference meaning
  // 860px, so a 252px rail landed beside a Dashboard that also has a
  // right-hand panel, and request titles wrapped one word per line.
  test('both docking presets are below the threshold, so neither can show the rail', () => {
    expect(railFitsWindow(NARROW_WIDTH)).toBe(false)
    expect(railFitsWindow(WIDE_WIDTH)).toBe(false)
    expect(RAIL_MIN_WINDOW_WIDTH).toBeGreaterThan(WIDE_WIDTH)
  })

  test('the threshold is the rail plus the narrowest surface it may sit beside', () => {
    expect(RAIL_MIN_WINDOW_WIDTH).toBe(RAIL_WIDTH + MIN_SURFACE_WIDTH_BESIDE_RAIL)
    expect(railFitsWindow(RAIL_MIN_WINDOW_WIDTH)).toBe(true)
    expect(railFitsWindow(RAIL_MIN_WINDOW_WIDTH - 1)).toBe(false)
  })

  // A constant that drifts from the stylesheet is a constant that lies. Both
  // numbers are transcribed from CSS, so both are checked against the CSS.
  test('RAIL_WIDTH is the width the stylesheet actually gives the rail', () => {
    const css = readFileSync(resolve(repoRoot, 'src/renderer/src/assets/project-rail.css'), 'utf8')
    expect(css).toContain(`flex: 0 0 ${RAIL_WIDTH}px`)
  })

  test('the surface floor sits one pixel above the Dashboard reflow breakpoint', () => {
    const css = readFileSync(resolve(repoRoot, 'src/renderer/src/assets/main.css'), 'utf8')
    expect(css).toContain(`@media (max-width: ${MIN_SURFACE_WIDTH_BESIDE_RAIL - 1}px)`)
  })
})

describe('one list, two presentations, chosen by width', () => {
  // The rail does not render below 1013. The front page is what a narrow
  // window shows instead, so no width is left without a project list.
  test('at both docking presets the list is the window, not a rail', () => {
    expect(projectListPresentation(NARROW_WIDTH, true)).toBe('front-page')
    expect(projectListPresentation(WIDE_WIDTH, true)).toBe('front-page')
  })

  test('picking a project at a narrow width pushes into it', () => {
    expect(projectListPresentation(WIDE_WIDTH, false)).toBe('pushed-in')
    expect(projectListPresentation(NARROW_WIDTH, false)).toBe('pushed-in')
  })

  test('at and above the threshold the list is the rail, front page or not', () => {
    expect(projectListPresentation(RAIL_MIN_WINDOW_WIDTH, true)).toBe('rail')
    expect(projectListPresentation(RAIL_MIN_WINDOW_WIDTH, false)).toBe('rail')
    expect(projectListPresentation(RAIL_MIN_WINDOW_WIDTH - 1, true)).toBe('front-page')
  })

  // The rail and the front page are two presentations of one list. A width at
  // which both were possible would put a 252px rail beside a front page.
  test('no width and no state produces both presentations at once', () => {
    for (let width = 320; width <= 1600; width += 1) {
      for (const onFrontPage of [true, false]) {
        const presentation = projectListPresentation(width, onFrontPage)
        // One value, so "both" is not expressible: the rail arm and the front
        // page arm are the same decision, and the width decides which.
        expect(presentation === 'rail').toBe(railFitsWindow(width))
        expect(['rail', 'front-page', 'pushed-in']).toContain(presentation)
      }
    }
  })

  // The threshold is owned in one place. A second number would drift, and the
  // two presentations would overlap or leave a gap of widths showing neither.
  test('the front page starts exactly where the rail stops', () => {
    expect(projectListPresentation(RAIL_MIN_WINDOW_WIDTH - 1, true)).toBe('front-page')
    expect(projectListPresentation(RAIL_MIN_WINDOW_WIDTH, true)).toBe('rail')
  })
})

describe('the expand button reaches a width that holds the rail', () => {
  // Clicking the expand button must widen the window enough to show the
  // sidebar. The expanded preset must clear the threshold.
  test('the expanded preset shows the rail', () => {
    expect(railFitsWindow(EXPANDED_WIDTH)).toBe(true)
    expect(projectListPresentation(EXPANDED_WIDTH, true)).toBe('rail')
  })
})
