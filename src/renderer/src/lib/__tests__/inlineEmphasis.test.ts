import { expect, test } from 'vitest'
import { inlinePlain, inlineSegments } from '../inlineEmphasis'

test('bold, italic and code marks become segments; the text between stays plain', () => {
  expect(
    inlineSegments('Opens in a **new window**; *All projects* is a place; run `open`.')
  ).toEqual([
    { kind: 'text', text: 'Opens in a ' },
    { kind: 'strong', text: 'new window' },
    { kind: 'text', text: '; ' },
    { kind: 'em', text: 'All projects' },
    { kind: 'text', text: ' is a place; run ' },
    { kind: 'code', text: 'open' },
    { kind: 'text', text: '.' }
  ])
})

test('unmatched marks and markup stay as text, never interpreted', () => {
  expect(inlineSegments('2 * 3 and <b>not html</b>')).toEqual([
    { kind: 'text', text: '2 * 3 and <b>not html</b>' }
  ])
  expect(inlinePlain('a **b** c')).toBe('a b c')
})
