import { describe, expect, test } from 'vitest'
import type { PoolIdea } from '../../../../main/qa/pool'
import type { QaSnapshot } from '../../../../shared/ipc'
import {
  featureRequestRows,
  filterRequests,
  groupRequests,
  noPlanBanner,
  noteBesideRelease,
  tallyRequests
} from '../featureRequests'
import { projectHome } from '../projectHome'
import { projectStandings, owedPhrase } from '../projectStanding'
import { recordIndex, relatedChips } from '../recordChips'
import { surfaceCounts } from '../surfaceCounts'
import { withReviewerEntry } from '../requestFate'

const NOW = new Date('2026-10-01T12:00:00Z')

function idea(
  id: string,
  extra: Omit<Partial<PoolIdea>, 'request'> & { request?: Record<string, unknown> }
): PoolIdea {
  const { request, ...rest } = extra
  return {
    id,
    title: `Title ${id}`,
    tier: 'functionality',
    added: '2026-09-29',
    bodyMarkdown: 'Body.',
    state: 'pool',
    path: `/r/p/roadmap/${id}.md`,
    position: 1,
    isNew: false,
    ...rest,
    ...(request
      ? {
          request: {
            by: 'reviewer',
            said: [{ where: 'a review', when: '2026-09-29', link: '' }],
            quotes: [`quote ${id}`],
            related: [],
            ...request
          }
        }
      : {})
  } as unknown as PoolIdea
}

function snapshot(pools: Record<string, PoolIdea[]>): QaSnapshot {
  return {
    root: '/r',
    scannedAt: '2026-10-01T10:00:00Z',
    projects: Object.keys(pools),
    runs: [],
    notes: [],
    threads: [],
    entries: [],
    handoffs: [],
    releases: [],
    pools: Object.entries(pools).map(([project, ideas]) => ({
      project,
      directory: `/r/${project}/roadmap`,
      ideas,
      degradedOrder: false
    }))
  } as unknown as QaSnapshot
}

const POOLS = {
  app: [
    idea('w1', { added: '2026-10-01', request: { fate: 'waiting', plan: 'Plan w1' } }),
    idea('n1', { added: '2026-09-26', request: {} }),
    idea('n2', { added: '2026-09-27', request: { fate: 'planned' } }),
    idea('b1', {
      added: '2026-09-29',
      request: { fate: 'building', plan: 'P', fateNote: 'in 0.22.0-beta.3' }
    }),
    idea('p1', {
      added: '2026-09-28',
      candidateRelease: '0.23.0',
      request: { fate: 'planned', plan: 'P' }
    }),
    idea('f1', { request: { fate: 'built', plan: 'P' } }),
    idea('f2', { request: { fate: 'merged' } }),
    idea('f3', { request: { fate: 'declined', plan: 'P' } }),
    idea('agent', { request: { by: 'agent', fate: 'planned', plan: 'P' } }),
    idea('plain', {})
  ],
  other: [idea('o1', { added: '2026-10-01', request: { fate: 'planned', plan: 'P' } })]
}

describe('the Feature requests list', () => {
  const rows = featureRequestRows(snapshot(POOLS), { kind: 'project', slug: 'app' }, NOW)

  test('lists only ideas by the reviewer, in the window scope', () => {
    expect(rows.map((row) => row.id).sort()).toEqual(
      ['b1', 'f1', 'f2', 'f3', 'n1', 'n2', 'p1', 'w1'].sort()
    )
    const all = featureRequestRows(snapshot(POOLS), { kind: 'all' }, NOW)
    expect(all.map((row) => row.key)).toContain('other/o1')
    expect(all).toHaveLength(9)
  })

  test('groups by fate in the fixed order; no fate and an unknown fate are No plan yet', () => {
    const groups = groupRequests(rows, tallyRequests(rows))
    expect(groups.map((group) => [group.label, group.rows.map((row) => row.id)])).toEqual([
      ['Waiting on you', ['w1']],
      ['No plan yet', ['n1']],
      ['On the roadmap', ['b1', 'p1', 'n2']],
      ['Finished', ['f1', 'f2', 'f3']]
    ])
    expect(groups.find((group) => group.group === 'finished')?.foldable).toBe(true)
    expect(groups.find((group) => group.group === 'finished')?.sub).toBe(
      '1 built · 1 merged · 1 declined'
    )
  })

  test('the banner counts open requests with no plan or no fate', () => {
    const tally = tallyRequests(rows)
    // n1 (no fate, no plan) and n2 (planned, no plan); the finished f2 is not owed a plan.
    expect(tally.owedPlan).toBe(2)
    expect(noPlanBanner(tally.owedPlan)).toBe('2 without a plan: the agent owes these.')
    expect(noPlanBanner(0)).toBe('')
    expect(tally.open).toBe(5)
    expect(tally.groups.finished).toBe(3)
  })

  test('the chip, the quote and where he said it come from the file', () => {
    const building = rows.find((row) => row.id === 'b1')!
    expect(building.fateLabel).toBe('Building in 0.22.0-beta.3')
    expect(building.quotes).toEqual([
      { text: 'quote b1', where: 'in a review', when: '29 Sep', link: '' }
    ])
  })

  test('the filter chip and the search words narrow the list', () => {
    expect(
      filterRequests(rows, 'planned', '')
        .map((row) => row.id)
        .sort()
    ).toEqual(['b1', 'n2', 'p1'])
    expect(filterRequests(rows, 'everything', 'quote w1').map((row) => row.id)).toEqual(['w1'])
  })

  test('the tab count is the open requests, with or without a project in scope', () => {
    const snap = snapshot(POOLS)
    expect(
      surfaceCounts(snap, { kind: 'project', slug: 'app' }, new Set(), new Set()).requests
    ).toBe(5)
    expect(surfaceCounts(snap, { kind: 'all' }, new Set(), new Set()).requests).toBe(6)
  })
})

