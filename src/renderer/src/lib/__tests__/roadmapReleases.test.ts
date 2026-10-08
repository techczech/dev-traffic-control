import { describe, expect, test } from 'vitest'
import type { PoolIdea, ProjectPool } from '../../../../main/qa/pool'
import type { ProjectRelease } from '../../../../main/qa/releaseRecords'
import {
  derivePendingVersion,
  isOnRoadmap,
  moveTargets,
  newReleaseCandidate,
  nextMinor,
  roadmapView
} from '../roadmapReleases'

function release(versions: string[], inFlight = versions[versions.length - 1]): ProjectRelease {
  return {
    kind: 'recorded',
    project: 'app',
    record: {},
    versions: versions.map((version) => ({ version, record: {} })),
    inFlightVersion: inFlight
  } as unknown as ProjectRelease
}

function idea(
  id: string,
  extra: Omit<Partial<PoolIdea>, 'request'> & { request?: Record<string, unknown> } = {}
): PoolIdea {
  const { request, ...rest } = extra
  return {
    id,
    title: `Title ${id}`,
    tier: 'functionality',
    bodyMarkdown: '',
    state: 'pool',
    path: `/r/app/roadmap/${id}.md`,
    position: 1,
    isNew: false,
    ...rest,
    ...(request ? { request: { said: [], quotes: [], related: [], ...request } } : {})
  } as unknown as PoolIdea
}

const pool = (ideas: PoolIdea[]): ProjectPool =>
  ({ project: 'app', directory: '/r/app/roadmap', ideas, degradedOrder: false }) as ProjectPool

describe('the pending version', () => {
  test('is the next minor after the highest release record, and never a file', () => {
    expect(nextMinor('0.22.0')).toBe('0.23.0')
    expect(derivePendingVersion(release(['0.21.0', '0.22.0']))).toBe('0.23.0')
    expect(derivePendingVersion(release(['0.35.0', '0.14.3']))).toBe('0.36.0')
  })

  test('moves on by itself when the pending release ships or a newer record appears', () => {
    expect(derivePendingVersion(release(['0.22.0']))).toBe('0.23.0')
    // 0.23.0 now has a record (in flight or shipped): the next pending is 0.24.0.
    expect(derivePendingVersion(release(['0.22.0', '0.23.0']))).toBe('0.24.0')
  })

  test('cannot be derived without a record; only then does a typed version count', () => {
    expect(derivePendingVersion({ kind: 'nothing-recorded', project: 'app' })).toBeUndefined()
    expect(derivePendingVersion(undefined, '0.1.0')).toBe('0.1.0')
    expect(derivePendingVersion(release(['0.22.0']), '0.1.0')).toBe('0.23.0')
    expect(derivePendingVersion(release(['0.22.0']), '0.30.0')).toBe('0.30.0')
  })
})

describe('what sits on the Roadmap', () => {
  test('approved ideas only: planned or building, or an idea the reviewer did not say', () => {
    const request = (fate?: string): PoolIdea => idea('x', { request: { by: 'reviewer', fate } })
    expect(isOnRoadmap(request('planned'))).toBe(true)
    expect(isOnRoadmap(request('building'))).toBe(true)
    expect(isOnRoadmap(request('waiting'))).toBe(false)
    expect(isOnRoadmap(request(undefined))).toBe(false)
    expect(isOnRoadmap(request('built'))).toBe(false)
    expect(isOnRoadmap(idea('legacy'))).toBe(true)
    expect(isOnRoadmap(idea('agent', { request: { by: 'agent', fate: 'waiting' } }))).toBe(true)
    expect(isOnRoadmap(idea('aside', { state: 'setaside' }))).toBe(false)
    expect(isOnRoadmap(idea('promoted', { state: 'promoted' }))).toBe(false)
  })
})

