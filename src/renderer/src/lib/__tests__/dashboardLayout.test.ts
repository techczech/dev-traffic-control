import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { skipWithoutChrome } from './chromeLayoutEngine'
import {
  RAIL_MIN_WINDOW_WIDTH,
  RAIL_WIDTH,
  projectListPresentation,
  railFitsWindow
} from '../railVisibility'
import { NARROW_WIDTH } from '../../../../main/windowLayout'

skipWithoutChrome('Dashboard layout guard')

// A mid-width window below the rail threshold: the old 860px expanded strip.
const WIDE_WIDTH = 860

/**
 * Ticket 13, the measurement. The Dashboard is the landing surface and the only
 * one with its own right-hand panel, so it is the surface a rail squeezes
 * first. These assertions are about pixels Chrome actually laid out, not about
 * how the markup reads.
 */

/** A title column narrower than this cannot hold an ordinary request title. */
const TITLE_COLUMN_WIDTH_FLOOR = 200
/** "Wraps more than twice" — three lines or more — is the reported defect. */
const TITLE_LINE_LIMIT = 2
/** One word per line is what he saw; a real line carries more than a word. */
const CHARACTERS_PER_LINE_FLOOR = 12

interface Measurement {
  mode: 'dashboard' | 'front-page' | 'pushed-in'
  width: number
  requestedViewport: number
  rail: boolean
  label: string
  viewportWidth: number
  frameWidth: number
  railShown: boolean
  railWidth: number
  surfaceWidth: number
  deepColumnWidth: number
  glanceColumnWidth: number
  titleColumnWidth: number
  titleLineCount: number
  minCharactersPerLine: number
  medianCharactersPerLine: number
  rowColumnOverlaps: number
  headingClearsTheRowBeneathIt: boolean
  listShown: boolean
  listWidth: number
  listRowCount: number
  clippedRowNames: number
  clippedRowSubs: number
  narrowestRowNameWidth: number
  rowsOutsideTheList: number
  listScrolls: boolean
  listOverflowsTheWindow: boolean
  footerPinnedToTheWindow: boolean
  footerBelowTheRows: boolean
  titlebarShown: boolean
  backControlShown: boolean
  backControlWidth: number
  backControlBesideTheScope: boolean
  scopeNameClipped: boolean
  titlebarOverflows: boolean
  titlebarOverflowPx: number
  lastTitlebarControlInsideFrame: boolean
  titlebarItemsOutsideFrame: number
  titlebarItemCount: number
  titlebarElementsWrappingToASecondLine: number
  buildTagRight: number
  buildTagWidth: number
  lastTitlebarControlRight: number
  scopeChipWidth: number
  scopeNameWidth: number
  tabsOverflow: boolean
  tabCount: number
}

let cached: { stylesheets: string[]; measurements: Measurement[] } | undefined

function geometry(): { stylesheets: string[]; measurements: Measurement[] } {
  if (cached) return cached
  const fixture = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures/dashboardLayoutGeometry.cjs'
  )
  const result = spawnSync(process.execPath, [fixture], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(
      `Dashboard geometry fixture failed (status ${String(result.status)}):\n${
        result.error?.message ?? (result.stderr || result.stdout)
      }`
    )
  }
  cached = JSON.parse(result.stdout.trim())
  return cached!
}

function at(width: number, rail: boolean): Measurement {
  const found = geometry().measurements.find(
    (measurement) =>
      measurement.mode === 'dashboard' && measurement.width === width && measurement.rail === rail
  )
  if (!found) throw new Error(`No measurement for ${width}px (rail: ${String(rail)})`)
  return found
}

/** Ticket 04's cases, which are told apart by what they draw, not by a width. */
function labelled(label: string): Measurement {
  const found = geometry().measurements.find((measurement) => measurement.label === label)
  if (!found) throw new Error(`No measurement labelled "${label}"`)
  return found
}

