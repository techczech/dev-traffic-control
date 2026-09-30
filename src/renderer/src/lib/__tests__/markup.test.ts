import { describe, expect, test } from 'vitest'
import {
  initialMarkup,
  isMarkablePicture,
  labelAnchor,
  labelOrigin,
  markupReducer,
  markupsFor,
  moveMark,
  numberAfterPrune,
  pruneEmptyText,
  savedMarks,
  setDecisionMarkup,
  setShotMarkup,
  shapeFromDrag
} from '../markup'
import type { MarkupAction, MarkupState } from '../markup'
import { removeScreenshot } from '../runnerState'
import type { Mark, PictureMarkup, QaReport } from '../../../../main/qa/types'

function run(actions: MarkupAction[], state: MarkupState = initialMarkup()): MarkupState {
  return actions.reduce(markupReducer, state)
}

const box = (x: number, y: number, x2: number, y2: number): MarkupAction => ({
  type: 'draw',
  tool: 'box',
  press: { x, y },
  release: { x: x2, y: y2 }
})

describe('drawing', () => {
  test('an arrow has its head where he pressed and its tail where he let go', () => {
    const s = run([
      { type: 'draw', tool: 'arrow', press: { x: 0.33, y: 0.61 }, release: { x: 0.6, y: 0.8 } }
    ])
    expect(s.marks).toEqual([
      { n: 1, shape: 'arrow', to: { x: 0.33, y: 0.61 }, from: { x: 0.6, y: 0.8 }, text: '' }
    ])
    expect(s.selected).toBe(1)
  })

  test('a box dragged up and left is stored from its top-left corner, as fractions', () => {
    const s = run([box(0.7, 0.4, 0.2, 0.1)])
    const mark = s.marks[0] as Extract<Mark, { shape: 'box' }>
    expect(mark.box.x).toBeCloseTo(0.2)
    expect(mark.box.y).toBeCloseTo(0.1)
    expect(mark.box.w).toBeCloseTo(0.5)
    expect(mark.box.h).toBeCloseTo(0.3)
  })

  test('points outside the picture are held at its edge', () => {
    const s = run([box(-0.2, 0.5, 1.4, 0.9)])
    expect(s.marks[0]).toMatchObject({ box: { x: 0, w: 1 } })
  })

  test('a click with the box or arrow tool draws nothing; the text tool places a label', () => {
    expect(shapeFromDrag('box', { x: 0.5, y: 0.5 }, { x: 0.502, y: 0.6 }, 1)).toBeNull()
    expect(shapeFromDrag('arrow', { x: 0.5, y: 0.5 }, { x: 0.501, y: 0.501 }, 1)).toBeNull()
    expect(shapeFromDrag('text', { x: 0.4, y: 0.7 }, { x: 0.4, y: 0.7 }, 4)).toEqual({
      n: 4,
      shape: 'text',
      at: { x: 0.4, y: 0.7 },
      text: ''
    })
  })

  test('pins are numbered in drawing order', () => {
    const s = run([
      box(0.1, 0.1, 0.3, 0.3),
      { type: 'draw', tool: 'arrow', press: { x: 0.5, y: 0.5 }, release: { x: 0.8, y: 0.8 } },
      { type: 'draw', tool: 'text', press: { x: 0.2, y: 0.9 }, release: { x: 0.2, y: 0.9 } }
    ])
    expect(s.marks.map((m) => [m.n, m.shape])).toEqual([
      [1, 'box'],
      [2, 'arrow'],
      [3, 'text']
    ])
  })
})

