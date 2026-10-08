import type { ProjectRelease } from '../../../main/qa/releaseRecords'
import type { ProjectPool } from '../../../main/qa/pool'
import { releaseBoardRows, type ReleaseBoardRow } from './releases'
import {
  displayProjectName,
  readStoredFolds,
  readStoredRecord,
  writeStoredFolds,
  writeStoredRecord,
  type RendererStorage
} from './projectSidebar'

export type ReleaseSidebarGroup = 'needs-you' | 'in-flight' | 'nothing-declared'
export type ReleaseVersionLayout = 'pills' | 'rail'
export type ReleaseNarrowNavigationColumn = 'projects' | 'versions'
export type ReleaseSidebarFolds = Record<ReleaseSidebarGroup, boolean>

export interface ReleaseSidebarProject {
  project: string
  app: string
  group: ReleaseSidebarGroup
  state: 'Needs you' | 'In flight' | 'Nothing declared'
  version?: string
  detail?: Exclude<ReleaseBoardRow, { kind: 'nothing-recorded' }>
}

export const RELEASE_VERSION_LAYOUT_STORAGE_KEY = 'dtc.releases.version-layouts.v1'
export const RELEASE_SIDEBAR_FOLDS_STORAGE_KEY = 'dtc.releases.sidebar-folds.v1'

export const DEFAULT_RELEASE_SIDEBAR_FOLDS: ReleaseSidebarFolds = {
  'needs-you': true,
  'in-flight': true,
  'nothing-declared': false
}

const GROUP_ORDER: Record<ReleaseSidebarGroup, number> = {
  'needs-you': 0,
  'in-flight': 1,
  'nothing-declared': 2
}

/** The opt-in version rail replaces the project list when both columns cannot fit. */
export function releaseNarrowNavigationColumn(
  versionLayout: ReleaseVersionLayout
): ReleaseNarrowNavigationColumn {
  return versionLayout === 'rail' ? 'versions' : 'projects'
}

/** Selects one sidebar row per project and keeps low-signal projects at the bottom. */
export function releaseSidebarProjects(
  projects: readonly string[],
  releases: readonly ProjectRelease[],
  pools: readonly ProjectPool[]
): ReleaseSidebarProject[] {
  const releaseByProject = new Map(releases.map((release) => [release.project, release]))
  const allProjects = new Set([...projects, ...releases.map((release) => release.project)])

  return [...allProjects]
    .map((project): ReleaseSidebarProject => {
      const release = releaseByProject.get(project) ?? { kind: 'nothing-recorded', project }
      const rows = releaseBoardRows([release], pools)
      const detail =
        rows.find((row) => row.kind === 'recorded' && row.needsYou) ??
        rows.find((row) => row.kind !== 'nothing-recorded')

      if (!detail || detail.kind === 'nothing-recorded') {
        return {
          project,
          app: detail?.app ?? displayProjectName(project),
          group: 'nothing-declared',
          state: 'Nothing declared'
        }
      }
      if (detail.kind === 'recorded' && detail.needsYou) {
        return {
          project,
          app: detail.app,
          group: 'needs-you',
          state: 'Needs you',
          version: detail.version,
          detail
        }
      }
      return {
        project,
        app: detail.app,
        group: 'in-flight',
        state: 'In flight',
        version: detail.version,
        detail
      }
    })
    .sort(
      (left, right) =>
        GROUP_ORDER[left.group] - GROUP_ORDER[right.group] || left.app.localeCompare(right.app)
    )
}

/** Formats the count line from the selected detail row, never from estate totals. */
export function releaseDetailTally(
  row: Exclude<ReleaseBoardRow, { kind: 'nothing-recorded' }>
): string {
  return [
    row.counts.done ? `${row.counts.done} done` : '',
    row.counts.built ? `${row.counts.built} built` : '',
    row.counts.you ? `${row.counts.you} waiting on you` : '',
    row.counts.building ? `${row.counts.building} being built` : '',
    row.counts.notstarted ? `${row.counts.notstarted} not started` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

export function readReleaseVersionLayouts(
  storage = rendererStorage()
): Record<string, ReleaseVersionLayout> {
  return readStoredRecord(storage, RELEASE_VERSION_LAYOUT_STORAGE_KEY, isVersionLayout)
}

export function writeReleaseVersionLayouts(
  layouts: Record<string, ReleaseVersionLayout>,
  storage = rendererStorage()
): void {
  writeStoredRecord(storage, RELEASE_VERSION_LAYOUT_STORAGE_KEY, layouts)
}

export function readReleaseSidebarFolds(storage = rendererStorage()): ReleaseSidebarFolds {
  return readStoredFolds(RELEASE_SIDEBAR_FOLDS_STORAGE_KEY, DEFAULT_RELEASE_SIDEBAR_FOLDS, storage)
}

export function writeReleaseSidebarFolds(
  folds: ReleaseSidebarFolds,
  storage = rendererStorage()
): void {
  writeStoredFolds(RELEASE_SIDEBAR_FOLDS_STORAGE_KEY, folds, storage)
}

function rendererStorage(): RendererStorage {
  return localStorage
}

function isVersionLayout(value: unknown): value is ReleaseVersionLayout {
  return value === 'pills' || value === 'rail'
}