describe('the guard measures what the app actually loads', () => {
  // A guard that loads three of the app's nine stylesheets cannot see a
  // collision living in the other six. This app has shipped that mistake
  // twice; the list is derived from the renderer entry so it cannot drift.
  test('loads every stylesheet the renderer entry imports, in that order', () => {
    expect(geometry().stylesheets).toEqual([
      'src/renderer/src/assets/main.css',
      'src/renderer/src/assets/specs.css',
      'src/renderer/src/assets/releases.css',
      'src/renderer/src/assets/release-app.css',
      'src/renderer/src/assets/roadmap-pool.css',
      'src/renderer/src/assets/commands.css',
      'src/renderer/src/assets/project-rail.css',
      'src/renderer/src/assets/handoffs.css',
      'src/renderer/src/assets/link-arrival.css',
      'src/renderer/src/assets/fleet.css',
      'src/renderer/src/assets/project-home.css',
      'src/renderer/src/assets/markup.css',
      'src/renderer/src/assets/get-started.css'
    ])
  }, 60_000)

  test('each case was laid out at the width it claims', () => {
    for (const measurement of geometry().measurements) {
      expect(measurement.viewportWidth).toBe(measurement.requestedViewport)
      expect(measurement.frameWidth).toBe(measurement.width)
      if (measurement.mode === 'dashboard') {
        expect(measurement.railWidth + measurement.surfaceWidth).toBeCloseTo(measurement.width, 1)
      } else {
        // Nothing sits beside the list or the pushed-in surface below the
        // threshold: whatever is on screen has the window to itself. The one
        // exception is the deliberate defect case, which is the list left at
        // the rail's drawn width inside a window with nothing to put beside it.
        expect(measurement.railWidth).toBe(measurement.rail ? RAIL_WIDTH : 0)
        expect(measurement.listWidth).toBeLessThanOrEqual(measurement.width)
      }
    }
  }, 60_000)
})

describe('the Dashboard keeps a usable title column at every width the app runs at', () => {
  const shipped: Array<[string, number, boolean]> = [
    ['the narrow preset, 460px', NARROW_WIDTH, false],
    ['the wide preset, 860px — his window', WIDE_WIDTH, false],
    ['a genuinely wide window, 1440px, with the rail', 1440, true]
  ]

  test.each(shipped)(
    '%s',
    (_label, width, railExpected) => {
      // The configuration measured is the one the app would actually produce.
      expect(railFitsWindow(width)).toBe(railExpected)

      const measurement = at(width, railExpected)
      expect(measurement.railShown).toBe(railExpected)
      expect(measurement.titleColumnWidth).toBeGreaterThanOrEqual(TITLE_COLUMN_WIDTH_FLOOR)
      expect(measurement.titleLineCount).toBeLessThanOrEqual(TITLE_LINE_LIMIT)
      expect(measurement.minCharactersPerLine).toBeGreaterThanOrEqual(CHARACTERS_PER_LINE_FLOOR)
      expect(measurement.rowColumnOverlaps).toBe(0)
      expect(measurement.headingClearsTheRowBeneathIt).toBe(true)
    },
    60_000
  )

  // Not a hypothetical. This is the build Dominik installed and rejected, and
  // it is measured so the floors above are known to be capable of failing.
  test('the shipped defect — a 252px rail inside an 860px window — fails every floor', () => {
    const defect = at(WIDE_WIDTH, true)

    expect(defect.railWidth).toBe(RAIL_WIDTH)
    expect(defect.surfaceWidth).toBeCloseTo(WIDE_WIDTH - RAIL_WIDTH, 1)
    expect(defect.titleColumnWidth).toBeLessThan(TITLE_COLUMN_WIDTH_FLOOR)
    expect(defect.titleLineCount).toBeGreaterThan(TITLE_LINE_LIMIT)
    expect(defect.minCharactersPerLine).toBeLessThan(CHARACTERS_PER_LINE_FLOOR)

    // And the gate now refuses exactly that configuration.
    expect(railFitsWindow(WIDE_WIDTH)).toBe(false)
  }, 60_000)

  test('the threshold leaves the surface beside the rail at least as wide as 860px alone', () => {
    const wideAlone = at(WIDE_WIDTH, false)
    expect(RAIL_MIN_WINDOW_WIDTH - RAIL_WIDTH).toBeGreaterThanOrEqual(
      wideAlone.surfaceWidth - RAIL_WIDTH
    )
    expect(RAIL_MIN_WINDOW_WIDTH - RAIL_WIDTH).toBeGreaterThan(wideAlone.deepColumnWidth)
  }, 60_000)
})

/**
 * Ticket 04. Ticket 13 stopped the rail rendering below 1013px and left his
 * docked 860px window with no project list at all. The front page is what
 * takes its place, so the question becomes whether the list itself holds up at
 * the widths the app actually runs at.
 */