describe('editing', () => {
  const drawn = run([
    box(0.1, 0.1, 0.3, 0.3),
    { type: 'draw', tool: 'arrow', press: { x: 0.5, y: 0.5 }, release: { x: 0.8, y: 0.8 } }
  ])

  test('dragging the middle moves the shape, measured from where the drag began', () => {
    const s = run(
      [
        { type: 'begin' },
        { type: 'move', n: 1, dx: 0.05, dy: 0 },
        { type: 'move', n: 1, dx: 0.1, dy: 0.2 },
        { type: 'end' }
      ],
      drawn
    )
    const moved = (s.marks[0] as Extract<Mark, { shape: 'box' }>).box
    expect(moved.w).toBeCloseTo(0.2)
    expect(moved.h).toBeCloseTo(0.2)
    expect(moved.x).toBeCloseTo(0.2)
    expect(moved.y).toBeCloseTo(0.3)
  })

  test('a move stops at the picture edge without changing the shape', () => {
    const s = run(
      [{ type: 'begin' }, { type: 'move', n: 2, dx: 0.5, dy: 0 }, { type: 'end' }],
      drawn
    )
    expect(s.marks[1]).toMatchObject({ from: { x: 1, y: 0.8 }, to: { x: 0.7, y: 0.5 } })
  })

  test('a box corner handle resizes against the opposite corner', () => {
    const s = run(
      [
        { type: 'begin' },
        { type: 'handle', n: 1, handle: 'se', to: { x: 0.6, y: 0.5 } },
        { type: 'end' }
      ],
      drawn
    )
    expect(s.marks[0]).toMatchObject({ box: { x: 0.1, y: 0.1 } })
    const b = (s.marks[0] as Extract<Mark, { shape: 'box' }>).box
    expect(b.w).toBeCloseTo(0.5)
    expect(b.h).toBeCloseTo(0.4)
  })

  test('each arrow end has its own handle; the other end stays', () => {
    const s = run(
      [
        { type: 'begin' },
        { type: 'handle', n: 2, handle: 'to', to: { x: 0.2, y: 0.9 } },
        { type: 'end' }
      ],
      drawn
    )
    expect(s.marks[1]).toMatchObject({ to: { x: 0.2, y: 0.9 }, from: { x: 0.8, y: 0.8 } })
  })

  test('the label stays with its mark through moves and resizes', () => {
    const s = run(
      [
        { type: 'text', n: 1, text: 'Say it is a state' },
        { type: 'begin' },
        { type: 'handle', n: 1, handle: 'nw', to: { x: 0, y: 0 } },
        { type: 'end' }
      ],
      drawn
    )
    expect(s.marks[0].text).toBe('Say it is a state')
  })

  test('deleting a mark renumbers the rest in drawing order', () => {
    const s = run([{ type: 'delete', n: 1 }], drawn)
    expect(s.marks).toHaveLength(1)
    expect(s.marks[0]).toMatchObject({ n: 1, shape: 'arrow' })
    expect(run([{ type: 'select', n: 2 }, { type: 'delete' }], drawn).marks).toHaveLength(1)
  })
})

describe('undo', () => {
  test('steps back one drawing, move, edit or deletion at a time', () => {
    let s = run([box(0.1, 0.1, 0.3, 0.3), box(0.5, 0.5, 0.7, 0.7)])
    s = run(
      [
        { type: 'begin' },
        { type: 'move', n: 2, dx: 0.1, dy: 0 },
        { type: 'move', n: 2, dx: 0.2, dy: 0 },
        { type: 'end' }
      ],
      s
    )
    s = run([{ type: 'delete', n: 1 }], s)
    expect(s.marks).toHaveLength(1)
    s = markupReducer(s, { type: 'undo' })
    expect(s.marks).toHaveLength(2)
    expect((s.marks[1] as Extract<Mark, { shape: 'box' }>).box.x).toBeCloseTo(0.7)
    s = markupReducer(s, { type: 'undo' })
    expect((s.marks[1] as Extract<Mark, { shape: 'box' }>).box.x).toBeCloseTo(0.5)
    s = run([{ type: 'undo' }, { type: 'undo' }, { type: 'undo' }], s)
    expect(s.marks).toEqual([])
  })

  test('a whole label edit is one undo step', () => {
    let s = run([box(0.1, 0.1, 0.3, 0.3)])
    s = run(
      [
        { type: 'begin' },
        { type: 'text', n: 1, text: 'K' },
        { type: 'text', n: 1, text: 'Keep' },
        { type: 'end' }
      ],
      s
    )
    expect(markupReducer(s, { type: 'undo' }).marks[0].text).toBe('')
  })

  test('a drag that changed nothing adds no undo step', () => {
    const s = run([box(0.1, 0.1, 0.3, 0.3), { type: 'begin' }, { type: 'end' }])
    expect(s.past).toHaveLength(1)
  })

  test('reopening saved marks starts with nothing to undo', () => {
    const s = initialMarkup([{ n: 1, shape: 'text', at: { x: 0.4, y: 0.7 }, text: 'x' }])
    expect(markupReducer(s, { type: 'undo' })).toBe(s)
  })
})

describe('saved marks and labels', () => {
  test('saved marks are rounded fractions in the report shape', () => {
    const s = run([
      { type: 'draw', tool: 'arrow', press: { x: 1 / 3, y: 0.61 }, release: { x: 0.6, y: 0.8 } }
    ])
    expect(savedMarks(s.marks)).toEqual([
      { n: 1, shape: 'arrow', from: { x: 0.6, y: 0.8 }, to: { x: 0.3333, y: 0.61 }, text: '' }
    ])
  })

  test('a box label sits above the box, or below it when the box is at the top', () => {
    const low = shapeFromDrag('box', { x: 0.2, y: 0.4 }, { x: 0.4, y: 0.6 }, 1) as Mark
    const top = shapeFromDrag('box', { x: 0.2, y: 0.02 }, { x: 0.4, y: 0.2 }, 1) as Mark
    expect(labelAnchor(low)).toMatchObject({ at: { x: 0.2, y: 0.4 }, alignY: 'end' })
    expect(labelAnchor(top)).toMatchObject({ alignY: 'start' })
    expect(labelAnchor(top).at.y).toBeCloseTo(0.2)
  })
})

