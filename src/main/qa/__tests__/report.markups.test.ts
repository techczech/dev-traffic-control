import { describe, expect, test } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertQaReport, readReport, writeReport } from '../report'
import type { PictureMarkup, QaReport } from '../types'

// Ticket 30: marked-up pictures ride along as an additive, optional `markups`
// field on a decision answer, a report item and an observation. Old reports
// without it validate and load exactly as before.

const MARKUP: PictureMarkup = {
  picture: 'x.images/as-3a.png',
  marked: 'x.shots/document-1.png',
  option: 'AS-3A: one card per corpus',
  marks: [
    { n: 1, shape: 'box', box: { x: 0.212, y: 0.181, w: 0.52, h: 0.139 }, text: 'A state' },
    { n: 2, shape: 'arrow', from: { x: 0.6, y: 0.8 }, to: { x: 0.33, y: 0.61 }, text: '' },
    { n: 3, shape: 'text', at: { x: 0.4, y: 0.7 }, text: 'Free label' }
  ]
}

function report(extra: Partial<QaReport['items'][number]> = {}): QaReport {
  return {
    id: 'r',
    title: 'R',
    startedAt: '2026-09-29T12:00:00.000Z',
    noteFiles: [],
    items: [
      {
        id: 'document',
        title: 'R',
        status: 'unanswered',
        comment: '',
        flagged: [],
        quotes: [],
        screenshots: [],
        ...extra
      }
    ]
  }
}

describe('report markups', () => {
  test('a report without marks validates and round-trips with no new keys', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'markups-'))
    const p = path.join(dir, 'old.report.json')
    const old = report({ decisions: [{ id: 'd', question: 'Q?', choice: 'A' }] })
    await writeFile(p, JSON.stringify(old))
    const loaded = await readReport(p)
    expect(loaded).toEqual(old)
    expect(JSON.stringify(loaded)).not.toContain('markups')
  })

  test('marks on a decision, a screenshot and an observation validate and round-trip', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'markups-'))
    const p = path.join(dir, 'x.report.json')
    const shot: PictureMarkup = {
      picture: 'x.shots/document-1.png',
      marked: 'x.shots/document-2.png',
      marks: MARKUP.marks
    }
    const r: QaReport = {
      ...report({
        screenshots: ['x.shots/document-1.png'],
        markups: [shot],
        decisions: [{ id: 'corpus-home', question: 'Which?', choice: 'AS-3A', markups: [MARKUP] }]
      }),
      mode: 'light',
      observations: [{ id: 'obs-1', text: 't', screenshots: [shot.picture], markups: [shot] }]
    }
    await writeReport(p, r)
    expect(await readReport(p)).toEqual(r)
  })

  test.each([
    ['a shape outside the three', { n: 1, shape: 'circle', at: { x: 0.1, y: 0.1 }, text: '' }],
    ['a coordinate above 1', { n: 1, shape: 'text', at: { x: 1.2, y: 0.1 }, text: '' }],
    [
      'a negative box size',
      { n: 1, shape: 'box', box: { x: 0.1, y: 0.1, w: -0.1, h: 0.1 }, text: '' }
    ],
    ['an arrow without its head', { n: 1, shape: 'arrow', from: { x: 0.1, y: 0.1 }, text: '' }],
    ['a pin number of 0', { n: 0, shape: 'text', at: { x: 0.1, y: 0.1 }, text: '' }],
    ['text that is not a string', { n: 1, shape: 'text', at: { x: 0.1, y: 0.1 }, text: 3 }]
  ])('a malformed mark is rejected: %s', (_label, mark) => {
    const bad = report({ markups: [{ ...MARKUP, marks: [mark as never] }] })
    expect(() => assertQaReport(bad)).toThrow(
      /Invalid QaReport: items\[0\]\.markups\[0\]\.marks\[0\]/
    )
  })

  test('repeated pin numbers are rejected', () => {
    const twice = [MARKUP.marks[0], { ...MARKUP.marks[2], n: 1 }]
    expect(() => assertQaReport(report({ markups: [{ ...MARKUP, marks: twice }] }))).toThrow(
      /repeats a number/
    )
  })

  test.each(['/tmp/evil.png', '../outside.png', 'x.shots/../../evil.png', ''])(
    'a marked copy that climbs out of the request folder is rejected: %s',
    (marked) => {
      const bad = report({
        decisions: [{ id: 'd', question: 'Q', choice: '', markups: [{ ...MARKUP, marked }] }]
      })
      expect(() => assertQaReport(bad)).toThrow(/decisions\[0\]\.markups\[0\]\.marked/)
    }
  )

  test.each(['/tmp/evil.png', '../outside.png', 'x.images/../../evil.png', ''])(
    'an original picture that climbs out of the request folder is rejected: %s',
    (picture) => {
      const bad = report({
        decisions: [{ id: 'd', question: 'Q', choice: '', markups: [{ ...MARKUP, picture }] }]
      })
      expect(() => assertQaReport(bad)).toThrow(/decisions\[0\]\.markups\[0\]\.picture/)
    }
  )

  test('notes must be picture or list when present', () => {
    const ok = report({ markups: [{ ...MARKUP, notes: 'picture' }] })
    expect(() => assertQaReport(ok)).not.toThrow()
    const bad = report({ markups: [{ ...MARKUP, notes: 'both' as never }] })
    expect(() => assertQaReport(bad)).toThrow(/markups\[0\]\.notes/)
  })

  test('a malformed markups field on an observation is rejected', () => {
    const bad = {
      ...report(),
      observations: [{ id: 'obs-1', text: '', screenshots: [], markups: 'nope' }]
    }
    expect(() => assertQaReport(bad)).toThrow(/observations\[0\]\.markups must be an array/)
  })
})
