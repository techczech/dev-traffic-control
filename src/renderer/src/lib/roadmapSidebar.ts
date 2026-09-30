import type { ProjectPool } from '../../../main/qa/pool'
import type { ProjectRelease } from '../../../main/qa/releaseRecords'
import { displayProjectName, readStoredFolds, writeStoredFolds } from './projectSidebar'

export type RoadmapSidebarGroup = 'with-ideas' | 'nothing-in-pool'
export type RoadmapSidebarFolds = Record<RoadmapSidebarGroup, boolean>

export interface RoadmapSidebarProject {
  project: string
  app: string
  group: RoadmapSidebarGroup
  ideaCount: number
}

export const DEFAULT_ROADMAP_SIDEBAR_FOLDS: RoadmapSidebarFolds = {
  'with-ideas': true,
  'nothing-in-pool': false
}

export const ROADMAP_SIDEBAR_FOLDS_STORAGE_KEY = 'dtc.roadmap.sidebar-folds.v1'

const GROUP_ORDER: Record<RoadmapSidebarGroup, number> = {
  'with-ideas': 0,
  'nothing-in-pool': 1
}

export function roadmapSidebarProjects(
  projects: readonly string[],
  pools: readonly ProjectPool[],
  releases: readonly ProjectRelease[]
): RoadmapSidebarProject[] {
  const poolByProject = new Map(pools.map((pool) => [pool.project, pool]))
  const appByProject = new Map(
    releases.flatMap((release) =>
      release.kind === 'recorded' && release.record.app
        ? [[release.project, release.record.app] as const]
        : []
    )
  )
  const allProjects = new Set([...projects, ...pools.map((pool) => pool.project)])

  return [...allProjects]
    .map((project): RoadmapSidebarProject => {
      const ideaCount =
        poolByProject.get(project)?.ideas.filter((idea) => idea.state === 'pool').length ?? 0
      return {
        project,
        app: appByProject.get(project) ?? displayProjectName(project),
        group: ideaCount > 0 ? 'with-ideas' : 'nothing-in-pool',
        ideaCount
      }
    })
    .sort(
      (left, right) =>
        GROUP_ORDER[left.group] - GROUP_ORDER[right.group] || left.app.localeCompare(right.app)
    )
}

export function readRoadmapSidebarFolds(): RoadmapSidebarFolds {
  return readStoredFolds(ROADMAP_SIDEBAR_FOLDS_STORAGE_KEY, DEFAULT_ROADMAP_SIDEBAR_FOLDS)
}

export function writeRoadmapSidebarFolds(folds: RoadmapSidebarFolds): void {
  writeStoredFolds(ROADMAP_SIDEBAR_FOLDS_STORAGE_KEY, folds)
}