describe('text marks are marks like the others', () => {
  const text = (): MarkupState =>
    run([
      { type: 'draw', tool: 'text', press: { x: 0.3, y: 0.4 }, release: { x: 0.3, y: 0.4 } },
      { type: 'text', n: 1, text: 'note' }
    ])

  test('a text mark can be selected, moved by dragging and deleted', () => {
    let s = run([{ type: 'select', n: null }], text())
    s = run(
      [
        { type: 'select', n: 1 },
        { type: 'begin' },
        { type: 'move', n: 1, dx: 0.1, dy: -0.2 },
        { type: 'end' }
      ],
      s
    )
    expect(s.selected).toBe(1)
    expect(s.marks[0]).toMatchObject({ shape: 'text', at: { x: 0.4 } })
    expect((s.marks[0] as { at: { y: number } }).at.y).toBeCloseTo(0.2)
    s = run([{ type: 'delete' }], s)
    expect(s.marks).toEqual([])
    expect(run([{ type: 'undo' }], s).marks).toHaveLength(1)
  })

  test('a moved text mark stops at the picture edge', () => {
    const m = moveMark({ n: 1, shape: 'text', at: { x: 0.9, y: 0.1 }, text: 'x' }, 0.5, -0.5)
    expect(m).toMatchObject({ at: { x: 1, y: 0 } })
  })

  test('undo steps back a shape drawn while its label is still being typed', () => {
    // Drawing opens the label at once; command-Z from there must still undo.
    let s = run([box(0.2, 0.2, 0.4, 0.4), { type: 'begin' }])
    s = run([{ type: 'end' }, { type: 'undo' }], s)
    expect(s.marks).toEqual([])
  })

  test('an abandoned empty text mark is dropped and leaves nothing to undo', () => {
    const drawn = run([
      { type: 'draw', tool: 'text', press: { x: 0.3, y: 0.4 }, release: { x: 0.3, y: 0.4 } },
      { type: 'prune' }
    ])
    expect(drawn.marks).toEqual([])
    expect(drawn.past).toEqual([])
    expect(pruneEmptyText(text().marks)).toHaveLength(1)
  })

  test('labels touch their mark: arrow label centred on the tail, text label at its point', () => {
    const arrow = shapeFromDrag('arrow', { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }, 1) as Mark
    const a = labelAnchor(arrow)
    expect(a).toMatchObject({ at: { x: 0.6, y: 0.6 }, alignX: 'center', alignY: 'center' })
    expect(labelOrigin(a, 100, 40)).toEqual({ x: 0.6 - 50, y: 0.6 - 20 })
    const t = labelAnchor({ n: 1, shape: 'text', at: { x: 0.3, y: 0.4 }, text: 'x' })
    expect(labelOrigin(t, 100, 40)).toEqual({ x: 0.3, y: 0.4 })
  })
})

describe('where the marks land in the report', () => {
  const MARKUP: PictureMarkup = {
    picture: 'r.images/a.png',
    marked: 'r.shots/document-1.png',
    marks: [{ n: 1, shape: 'text', at: { x: 0.1, y: 0.1 }, text: 'x' }],
    option: 'A'
  }
  const report = (): QaReport => ({
    id: 'r',
    title: 'R',
    startedAt: 'now',
    noteFiles: [],
    items: [
      {
        id: 'document',
        title: 'R',
        status: 'unanswered',
        comment: '',
        flagged: [],
        quotes: [],
        screenshots: ['r.shots/document-1.png']
      }
    ]
  })

  test('on a decision: attaches to its answer, creating an undecided one; an edit replaces it', () => {
    let r = setDecisionMarkup(
      report(),
      'document',
      { id: 'd', question: 'Q?' },
      MARKUP.picture,
      MARKUP
    )
    expect(r.items[0].decisions).toEqual([
      { id: 'd', question: 'Q?', choice: '', markups: [MARKUP] }
    ])
    const edited = { ...MARKUP, marked: 'r.shots/document-2.png' }
    r = setDecisionMarkup(r, 'document', { id: 'd', question: 'Q?' }, MARKUP.picture, edited)
    expect(r.items[0].decisions?.[0].markups).toEqual([edited])
    r = setDecisionMarkup(r, 'document', { id: 'd', question: 'Q?' }, MARKUP.picture, null)
    expect(r.items[0].decisions?.[0]).toEqual({ id: 'd', question: 'Q?', choice: '' })
  })

  test('on a screenshot: attaches to the check, and goes when the screenshot is removed', () => {
    const shot = { ...MARKUP, picture: 'r.shots/document-1.png', marked: 'r.shots/document-2.png' }
    let r = setShotMarkup(report(), { kind: 'item', id: 'document' }, shot.picture, shot)
    expect(markupsFor(r.items[0])).toEqual([shot])
    r = removeScreenshot(r, 'document', shot.picture)
    expect(r.items[0]).not.toHaveProperty('markups')
  })

  test('on an observation screenshot', () => {
    const r: QaReport = {
      ...report(),
      observations: [{ id: 'obs-1', text: '', screenshots: ['r.shots/obs-1-1.png'] }]
    }
    const shot = { ...MARKUP, picture: 'r.shots/obs-1-1.png' }
    const next = setShotMarkup(r, { kind: 'observation', id: 'obs-1' }, shot.picture, shot)
    expect(next.observations?.[0].markups).toEqual([shot])
  })
})

