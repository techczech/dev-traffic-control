import { describe, expect, test } from 'vitest'
import type {
  ProjectRelease,
  ReleaseRecord,
  ReleaseVersion
} from '../../../../main/qa/releaseRecords'
import type { ProjectPool } from '../../../../main/qa/pool'
import { featureReachedAt, groupReleaseVersions, releaseBoardRows } from '../releases'

function record(
  project: string,
  features: ReleaseRecord['features'],
  version = '1.2.0'
): ProjectRelease {
  const releaseRecord: ReleaseRecord = {
    path: `/record/${project}/releases/${version}.md`,
    version,
    app: project,
    release: version,
    repo: `apps/${project}`,
    updated: '2026-08-07T00:00:00.000Z',
    features,
    answers: [],
    degraded: false
  }
  return {
    kind: 'recorded',
    project,
    record: releaseRecord,
    versions: [{ version, record: releaseRecord }],
    inFlightVersion: version
  }
}

describe('releaseBoardRows', () => {
  test('puts apps needing Dominik first and carries all five state words', () => {
    const rows = releaseBoardRows([
      record('steady-app', [
        {
          id: 'not-started',
          title: 'Not started feature',
          kind: 'feature',
          declaredState: 'notstarted',
          status: 'notstarted'
        },
        {
          id: 'building',
          title: 'Building feature',
          kind: 'feature',
          declaredState: 'building',
          status: 'building'
        },
        {
          id: 'built',
          title: 'Built feature',
          kind: 'feature',
          declaredState: 'built',
          status: 'built'
        },
        {
          id: 'done',
          title: 'Done feature',
          kind: 'feature',
          declaredState: 'you',
          status: 'done'
        }
      ]),
      record('waiting-app', [
        {
          id: 'waiting',
          title: 'Waiting feature',
          kind: 'feature',
          declaredState: 'you',
          status: 'you'
        }
      ])
    ])

    expect(rows.map((row) => row.project)).toEqual(['waiting-app', 'steady-app'])
    expect(
      rows
        .flatMap((row) => (row.kind === 'recorded' ? row.features : []))
        .flatMap((feature) => (feature.kind === 'feature' ? [feature.state] : []))
    ).toEqual(['Waiting on you', 'Not started', 'Being built', 'Built and tested', 'Done'])
  })

  test('groundwork has no state or answer route', () => {
    const [row] = releaseBoardRows([
      record('groundwork-app', [
        {
          id: 'engine',
          title: 'The release reader',
          kind: 'groundwork',
          unlocks: 'The board.'
        }
      ])
    ])

    expect(row.kind).toBe('recorded')
    if (row.kind !== 'recorded') return
    expect(row.features[0]).toEqual({
      kind: 'groundwork',
      id: 'engine',
      title: 'The release reader',
      unlocks: 'The board.',
      answerable: false
    })
    expect(row.features[0]).not.toHaveProperty('state')
  })

  test('an absent releases folder remains the no-record app case', () => {
    expect(releaseBoardRows([{ kind: 'nothing-recorded', project: 'pebbles' }])).toEqual([
      {
        kind: 'nothing-recorded',
        project: 'pebbles',
        app: 'pebbles'
      }
    ])
  })

  test('derives one proposed release when a promoted idea has no declared record', () => {
    const rows = releaseBoardRows(
      [{ kind: 'nothing-recorded', project: 'pebbles' }],
      [pool('pebbles', [{ id: 'share', title: 'Share a pebbles', release: '0.4.0' }])]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'proposed',
      project: 'pebbles',
      app: 'pebbles',
      version: '0.4.0',
      release: '0.4.0',
      label: 'Proposed',
      answerable: false,
      shippable: false,
      features: [
        {
          kind: 'feature',
          id: 'share',
          title: 'Share a pebbles',
          status: 'notstarted',
          state: 'Not started',
          answerable: false
        }
      ]
    })
  })

  test('replaces a proposed release with the declared group without duplicating its feature', () => {
    const rows = releaseBoardRows(
      [
        record(
          'pebbles',
          [
            {
              id: 'share',
              title: 'Share a pebbles with a collaborator',
              kind: 'feature',
              declaredState: 'building',
              status: 'building'
            }
          ],
          '0.4.0'
        )
      ],
      [pool('pebbles', [{ id: 'share', title: 'Share a pebbles', release: '0.4.0' }])]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'recorded', version: '0.4.0' })
    if (rows[0]?.kind !== 'recorded') return
    expect(rows[0].features).toHaveLength(1)
    expect(rows[0].features[0]).toMatchObject({
      id: 'share',
      title: 'Share a pebbles with a collaborator'
    })
  })

  test('an app whose features are all Done collapses', () => {
    const [row] = releaseBoardRows([
      record('finished-app', [
        {
          id: 'one',
          title: 'One',
          kind: 'feature',
          declaredState: 'you',
          status: 'done'
        },
        {
          id: 'two',
          title: 'Two',
          kind: 'feature',
          declaredState: 'you',
          status: 'done'
        }
      ])
    ])

    expect(row.kind).toBe('recorded')
    if (row.kind === 'recorded') expect(row.collapsed).toBe(true)
  })

  test('derives one unanswerable Not started row for a promoted pool idea', () => {
    const [row] = releaseBoardRows(
      [record('dev-traffic-control', [])],
      [pool('dev-traffic-control', [{ id: 'tabs', title: 'The tabs', release: '1.2.0' }])]
    )

    expect(row.kind).toBe('recorded')
    if (row.kind !== 'recorded') return
    expect(row.features).toEqual([
      {
        kind: 'feature',
        id: 'tabs',
        title: 'The tabs',
        status: 'notstarted',
        state: 'Not started',
        answerable: false,
        prose: 'Body for tabs.'
      }
    ])
    expect(row.counts.notstarted).toBe(1)
  })

  test('does not derive a promoted idea already declared by matching id', () => {
    const [row] = releaseBoardRows(
      [
        record('dev-traffic-control', [
          {
            id: 'tabs',
            title: 'The declared tabs',
            kind: 'feature',
            declaredState: 'building',
            status: 'building'
          }
        ])
      ],
      [pool('dev-traffic-control', [{ id: 'tabs', title: 'The pool tabs', release: '1.2.0' }])]
    )

    expect(row.kind).toBe('recorded')
    if (row.kind !== 'recorded') return
    expect(row.features).toHaveLength(1)
    expect(row.features[0]).toMatchObject({ id: 'tabs', title: 'The declared tabs' })
  })
})

