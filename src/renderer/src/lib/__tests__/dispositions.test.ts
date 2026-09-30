import { expect, test } from 'vitest'
import { DISPOSITIONS } from '../dispositions'

// The chip flyout and the Finish sheet both render from this list, so its
// order and labels are the app's only Disposition vocabulary (ADR-0007 §2).
test('one list, one order: the four wire verdicts with prose labels and letter keys', () => {
  expect(DISPOSITIONS.map((d) => [d.v, d.label, d.key])).toEqual([
    ['pass', 'Approve', 'P'],
    ['partial', 'Approve with changes', 'N'],
    ['fail', 'Needs rework', 'F'],
    ['skip', 'Not reviewed', 'S']
  ])
})
