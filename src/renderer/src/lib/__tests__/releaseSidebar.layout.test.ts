import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { skipWithoutChrome } from './chromeLayoutEngine'

skipWithoutChrome('release-sidebar layout guard')

const DETAIL_WIDTH_FLOOR = 168
const CHARACTERS_PER_LINE_FLOOR = 8

interface LayoutMeasurement {
  splitClassNames?: string[] | null
  surface?: 'release' | 'roadmap'
  width: number
  versionLayout?: 'pills' | 'rail'
  navigation?: 'projects' | 'pool'
  containerWidth: number
  projectSidebar: { left: number; right: number; width: number } | null
  versionRail: { left: number; right: number; width: number } | null
  detail: { left: number; right: number; width: number }
  visibleColumnWidth: number
  medianCharactersPerLine: number
  railPosition: string | null
  railFlowsBeforeDetail: boolean
  projectReturnVisible?: boolean
}

interface FixtureOutput {
  stylesheets: string[]
  measurements: LayoutMeasurement[]
}

let cachedFixture: FixtureOutput | undefined

function runFixture(): FixtureOutput {
  if (cachedFixture) return cachedFixture
  const fixture = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures/releaseLayoutGeometry.cjs'
  )
  const result = spawnSync(process.execPath, [fixture], { encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(
      `Chrome geometry fixture failed (status ${String(result.status)}, signal ${String(result.signal)}):\n${result.error?.message ?? (result.stderr || result.stdout)}`
    )
  }
  cachedFixture = JSON.parse(result.stdout.trim()) as FixtureOutput
  return cachedFixture
}

function measureLayouts(): LayoutMeasurement[] {
  return runFixture().measurements
}

describe('the guard measures what the app actually loads', () => {
  // Two releases shipped a collapsed rail behind four green assertions because this
  // fixture loaded three stylesheets and the app loaded seven. The colliding rule
  // lived in main.css, so the defect could not occur on the page being measured.
  test('loads every stylesheet the renderer entry imports, in that order', () => {
    const { stylesheets } = runFixture()

    expect(stylesheets).toEqual([
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
      'src/renderer/src/assets/waiting-rows.css',
      'src/renderer/src/assets/markup.css',
      'src/renderer/src/assets/get-started.css',
      'src/renderer/src/assets/feature-requests.css',
      'src/renderer/src/assets/roadmap-releases.css'
    ])
  }, 30_000)

  // `release-app-split ${versionLayout}` emitted a bare `rail`, which main.css owns
  // as the Runner's 46px icon strip. A variant class must be namespaced to its
  // component; a bare word is a global claim.
  test('the split never claims a bare variant class', () => {
    const splits = measureLayouts()
      .map((measurement) => measurement.splitClassNames)
      .filter((names): names is string[] => Array.isArray(names))

    expect(splits.length).toBeGreaterThan(0)
    for (const names of splits) {
      expect(names).not.toContain('rail')
      expect(names).not.toContain('pills')
      expect(names.every((name) => name.startsWith('release-app-split'))).toBe(true)
    }
  }, 30_000)
})

describe('release sidebar measured geometry', () => {
  test('keeps the release detail usable at every supported test width', () => {
    const measurements = measureLayouts().filter((measurement) => measurement.surface !== 'roadmap')

    expect(measurements).toHaveLength(8)
    for (const measurement of measurements) {
      expect.soft(measurement.containerWidth, label(measurement)).toBe(measurement.width)
      expect
        .soft(measurement.detail.width, label(measurement))
        .toBeGreaterThanOrEqual(DETAIL_WIDTH_FLOOR)
      expect
        .soft(measurement.visibleColumnWidth, label(measurement))
        .toBeLessThanOrEqual(measurement.containerWidth + 0.5)
      expect
        .soft(measurement.medianCharactersPerLine, label(measurement))
        .toBeGreaterThanOrEqual(CHARACTERS_PER_LINE_FLOOR)
    }
  }, 30_000)

  test('keeps the narrow rail in flow and gives it precedence over the project list', () => {
    const railMeasurements = measureLayouts().filter(
      (measurement) => measurement.surface !== 'roadmap' && measurement.versionLayout === 'rail'
    )

    for (const measurement of railMeasurements) {
      expect.soft(measurement.railPosition, label(measurement)).toBe('static')
      expect.soft(measurement.railFlowsBeforeDetail, label(measurement)).toBe(true)
      expect
        .soft(measurement.projectSidebar === null, label(measurement))
        .toBe(measurement.width < 658)
    }
  }, 30_000)
})

describe('roadmap sidebar measured geometry', () => {
  const ROADMAP_DETAIL_WIDTH_FLOOR = 260
  const ROADMAP_CHARACTERS_PER_LINE_FLOOR = 16

  test('keeps the Roadmap lanes usable at every supported test width', () => {
    const measurements = measureLayouts().filter(
      (measurement) => measurement.surface === 'roadmap' && measurement.navigation === 'pool'
    )

    expect(measurements).toHaveLength(4)
    for (const measurement of measurements) {
      expect.soft(measurement.containerWidth, label(measurement)).toBe(measurement.width)
      expect
        .soft(measurement.detail.width, label(measurement))
        .toBeGreaterThanOrEqual(ROADMAP_DETAIL_WIDTH_FLOOR)
      expect
        .soft(measurement.visibleColumnWidth, label(measurement))
        .toBeLessThanOrEqual(measurement.containerWidth + 0.5)
      expect
        .soft(measurement.medianCharactersPerLine, label(measurement))
        .toBeGreaterThanOrEqual(ROADMAP_CHARACTERS_PER_LINE_FLOOR)
    }
  }, 30_000)

  test('shows one navigation column at narrow widths and a visible route between them', () => {
    const measurements = measureLayouts().filter((measurement) => measurement.surface === 'roadmap')

    expect(measurements).toHaveLength(8)
    for (const measurement of measurements) {
      const narrow = measurement.width < 658
      if (measurement.navigation === 'pool') {
        expect.soft(measurement.projectSidebar === null, label(measurement)).toBe(narrow)
        expect.soft(measurement.projectReturnVisible, label(measurement)).toBe(narrow)
      } else if (narrow) {
        expect.soft(measurement.detail, label(measurement)).toBeNull()
        expect
          .soft(measurement.projectSidebar?.width, label(measurement))
          .toBe(measurement.containerWidth)
      }
    }
  }, 30_000)
})

function label(measurement: LayoutMeasurement): string {
  return `${measurement.width}px ${measurement.surface ?? 'release'} with ${measurement.versionLayout ?? measurement.navigation}`
}