describe('groupReleaseVersions', () => {
  test('groups shipped fixes under the release they patch without grouping the release in flight', () => {
    const versions = [
      releaseVersion('0.19.0', true),
      releaseVersion('0.19.2', true, '0.19.0'),
      releaseVersion('0.19.4', true, '0.19.0'),
      releaseVersion('0.19.6', false)
    ]

    expect(groupReleaseVersions(versions)).toMatchObject([
      { release: { version: '0.19.6' }, fixes: [] },
      {
        release: { version: '0.19.0' },
        fixes: [{ version: '0.19.4' }, { version: '0.19.2' }]
      }
    ])
  })

  test('keeps a project with exactly one release as one rail group', () => {
    expect(groupReleaseVersions([releaseVersion('0.15.0', false)])).toMatchObject([
      { release: { version: '0.15.0' }, fixes: [] }
    ])
  })
})

function releaseVersion(version: string, shipped: boolean, fixesTo?: string): ReleaseVersion {
  return {
    version,
    record: {
      path: `/record/wordforge/releases/${version}.md`,
      version,
      app: 'WordForge',
      release: version,
      repo: 'apps/wordforge',
      features: [],
      answers: [],
      degraded: false
    },
    ...(shipped
      ? {
          shipment: {
            app: 'WordForge',
            release: version,
            notes: `Notes for ${version}`,
            shippedAt: '2026-08-06T12:00:00.000Z',
            returnedFeatureIds: [],
            ...(fixesTo ? { fixesTo } : {})
          }
        }
      : {})
  }
}

function pool(
  project: string,
  ideas: Array<{ id: string; title: string; release: string }>
): ProjectPool {
  return {
    project,
    directory: `/record/${project}/roadmap`,
    degradedOrder: false,
    ideas: ideas.map((idea, index) => ({
      path: `/record/${project}/roadmap/${idea.id}.md`,
      id: idea.id,
      title: idea.title,
      tier: 'functionality',
      bodyMarkdown: `Body for ${idea.id}.`,
      position: index + 1,
      state: 'promoted',
      candidateRelease: idea.release,
      specWanted: false,
      stateAt: '2026-08-07T10:00:00.000Z',
      isNew: false
    }))
  }
}

// Ticket 25 (coordinator amendment): an answer changes the state, so the row's
// date is the later of since: and the answer's time.
describe('featureReachedAt', () => {
  const localIso = (d: number, h: number): string => new Date(2026, 8, d, h).toISOString()

  test('a since day newer than a stale answer wins', () => {
    expect(
      featureReachedAt({
        since: '2026-09-27',
        answer: { at: localIso(20, 15) }
      })
    ).toBe('2026-09-27')
  })

  test('an answer newer than since wins', () => {
    const at = localIso(27, 10)
    expect(featureReachedAt({ since: '2026-09-20', answer: { at } })).toBe(at)
  })

  test('on the same day an answer after midnight is newer than the since day', () => {
    const at = localIso(27, 0) // 00:00 local counts as the day's start, not after it
    expect(featureReachedAt({ since: '2026-09-27', answer: { at } })).toBe('2026-09-27')
    const later = localIso(27, 9)
    expect(featureReachedAt({ since: '2026-09-27', answer: { at: later } })).toBe(later)
  })

  test('either alone, and neither', () => {
    expect(featureReachedAt({ since: '2026-09-27' })).toBe('2026-09-27')
    expect(featureReachedAt({ answer: { at: localIso(1, 9) } })).toBe(localIso(1, 9))
    expect(featureReachedAt({})).toBe('')
  })
})
