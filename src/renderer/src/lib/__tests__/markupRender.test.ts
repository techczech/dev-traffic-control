import { describe, expect, test } from 'vitest'
import { drawMarks } from '../markupRender'
import type { Mark } from '../../../../main/qa/types'

// A recording stand-in for a canvas 2D context: the test reads which words and
// numbers were drawn, not pixels.
function recorder(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = []
  const noop = (): void => {}
  const ctx = new Proxy(
    {
      fillText: (t: string) => texts.push(t),
      measureText: (t: string) => ({ width: t.length * 7 })
    },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : noop),
      set: () => true
    }
  ) as unknown as CanvasRenderingContext2D
  return { ctx, texts }
}

const MARKS: Mark[] = [
  { n: 1, shape: 'arrow', from: { x: 0.6, y: 0.7 }, to: { x: 0.3, y: 0.3 }, text: 'points here' },
  { n: 2, shape: 'box', box: { x: 0.1, y: 0.4, w: 0.2, h: 0.2 }, text: '' },
  { n: 3, shape: 'text', at: { x: 0.5, y: 0.1 }, text: 'just words' }
]

describe('the saved picture', () => {
  test('On picture draws each label and no numbers at all, and nothing for an empty label', () => {
    const { ctx, texts } = recorder()
    drawMarks(ctx, MARKS, 1100, 700, true)
    expect(texts).toEqual(['points here', 'just words'])
  })

  test('List draws the number pins and no words', () => {
    const { ctx, texts } = recorder()
    drawMarks(ctx, MARKS, 1100, 700, false)
    expect(texts).toEqual(['1', '2', '3'])
  })
})