describe('narrow: the project list as the whole window', () => {
  const presets: Array<[string, number, string]> = [
    ['the narrow preset, 460px', NARROW_WIDTH, 'front page, narrow preset'],
    ['the wide preset, 860px — his window', WIDE_WIDTH, 'front page, wide preset']
  ]

  test.each(presets)(
    '%s: the list fills the window and every row is legible',
    (_label, width, caseLabel) => {
      // The configuration measured is the one the app would actually produce.
      expect(projectListPresentation(width, true)).toBe('front-page')

      const measurement = labelled(caseLabel)
      expect(measurement.listShown).toBe(true)
      // No leftover rail width: the list takes the window, all of it.
      expect(measurement.listWidth).toBeCloseTo(width, 1)
      expect(measurement.rowsOutsideTheList).toBe(0)
      // A row's name and standing line are single-line and ellipsised, so a row
      // too narrow loses its right-hand end silently. None may.
      expect(measurement.clippedRowNames).toBe(0)
      expect(measurement.clippedRowSubs).toBe(0)
      // The same floor the Dashboard's title column must meet.
      expect(measurement.narrowestRowNameWidth).toBeGreaterThanOrEqual(TITLE_COLUMN_WIDTH_FLOOR)
    },
    60_000
  )

  test.each(presets)(
    '%s: the rows scroll and the sync line stays put',
    (_label, _width, caseLabel) => {
      const measurement = labelled(caseLabel)
      // Forty projects — more than the window is tall — so this is a real
      // overflow and not a structural claim about a list that happens to fit.
      expect(measurement.listRowCount).toBe(40)
      expect(measurement.listScrolls).toBe(true)
      expect(measurement.listOverflowsTheWindow).toBe(false)
      expect(measurement.footerPinnedToTheWindow).toBe(true)
      expect(measurement.footerBelowTheRows).toBe(true)
    },
    60_000
  )

  // The six surfaces belong to a scope and none has been chosen (ADR-0016
  // design lock). Measured, not asserted from the markup, because the tab bar
  // is a band of the shell: if it were drawn it would take height here.
  test('the front page carries no tab bar', () => {
    for (const [, , caseLabel] of presets) expect(labelled(caseLabel).tabCount).toBe(0)
    expect(labelled('pushed in, wide preset').tabCount).toBe(6)
  }, 60_000)

  // Not a hypothetical: the list left at the rail's drawn 252px inside a narrow
  // window. Kept measured so the floors above are known to be able to fail.
  test('the defect — the list kept at the rail width — fails those floors', () => {
    const defect = labelled('front page, fixed rail width (the defect)')

    expect(defect.listWidth).toBe(RAIL_WIDTH)
    expect(defect.listWidth).toBeLessThan(NARROW_WIDTH)
    expect(defect.clippedRowSubs).toBeGreaterThan(0)
    expect(defect.narrowestRowNameWidth).toBeLessThan(TITLE_COLUMN_WIDTH_FLOOR)
  }, 60_000)
})

describe('narrow: pushed into a project', () => {
  // The pushed-in surface at his working width IS ticket 13's `wide preset`
  // case: below the threshold no rail renders, so the surface has the window.
  test('the Dashboard still meets every floor at 860px', () => {
    expect(projectListPresentation(WIDE_WIDTH, false)).toBe('pushed-in')

    const measurement = at(WIDE_WIDTH, false)
    expect(measurement.railShown).toBe(false)
    expect(measurement.titleColumnWidth).toBeGreaterThanOrEqual(TITLE_COLUMN_WIDTH_FLOOR)
    expect(measurement.titleLineCount).toBeLessThanOrEqual(TITLE_LINE_LIMIT)
    expect(measurement.minCharactersPerLine).toBeGreaterThanOrEqual(CHARACTERS_PER_LINE_FLOOR)
    expect(measurement.rowColumnOverlaps).toBe(0)
  }, 60_000)

  test('the way back sits beside the scope indicator, and both fit at 860px', () => {
    const measurement = labelled('pushed in, wide preset')

    expect(measurement.backControlShown).toBe(true)
    expect(measurement.backControlBesideTheScope).toBe(true)
    expect(measurement.scopeNameClipped).toBe(false)
    expect(measurement.titlebarOverflowPx).toBe(0)
    expect(measurement.lastTitlebarControlInsideFrame).toBe(true)
  }, 60_000)

  test('the way back is icon-only at the narrow preset, beside the scope', () => {
    const withBack = labelled('pushed in, narrow preset')

    expect(withBack.backControlShown).toBe(true)
    expect(withBack.backControlBesideTheScope).toBe(true)
    // The icon-only form: a third of the 81px the labelled control takes.
    expect(withBack.backControlWidth).toBeLessThan(
      labelled('pushed in, wide preset').backControlWidth / 2
    )
  }, 60_000)
})

