import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { skipWithoutChrome } from './chromeLayoutEngine'

skipWithoutChrome('verdict-sheet layout guard')

interface SheetMeasurement {
  width: number
  layout: 'one-at-a-time' | 'all-at-once'
  titlebarBottom: number
  sheetTop: number
  sheetBottom: number
  viewportHeight: number
  hits: Record<string, string | null>
}

let cached: { stylesheets: string[]; measurements: SheetMeasurement[] } | undefined

function geometry(): { stylesheets: string[]; measurements: SheetMeasurement[] } {
  if (cached) return cached
  const fixture = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures/verdictSheetGeometry.cjs'
  )
  const result = spawnSync(process.execPath, [fixture], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `Verdict sheet geometry fixture failed (status ${String(result.status)}):\n${
        result.error?.message ?? (result.stderr || result.stdout)
      }`
    )
  }
  cached = JSON.parse(result.stdout.trim())
  return cached!
}

/**
 * The verdict
 * sheet sits below the title bar, so the pin, Dock (both parts) and Expand are
 * visible and take the click while the reviewer answers — one at a time or all at once,
 * in the sidebar and at full width. Measured in real Chrome with the app's
 * stylesheets, by hit-testing, because a covered button still has its box.
 */
describe('the verdict sheet leaves the title bar in reach', () => {
  test('the guard loads every stylesheet the renderer loads', () => {
    expect(geometry().stylesheets).toContain('src/renderer/src/assets/project-home.css')
    expect(geometry().stylesheets).toContain('src/renderer/src/assets/main.css')
  }, 30_000)

  // 500 stands in for the 460px sidebar: headless Chrome's narrowest window,
  // in the same media-query buckets (fixtures/verdictSheetGeometry.cjs).
  test('in the sidebar and at 1280, in both layouts, every title-bar control takes its own click', () => {
    const { measurements } = geometry()
    expect(measurements.map((m) => [m.width, m.layout])).toEqual([
      [500, 'one-at-a-time'],
      [500, 'all-at-once'],
      [1280, 'one-at-a-time'],
      [1280, 'all-at-once']
    ])
    for (const m of measurements) {
      expect(m.hits).toEqual({
        expand: 'expand',
        settings: 'settings',
        dock: 'dock',
        'dock-menu': 'dock-menu',
        pin: 'pin'
      })
      // It starts where the title bar ends and still fills the rest of the window.
      expect(m.sheetTop).toBe(m.titlebarBottom)
      expect(m.sheetBottom).toBe(m.viewportHeight)
    }
  }, 30_000)
})
