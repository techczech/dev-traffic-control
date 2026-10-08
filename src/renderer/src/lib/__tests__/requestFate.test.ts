import { describe, expect, test } from 'vitest'
import type { FeatureRequestFields } from '../../../../main/qa/featureRequest'
import type { PoolIdea } from '../../../../main/qa/pool'
import {
  actionsForFate,
  fateLabel,
  groupOfFate,
  isRequestIdeaOwed,
  readEntries,
  releaseOfIdea,
  unansweredReply,
  withReviewerEntry
} from '../requestFate'

const idea = (request: Partial<FeatureRequestFields>, extra: Partial<PoolIdea> = {}): PoolIdea =>
  ({
    id: 'a',
    title: 'A',
    tier: 'functionality',
    bodyMarkdown: 'Body.',
    state: 'pool',
    request: { said: [], quotes: [], related: [], ...request },
    ...extra
  }) as PoolIdea

describe('fate groups and chip words', () => {
  test('built, merged and declined are Finished; missing or unknown is No plan yet', () => {
    expect(
      (['waiting', 'planned', 'building', 'built', 'merged', 'declined', undefined] as const).map(
        groupOfFate
      )
    ).toEqual(['waiting', 'planned', 'planned', 'finished', 'finished', 'finished', 'none'])
  })

  test('the chip names the release from the note, else the candidate', () => {
    const building = idea(
      { by: 'reviewer', fate: 'building', fateNote: 'in 0.4.0-beta.3, installed 1 Oct' },
      { candidateRelease: '0.22.0' }
    )
    expect(releaseOfIdea(building)).toBe('0.4.0-beta.3')
    expect(fateLabel(building)).toBe('Building in 0.4.0-beta.3')
    expect(fateLabel(idea({ fate: 'planned' }, { candidateRelease: '0.23.0' }))).toBe(
      'On the roadmap · 0.23.0'
    )
    // The pending release is named as such.
    expect(fateLabel(idea({ fate: 'planned' }, { candidateRelease: '0.23.0' }), '0.23.0')).toBe(
      'On the roadmap · 0.23.0 (pending)'
    )
    expect(fateLabel(idea({ fate: 'planned' }))).toBe('On the roadmap')
    expect(fateLabel(idea({ fate: 'merged' }))).toBe('Merged')
    expect(fateLabel(idea({ fate: undefined }))).toBe('No plan yet')
  })
})

describe('entries in the body', () => {
  test('a reviewer entry is appended and read back, oldest first', () => {
    const once = withReviewerEntry('Body.', {
      answer: 'Approved the plan',
      note: '',
      at: '2026-10-01'
    })
    const twice = withReviewerEntry(once, {
      answer: 'Wants the plan changed',
      note: 'Make it a tab.\nNot a toggle.',
      at: '2026-10-02'
    })
    const { intro, entries } = readEntries(twice)
    expect(intro).toBe('Body.')
    expect(entries).toEqual([
      { by: 'reviewer', at: '2026-10-01', answer: 'Approved the plan', note: '' },
      {
        by: 'reviewer',
        at: '2026-10-02',
        answer: 'Wants the plan changed',
        note: 'Make it a tab.\nNot a toggle.'
      }
    ])
  })

  test('an agent entry after the reviewer\'s answers it', () => {
    const body = `Body.\n\n## Reviewer entry · 2026-10-01 · Not now\n\n## Agent entry · 2026-10-02 · Parked\n\nWill revisit.\n`
    const { entries } = readEntries(body)
    expect(entries.map((entry) => entry.by)).toEqual(['reviewer', 'agent'])
    expect(unansweredReply(entries)).toBeUndefined()
    expect(unansweredReply(entries.slice(0, 1))?.answer).toBe('Not now')
  })

  test('an entry heading with a date and no answer reads as an empty answer, not an exception', () => {
    // An entry heading may carry a date and nothing after it.
    const body = 'Body.\n\n## Agent entry · 2020-01-01\n\nSaid it is planned.\n'
    const { entries } = readEntries(body)
    expect(entries).toEqual([
      { by: 'agent', at: '2020-01-01', answer: '', note: 'Said it is planned.' }
    ])
    expect(() => unansweredReply(entries)).not.toThrow()
  })

  test('an entry heading with no date and no answer survives too', () => {
    const { entries } = readEntries('## Reviewer entry\n\nWords.')
    expect(entries).toEqual([{ by: 'reviewer', at: '', answer: '', note: 'Words.' }])
  })

  test('a body with no entries is all intro', () => {
    expect(readEntries('Just prose.\n\n## Other heading')).toEqual({
      intro: 'Just prose.\n\n## Other heading',
      entries: []
    })
  })
})

describe('owed', () => {
  test('a waiting request is owed until the reviewer answers after the agent last spoke', () => {
    const waiting = idea({ by: 'reviewer', fate: 'waiting' })
    expect(isRequestIdeaOwed(waiting)).toBe(true)
    const answered = {
      ...waiting,
      bodyMarkdown: withReviewerEntry('Body.', { answer: 'Not now', note: '', at: '2026-10-01' })
    }
    expect(isRequestIdeaOwed(answered)).toBe(false)
    expect(
      isRequestIdeaOwed({
        ...answered,
        bodyMarkdown: `${answered.bodyMarkdown}\n## Agent entry · 2026-10-02 · New plan\n`
      })
    ).toBe(true)
  })

  test("only the reviewer's own, waiting, not set aside", () => {
    expect(isRequestIdeaOwed(idea({ by: 'agent', fate: 'waiting' }))).toBe(false)
    expect(isRequestIdeaOwed(idea({ by: 'reviewer', fate: 'planned' }))).toBe(false)
    expect(
      isRequestIdeaOwed(idea({ by: 'reviewer', fate: 'waiting' }, { state: 'setaside' }))
    ).toBe(false)
    expect(isRequestIdeaOwed({ id: 'x', state: 'pool' } as PoolIdea)).toBe(false)
  })
})

describe('what the reviewer can do comes from the fate', () => {
  test('waiting and built give three buttons, planned two, building one; the others none', () => {
    expect(actionsForFate('waiting').map((action) => action.label)).toEqual([
      'Approve → Roadmap',
      'Change it',
      'Not now'
    ])
    expect(actionsForFate('planned').map((action) => action.label)).toEqual([
      'Open on the Roadmap',
      'Take it off the roadmap'
    ])
    expect(actionsForFate('built').map((action) => action.label)).toEqual([
      'Try it',
      'It is not right',
      'Fold it away'
    ])
    expect(actionsForFate('building').map((action) => action.label)).toEqual([
      'Open on the Roadmap'
    ])
    for (const fate of ['merged', 'declined', undefined] as const) {
      expect(actionsForFate(fate)).toEqual([])
    }
  })
})
