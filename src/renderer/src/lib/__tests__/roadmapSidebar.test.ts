import { beforeEach, describe, expect, test } from 'vitest'
import type { ProjectPool } from '../../../../main/qa/pool'
import type { ProjectRelease, ReleaseRecord } from '../../../../main/qa/releaseRecords'
import {
  DEFAULT_ROADMAP_SIDEBAR_FOLDS,
  readRoadmapSidebarFolds,
  roadmapSidebarProjects,
  writeRoadmapSidebarFolds
} from '../roadmapSidebar'

function pool(project: string, states: Array<'pool' | 'setaside' | 'promoted'>): ProjectPool {
  return {
    project,
    directory: `/record/${project}/roadmap`,
    degradedOrder: false,
    ideas: states.map((state, index) => ({
      path: `/record/${project}/roadmap/idea-${index + 1}.md`,
      id: `idea-${index + 1}`,
      title: `Idea ${index + 1}`,
      tier: index % 2 === 0 ? 'functionality' : 'quality-of-life',
      bodyMarkdown: '',
      position: index + 1,
      state,
      isNew: false
    }))
  }
}

function release(project: string, app: string): ProjectRelease {
  const record: ReleaseRecord = {
    path: `/record/${project}/releases/1.0.0.md`,
    version: '1.0.0',
    app,
    release: '1.0.0',
    repo: `apps/${project}`,
    features: [],
    answers: [],
    degraded: false
  }
  return {
    kind: 'recorded',
    project,
    record,
    versions: [{ version: '1.0.0', record }],
    inFlightVersion: '1.0.0'
  }
}

describe('roadmapSidebarProjects', () => {
  test('lists empty projects after projects whose lanes contain ideas', () => {
    const rows = roadmapSidebarProjects(
      ['z-empty', 'mixed', 'a-empty', 'active'],
      [
        pool('mixed', ['pool', 'setaside', 'promoted']),
        pool('active', ['pool', 'pool']),
        pool('z-empty', ['setaside'])
      ],
      []
    )

    expect(rows.map(({ project, group, ideaCount }) => ({ project, group, ideaCount }))).toEqual([
      { project: 'active', group: 'with-ideas', ideaCount: 2 },
      { project: 'mixed', group: 'with-ideas', ideaCount: 1 },
      { project: 'a-empty', group: 'nothing-in-pool', ideaCount: 0 },
      { project: 'z-empty', group: 'nothing-in-pool', ideaCount: 0 }
    ])
  })

  test('counts exactly the ideas shown in the pool lanes and uses the release app name', () => {
    expect(
      roadmapSidebarProjects(
        ['windmill-desktop'],
        [pool('windmill-desktop', ['pool', 'pool', 'setaside', 'promoted'])],
        [release('windmill-desktop', 'Windmill')]
      )[0]
    ).toMatchObject({
      project: 'windmill-desktop',
      app: 'Windmill',
      group: 'with-ideas',
      ideaCount: 2
    })
  })

  test('includes a project found only by the pool scan', () => {
    expect(roadmapSidebarProjects([], [pool('pool-only', ['pool'])], [])[0]).toMatchObject({
      project: 'pool-only',
      group: 'with-ideas',
      ideaCount: 1
    })
  })
})

describe('roadmap sidebar persistence', () => {
  beforeEach(() => localStorage.clear())

  test('starts the empty group collapsed and round-trips group folds', () => {
    expect(readRoadmapSidebarFolds()).toEqual(DEFAULT_ROADMAP_SIDEBAR_FOLDS)
    writeRoadmapSidebarFolds({ 'with-ideas': false, 'nothing-in-pool': true })
    expect(readRoadmapSidebarFolds()).toEqual({
      'with-ideas': false,
      'nothing-in-pool': true
    })
  })
})
