import { expect, test } from 'vitest'
import { parseDocBlocks } from '../richtext'
import { decidedCount, humaniseDecisionId, listDecisions, pickChip } from '../decisions'

const HEADINGS = [
  { id: 'library-home-and-sorting', title: 'Library home and sorting' },
  { id: 'quick-search-qs', title: 'Quick search (QS)' }
]
const MD = [
  '## Library home and sorting',
  '```decision {#library-home}',
  'Library home: which direction?',
  '- OPT-A: card ![](a.png)',
  '- OPT-B: table ![](b.png)',
  '- Neither: redraw',
  '```',
  '## Quick search (QS)',
  '```decision {#qs}',
  'QS: which?',
  '- OPT-C',
  '- OPT-D',
  '```',
  '```decision',
  'Should it ask first every time?',
  '- Yes',
  '- No',
  '```'
].join('\n')

test('decisions list in order with section, number, humanised name and picture options', () => {
  const list = listDecisions(parseDocBlocks(MD), HEADINGS)
  expect(list.map((d) => [d.number, d.total, d.section, d.name])).toEqual([
    [1, 3, 'library-home-and-sorting', 'Library home'],
    [2, 3, 'quick-search-qs', 'QS'],
    [3, 3, 'quick-search-qs', 'Should it ask first every time?']
  ])
  expect(list[0].pictured).toEqual([0, 1])
  expect(list[0].sectionTitle).toBe('Library home and sorting')
  expect(list[1].pictured).toEqual([])
})

test('humanised ids keep capitals the question or section writes', () => {
  expect(humaniseDecisionId('notes-sorting', ['x'])).toBe('Notes sorting')
  expect(humaniseDecisionId('qs', ['Quick search (QS)'])).toBe('QS')
})

test('the rail chip is the pick short label; the count is decisions with a pick', () => {
  expect(pickChip('OPT-A: one card')).toBe('OPT-A')
  expect(pickChip('Neither: redraw')).toBe('Neither')
  expect(pickChip('')).toBe('')
  const list = listDecisions(parseDocBlocks(MD), HEADINGS)
  const answers = new Map([
    ['library-home', { choice: 'OPT-A: card' }],
    ['qs', { choice: '' }]
  ])
  expect(decidedCount(list, answers)).toBe(1)
})