describe('empty text marks never linger unseen', () => {
  const place = (x: number, y: number): MarkupAction => ({
    type: 'draw',
    tool: 'text',
    press: { x, y },
    release: { x, y }
  })
  const typeWords = (n: number, text: string): MarkupAction[] => [
    { type: 'begin' },
    { type: 'text', n, text },
    { type: 'end' }
  ]

  test('undo with a label open (the button and cmd-Z alike) takes back only the placed text mark', () => {
    // The label is open and empty: the view keeps the empty mark, so nothing is pruned first.
    let s = run([box(0.1, 0.1, 0.3, 0.3), place(0.6, 0.6), { type: 'begin' }])
    s = run([{ type: 'end' }, { type: 'undo' }], s)
    expect(s.marks).toHaveLength(1)
    expect(s.marks[0].shape).toBe('box')
    expect(markupReducer(s, { type: 'undo' }).marks).toEqual([])
  })

  test('undoing the words of a text mark on the picture leaves no invisible mark and one visible step next', () => {
    let s = run([box(0.1, 0.1, 0.3, 0.3), place(0.6, 0.6), ...typeWords(2, 'hello')])
    s = markupReducer(s, { type: 'undo', hideEmpty: true })
    expect(s.marks.map((m) => m.shape)).toEqual(['box'])
    expect(markupReducer(s, { type: 'undo', hideEmpty: true }).marks).toEqual([])
  })

  test('undo in the list still shows an empty text mark, which has a row there', () => {
    let s = run([box(0.1, 0.1, 0.3, 0.3), place(0.6, 0.6), ...typeWords(2, 'hello')])
    s = markupReducer(s, { type: 'undo' })
    expect(s.marks.map((m) => m.shape)).toEqual(['box', 'text'])
  })

  test('sweep drops empty text marks without an undo step, so the next undo is visible', () => {
    let s = run([box(0.1, 0.1, 0.3, 0.3), place(0.6, 0.6)])
    const before = s.past.length
    s = markupReducer(s, { type: 'sweep' })
    expect(s.marks.map((m) => m.shape)).toEqual(['box'])
    expect(s.past).toHaveLength(before)
    expect(markupReducer(s, { type: 'undo', hideEmpty: true }).marks).toEqual([])
  })

  test('sweep leaves a text mark with words, and waits out a label edit', () => {
    const s = run([place(0.6, 0.6), ...typeWords(1, 'hi')])
    expect(markupReducer(s, { type: 'sweep' })).toBe(s)
    const editing = run([box(0.1, 0.1, 0.3, 0.3), place(0.6, 0.6), { type: 'begin' }])
    expect(markupReducer(editing, { type: 'sweep' })).toBe(editing)
  })

  test('pruning renumbers, and the number a press meant follows the mark it was on', () => {
    const marks = run([place(0.5, 0.5), box(0.1, 0.1, 0.3, 0.3), box(0.6, 0.1, 0.8, 0.3)]).marks
    expect(numberAfterPrune(marks, 3)).toBe(2)
    expect(numberAfterPrune(marks, 2)).toBe(1)
    expect(numberAfterPrune(marks, 1)).toBeNull()
    expect(numberAfterPrune(marks, 9)).toBeNull()
  })

  test('a prune keeps the same mark selected after renumbering', () => {
    let s = run([place(0.5, 0.5), box(0.1, 0.1, 0.3, 0.3), box(0.6, 0.1, 0.8, 0.3)])
    s = run([{ type: 'select', n: 3 }, { type: 'prune' }], s)
    expect(s.marks).toHaveLength(2)
    expect(s.selected).toBe(2)
  })
})

describe('which pictures can be marked', () => {
  test('a path the report would refuse is not offered', () => {
    expect(isMarkablePicture('shots/a.png')).toBe(true)
    expect(isMarkablePicture('shots\\a.png')).toBe(false)
    expect(isMarkablePicture('../a.png')).toBe(false)
    expect(isMarkablePicture('/a.png')).toBe(false)
    expect(isMarkablePicture('https://x/a.png')).toBe(false)
  })
})