describe('the Roadmap grouped by release', () => {
  const ideas = [
    idea('a', {
      candidateRelease: '0.23.0',
      request: { by: 'reviewer', fate: 'planned', quotes: ['say a'] }
    }),
    idea('b', { candidateRelease: '0.25.0', position: 2 }),
    idea('c', { candidateRelease: '0.24.0' }),
    idea('d'),
    idea('e', { candidateRelease: '0.22.0' }),
    idea('f', { candidateRelease: '0.20.0' }),
    idea('w', { candidateRelease: '0.23.0', request: { by: 'reviewer', fate: 'waiting' } })
  ]
  const view = roadmapView(pool(ideas), release(['0.21.0', '0.22.0']))

  test('Pending first, later releases in version order, then Unscheduled', () => {
    expect(view.groups.map((group) => [group.label, group.cards.map((card) => card.id)])).toEqual([
      ['Pending – 0.23.0', ['a']],
      ['0.24.0', ['c']],
      ['0.25.0', ['b']],
      // d has no candidate; f names a release older than any record, and e's release is in flight.
      ['Unscheduled', ['d', 'f']]
    ])
    expect(view.pending).toBe('0.23.0')
    expect(view.inFlight).toBe('0.22.0')
  })

  test('a card says whose idea it is, with the quote for the ones the reviewer said', () => {
    const card = view.groups[0].cards[0]
    expect(card).toMatchObject({ source: 'you', quote: 'say a', tierLabel: 'Functionality' })
    expect(view.groups[1].cards[0].source).toBe('agent')
  })

  test('the filters narrow by whose idea it is and by words, and counts stay whole', () => {
    expect(
      roadmapView(pool(ideas), release(['0.22.0']), { filter: 'you' }).groups.flatMap((g) =>
        g.cards.map((card) => card.id)
      )
    ).toEqual(['a'])
    const agents = roadmapView(pool(ideas), release(['0.22.0']), { filter: 'agent' })
    expect(agents.groups[0].cards).toEqual([])
    expect(agents.counts.pending).toBe(1)
    expect(
      roadmapView(pool(ideas), release(['0.22.0']), { query: 'title c' }).groups.flatMap((g) =>
        g.cards.map((card) => card.id)
      )
    ).toEqual(['c'])
  })

  test('after the pending release ships the next pending is empty and its cards leave', () => {
    const own = [ideas[0], ideas[3]]
    const shipped = roadmapView(pool(own), release(['0.22.0', '0.23.0']))
    expect(shipped.groups[0]).toMatchObject({ kind: 'pending', version: '0.24.0', cards: [] })
    expect(shipped.groups.flatMap((g) => g.cards.map((card) => card.id))).toEqual(['d'])
    // A card aimed at 0.24.0 is in the new pending group, since that is what pending now means.
    expect(roadmapView(pool(ideas), release(['0.22.0', '0.23.0'])).counts.pending).toBe(1)
  })

  test('an approval lands at the bottom of its column', () => {
    const approved = idea('z', {
      candidateRelease: '0.23.0',
      bodyMarkdown: '## Reviewer entry · 2026-10-01 · Approved for the roadmap\n',
      request: { by: 'reviewer', fate: 'planned' }
    })
    const next = roadmapView(pool([approved, ...ideas]), release(['0.22.0']))
    expect(next.groups[0].cards.map((card) => [card.id, card.approvedAt])).toEqual([
      ['a', ''],
      ['z', '2026-10-01']
    ])
  })

  test('without a release record there is no pending group', () => {
    const none = roadmapView(pool(ideas), { kind: 'nothing-recorded', project: 'app' })
    expect(none.pending).toBeUndefined()
    expect(none.groups.map((group) => group.kind)).not.toContain('pending')
  })
})

describe('Move to…', () => {
  const view = roadmapView(
    pool([idea('a', { candidateRelease: '0.23.0' }), idea('b', { candidateRelease: '0.24.0' })]),
    release(['0.22.0'])
  )

  test('lists every group, marks the current one and clears the candidate for Unscheduled', () => {
    const targets = moveTargets(view, 'a')
    expect(targets.map((t) => [t.label, t.candidate, t.count, t.current])).toEqual([
      ['0.23.0 · pending', '0.23.0', 1, true],
      ['0.24.0', '0.24.0', 1, false],
      ['Unscheduled', null, 0, false]
    ])
  })

  test('a new release must be a version later than the pending one', () => {
    expect(newReleaseCandidate('0.26', '0.23.0')).toBe('0.26.0')
    expect(newReleaseCandidate('v0.26.1', '0.23.0')).toBe('0.26.1')
    expect(newReleaseCandidate('0.22.0', '0.23.0')).toBeNull()
    expect(newReleaseCandidate('soon', '0.23.0')).toBeNull()
  })
})
