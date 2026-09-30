import { expect, test } from 'vitest'
import { parseDocBlocks } from '../richtext'
import { decidedCount, humaniseDecisionId, listDecisions, pickChip } from '../decisions'

const HEADINGS = [
  { id: 'corpus-home-and-cleaning', title: 'Corpus home and cleaning' },
  { id: 'concordance-kwic', title: 'Concordance (KWIC)' }
]
const MD = [
  '## Corpus home and cleaning',
  '```decision {#corpus-home}',
  'Corpus home: which direction?',
  '- AS-3A: card ![](a.png)',
  '- AS-3B: table ![](b.png)',
  '- Neither: redraw',
  '```',
  '## Concordance (KWIC)',
  '```decision {#kwic}',
  'KWIC: which?',
  '- AS-3C',
  '- AS-3D',
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
    [1, 3, 'corpus-home-and-cleaning', 'Corpus home'],
    [2, 3, 'concordance-kwic', 'KWIC'],
    [3, 3, 'concordance-kwic', 'Should it ask first every time?']
  ])
  expect(list[0].pictured).toEqual([0, 1])
  expect(list[0].sectionTitle).toBe('Corpus home and cleaning')
  expect(list[1].pictured).toEqual([])
})

test('humanised ids keep capitals the question or section writes', () => {
  expect(humaniseDecisionId('highlights-dating', ['x'])).toBe('Highlights dating')
  expect(humaniseDecisionId('kwic', ['Concordance (KWIC)'])).toBe('KWIC')
})

test('the rail chip is the pick short label; the count is decisions with a pick', () => {
  expect(pickChip('AS-3A: one card')).toBe('AS-3A')
  expect(pickChip('Neither: redraw')).toBe('Neither')
  expect(pickChip('')).toBe('')
  const list = listDecisions(parseDocBlocks(MD), HEADINGS)
  const answers = new Map([
    ['corpus-home', { choice: 'AS-3A: card' }],
    ['kwic', { choice: '' }]
  ])
  expect(decidedCount(list, answers)).toBe(1)
})
