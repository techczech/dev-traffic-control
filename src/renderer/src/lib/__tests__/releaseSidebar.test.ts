import { beforeEach, describe, expect, test } from 'vitest'
import type {
  ProjectRelease,
  ReleaseFeature,
  ReleaseRecord
} from '../../../../main/qa/releaseRecords'
import {
  DEFAULT_RELEASE_SIDEBAR_FOLDS,
  readReleaseSidebarFolds,
  readReleaseVersionLayouts,
  releaseDetailTally,
  releaseNarrowNavigationColumn,
  releaseSidebarProjects,
  writeReleaseSidebarFolds,
  writeReleaseVersionLayouts
} from '../releaseSidebar'

function record(project: string, states: ReleaseRecord['features']): ProjectRelease {
  const release: ReleaseRecord = {
    path: `/record/${project}/releases/1.0.0.md`,
    version: '1.0.0',
    app: project,
    release: '1.0.0',
    repo: `apps/${project}`,
    features: states,
    answers: [],
    degraded: false
  }
  return {
    kind: 'recorded',
    project,
    record: release,
    versions: [{ version: '1.0.0', record: release }],
    inFlightVersion: '1.0.0'
  }
}

function feature(
  id: string,
  status: 'notstarted' | 'building' | 'built' | 'you' | 'done'
): ReleaseFeature {
  return {
    id,
    title: id,
    kind: 'feature' as const,
    declaredState: status === 'done' ? ('you' as const) : status,
    status
  }
}

describe('releaseSidebarProjects', () => {
  test('groups projects in Needs you, In flight, Nothing declared order', () => {
    const projects = releaseSidebarProjects(
      ['z-empty', 'steady', 'waiting', 'a-empty'],
      [
        { kind: 'nothing-recorded', project: 'z-empty' },
        record('steady', [feature('building', 'building')]),
        record('waiting', [feature('answer', 'you')]),
        { kind: 'nothing-recorded', project: 'a-empty' }
      ],
      []
    )

    expect(projects.map(({ project, group, state }) => ({ project, group, state }))).toEqual([
      { project: 'waiting', group: 'needs-you', state: 'Needs you' },
      { project: 'steady', group: 'in-flight', state: 'In flight' },
      { project: 'a-empty', group: 'nothing-declared', state: 'Nothing declared' },
      { project: 'z-empty', group: 'nothing-declared', state: 'Nothing declared' }
    ])
  })

  test('includes a project missing from the release scan as Nothing declared', () => {
    expect(releaseSidebarProjects(['unscanned'], [], [])[0]).toMatchObject({
      project: 'unscanned',
      group: 'nothing-declared',
      state: 'Nothing declared'
    })
  })
})

describe('release sidebar persistence', () => {
  beforeEach(() => localStorage.clear())

  test('round-trips per-project pills and rail choices', () => {
    writeReleaseVersionLayouts({ wordforge: 'rail', tallyboard: 'pills' })
    expect(readReleaseVersionLayouts()).toEqual({ wordforge: 'rail', tallyboard: 'pills' })
  })

  test('starts Nothing declared collapsed and round-trips group folds', () => {
    expect(readReleaseSidebarFolds()).toEqual(DEFAULT_RELEASE_SIDEBAR_FOLDS)
    writeReleaseSidebarFolds({
      'needs-you': true,
      'in-flight': false,
      'nothing-declared': false
    })
    expect(readReleaseSidebarFolds()).toEqual({
      'needs-you': true,
      'in-flight': false,
      'nothing-declared': false
    })
  })
})

test('the opt-in rail owns the narrow navigation column until it is turned off', () => {
  expect(releaseNarrowNavigationColumn('rail')).toBe('versions')
  expect(releaseNarrowNavigationColumn('pills')).toBe('projects')
})

test('releaseDetailTally counts only the selected project detail', () => {
  const rows = releaseSidebarProjects(
    ['selected', 'other'],
    [
      record('selected', [feature('built', 'built'), feature('answer', 'you')]),
      record('other', [feature('other-1', 'you'), feature('other-2', 'you')])
    ],
    []
  )
  const selected = rows.find((row) => row.project === 'selected')

  expect(selected?.detail && releaseDetailTally(selected.detail)).toBe('1 built · 1 waiting on you')
})