/**
 * Ticket 14. Dominik's screenshot of 0.21.0-alpha.2 at the 460px preset: the
 * centred app name wrapped to three lines against the build marker and the pin
 * was off the frame. The bar is one component, so it is measured at all three
 * widths the app runs at with the same assertions.
 */
describe('the titlebar holds its shape at every width the app runs at', () => {
  const bars: Array<[string, string]> = [
    ['the narrow preset, 460px, pushed into a project', 'pushed in, narrow preset'],
    ['the narrow preset, 460px, on the front page', 'front page, narrow preset'],
    ['the wide preset, 860px — his window', 'pushed in, wide preset'],
    ['a genuinely wide window, 1440px', 'titlebar, genuinely wide window']
  ]

  test.each(bars)(
    '%s: nothing overflows, nothing leaves the frame, nothing wraps',
    (_label, caseLabel) => {
      const bar = labelled(caseLabel)

      expect(bar.titlebarShown).toBe(true)
      // Zero, not "small": a bar that overflows by a pixel is a bar whose
      // layout is decided by whichever element happens to be widest.
      expect(bar.titlebarOverflowPx).toBe(0)
      expect(bar.titlebarOverflows).toBe(false)
      // Every item, not just the last one: a control pushed off either edge
      // cannot hide behind a neighbour that happens to fit.
      expect(bar.titlebarItemsOutsideFrame).toBe(0)
      expect(bar.lastTitlebarControlInsideFrame).toBe(true)
      // The bar is a fixed 42px tall, so a wrapped element does not show up as
      // extra height. It is counted by its line boxes instead.
      expect(bar.titlebarElementsWrappingToASecondLine).toBe(0)
      // And the chip still names the project rather than collapsing to its
      // icons: a header that names the project zero times is the same failure
      // as one that names it twice.
      expect(bar.scopeNameWidth).toBeGreaterThan(30)
    },
    60_000
  )

  // The invariant, measured rather than reasoned about: the same bar, the same
  // width, a 19-character project name and a 2-character one. If the build
  // marker and the pin sit at the same pixel in both, the length of the project
  // name provably moves nothing — which is the whole of fault 3.
  const twins: Array<[string, string, string]> = [
    [
      'the narrow preset',
      'pushed in, narrow preset',
      'pushed in, narrow preset, short project name'
    ],
    ['the wide preset', 'pushed in, wide preset', 'pushed in, wide preset, short project name']
  ]

  test.each(twins)(
    '%s: the build marker and the controls do not move when the project name does',
    (_label, longName, shortName) => {
      const long = labelled(longName)
      const short = labelled(shortName)

      expect(long.scopeChipWidth).toBeGreaterThan(short.scopeChipWidth)
      expect(long.buildTagRight).toBeCloseTo(short.buildTagRight, 1)
      expect(long.buildTagWidth).toBeCloseTo(short.buildTagWidth, 1)
      expect(long.lastTitlebarControlRight).toBeCloseTo(short.lastTitlebarControlRight, 1)
      expect(short.titlebarOverflowPx).toBe(0)
    },
    60_000
  )

  // Not a hypothetical: the bar exactly as 0.21.0-alpha.2 shipped it, with the
  // centred app name and the non-shrinking chip restored. Kept permanently, as
  // ticket 13 kept the shipped rail, so the zero above is known to be able to
  // fail. The numbers are the ones in the report: 60px on the front page and
  // 92px pushed in, with the pin off the frame.
  const defects: Array<[string, string, number]> = [
    [
      'on the front page',
      'front page, narrow preset, app name reinstated (the reported defect)',
      60
    ],
    [
      'pushed into a project',
      'pushed in, narrow preset, app name reinstated (the reported defect)',
      92
    ]
  ]

  test.each(defects)(
    'the reported defect %s — the app name reinstated — fails every one of those',
    (_label, caseLabel, overflowPx) => {
      const defect = labelled(caseLabel)

      expect(defect.titlebarOverflowPx).toBe(overflowPx)
      expect(defect.titlebarOverflows).toBe(true)
      expect(defect.lastTitlebarControlInsideFrame).toBe(false)
      expect(defect.titlebarItemsOutsideFrame).toBeGreaterThan(0)
      expect(defect.titlebarElementsWrappingToASecondLine).toBeGreaterThan(0)
    },
    60_000
  )
})
