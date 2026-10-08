import { describe, expect, test } from 'claude-code/testing'

import { answersText, normaliseAnswers } from './answers'
import { detailedReport, docReviewReport, inProgressReport, lightReport } from './fixtures'

const ref = { project: 'p', rel: '2026-01-01-a.md' }

describe('answers normalisation', () => {
  test('light report with observations', () => {
    const r = normaliseAnswers(ref, lightReport, false)
    if (!r.ok) throw new Error(r.message)
    expect(r.answers.mode).toBe('light')
    expect(r.answers.items[0]?.status).toBe('pass')
    expect(r.answers.observations).toEqual([
      { id: 'obs-1', text: 'Slow first open', screenshots: 1, markups: [{ picture: 'a.png', marked: 'a-marked.png', notes: 'picture', marks: [{ n: 1, shape: 'text', text: 'spinner sits here for two seconds' }] }] },
    ])
    expect(r.answers.isCollected).toBe(false)
    expect(r.answers.link).toBe('dtc://open/p/2026-01-01-a.md')
  })
  test('doc review decisions come from items[*].decisions with their marks and words; empty choice is null', () => {
    const r = normaliseAnswers(ref, docReviewReport, true)
    if (!r.ok) throw new Error(r.message)
    const d = r.answers.items[0]?.decisions ?? []
    expect(d.map(x => x.choice)).toEqual(['Layout A', 'Layout B', null])
    expect(d[0]?.markups).toEqual([])
    expect(d[1]).toEqual({
      id: 'reset',
      question: 'Password reset?',
      choice: 'Layout B',
      comment: 'b as the default',
      // No `notes` on the record: an older one, which has numbered pins.
      markups: [
        {
          picture: 'layout-b.png',
          marked: 'layout-b-marked.png',
          notes: 'list',
          option: 'Layout B',
          marks: [
            { n: 1, shape: 'box', text: 'make this the primary button' },
            { n: 2, shape: 'arrow', text: '' },
          ],
        },
      ],
    })
    expect(r.answers.isCollected).toBe(true)
  })
  test('detailed item: flagged, quotes, counts; removed items dropped', () => {
    const r = normaliseAnswers(ref, detailedReport, false)
    if (!r.ok) throw new Error(r.message)
    expect(r.answers.items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd'])
    const a = r.answers.items[0]
    expect(a?.flagged).toEqual([{ expectedIndex: 1, text: 'Sidebar 30%', comment: 'Drops to 24%' }])
    expect(a?.screenshots).toBe(2)
    // Every mark keeps its words; a non-object mark is dropped, a mark with parts missing reads as empty.
    expect(a?.markups).toEqual([{ picture: 's1.png', marked: 'm.png', notes: 'list', marks: [{ n: 1, shape: 'box', text: 'sidebar too narrow' }, { n: null, shape: 'text', text: '' }] }])
    expect(r.answers.items[1]?.markups).toEqual([])
    expect(r.answers.items[3]?.status).toBe('unanswered')
    expect(answersText(r.answers)).toContain('"expectedIndex": 1')
  })
  test('missing, not final and malformed report each error plainly', () => {
    const missing = normaliseAnswers(ref, null, false)
    const partial = normaliseAnswers(ref, inProgressReport, false)
    const bad = normaliseAnswers(ref, '{"comp', false)
    expect(missing.ok).toBe(false)
    expect(partial.ok === false && partial.message).toContain('not final')
    expect(bad.ok === false && bad.message).toContain('malformed')
    expect(missing.ok === false && missing.message).toContain('p/2026-01-01-a')
  })
})

describe('dtc_answers holds to a valid completion', () => {
  const NOW = Date.parse('2026-10-03T12:00:00Z')
  const report = (completedAt: string) => JSON.stringify({ title: 't', items: [], completedAt })
  test('a non-ISO, future or pre-filing completedAt is not final', () => {
    expect(normaliseAnswers(ref, report('forged'), false, { now: NOW }).ok).toBe(false)
    expect(normaliseAnswers(ref, report('2026-10-03T13:00:00Z'), false, { now: NOW }).ok).toBe(false)
    expect(normaliseAnswers(ref, report('2026-10-01T00:00:00Z'), false, { now: NOW, filedAt: Date.parse('2026-10-02T00:00:00Z') }).ok).toBe(false)
    expect(normaliseAnswers(ref, report('2026-10-03T11:00:00Z'), false, { now: NOW, filedAt: Date.parse('2026-10-02T00:00:00Z') }).ok).toBe(true)
  })
})