describe('a waiting request is owed, and shows up on the Dash as an Answer row', () => {
  const snap = snapshot(POOLS)

  test('the project standing counts it and says so', () => {
    const standing = projectStandings(snap, NOW).find((candidate) => candidate.slug === 'app')!
    expect(standing.owed.suggestions).toBe(1)
    expect(standing.owed.total).toBe(1)
    expect(standing.needsYou).toBe(true)
    expect(owedPhrase(standing.owed)).toBe('suggestion to answer')
  })

  test('the Project Dash row says what to do', () => {
    const home = projectHome(snap, 'app', NOW)!
    const row = home.waitingAll.find((candidate) => candidate.key === 'waiting:request:w1')!
    expect(row.title).toBe('Your suggestion: Title w1')
    expect(row.wait).toMatchObject({
      kind: 'answer',
      tag: 'Answer',
      lead: 'Approve → Roadmap?',
      rest: ' · you asked in a review, 29 Sep · plan: Plan w1',
      action: 'Approve → Roadmap'
    })
    expect(row.target).toEqual({ kind: 'request', project: 'app', idea: 'w1' })
    expect(home.waiting.total).toBe(1)
  })

  test('answering takes it out of Waiting on you', () => {
    const answered = snapshot({
      app: [
        idea('w1', {
          bodyMarkdown: withReviewerEntry('Body.', {
            answer: 'Approved the plan',
            note: '',
            at: '2026-10-01'
          }),
          request: { fate: 'waiting', plan: 'Plan w1' }
        })
      ]
    })
    expect(projectStandings(answered, NOW)[0].owed.suggestions).toBe(0)
    expect(projectHome(answered, 'app', NOW)!.waitingAll).toEqual([])
    const [row] = featureRequestRows(answered, { kind: 'all' }, NOW)
    expect(row.owed).toBe(false)
    expect(row.group).toBe('waiting')
    expect(row.answered?.answer).toBe('Approved the plan')
  })
})

describe('Related chips', () => {
  const snap = snapshot({
    app: [
      idea('first', { request: { fate: 'built', plan: 'P', candidateRelease: undefined } }),
      idea('second', { request: { fate: 'planned', plan: 'P' }, candidateRelease: '0.23.0' }),
      idea('plain', {})
    ]
  })
  const index = recordIndex(snap, ['app'], NOW)

  test('an idea id resolves to a chip with its state; a plain idea to the Roadmap', () => {
    const chips = relatedChips(
      ['second', 'plain', 'ticket-28', 'dtc://open/app/roadmap/first'],
      index
    )
    expect(chips.map((entry) => entry.chip?.state ?? null)).toEqual([
      'On the roadmap · 0.23.0',
      'Idea in the pool',
      null,
      'Built'
    ])
    expect(chips[0].chip?.target).toEqual({ kind: 'requests', project: 'app', idea: 'second' })
    expect(chips[1].chip?.target).toEqual({ kind: 'roadmap', idea: 'plain' })
  })
})

test('the note beside the release chip drops the "in <release>" the chip already says', () => {
  expect(noteBesideRelease('in 0.22.0-beta.2, installed 30 Sep')).toBe('installed 30 Sep')
  expect(noteBesideRelease('in 0.22.0')).toBe('')
  expect(noteBesideRelease('in the next sprint')).toBe('in the next sprint')
  expect(noteBesideRelease('merged into decisions')).toBe('merged into decisions')
})
