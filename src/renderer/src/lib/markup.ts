import type {
  Mark,
  MarkBox,
  MarkPoint,
  PictureMarkup,
  QaReport,
  ReportItem
} from '../../../main/qa/types'
import { isInsideRequestPath } from '../../../shared/insideRequestPath'

/**
 * Mark-up (ticket 30): the pure model behind the window-sized mark-up view.
 * Marks are boxes, arrows and free text labels on a picture, each with a
 * number pin in drawing order. Every coordinate is a fraction of the original
 * picture (0–1 from its top-left), so the view, the saved PNG and the report
 * all read the same numbers at any display size.
 *
 * The view owns pointers and pixels; everything that decides what a gesture
 * does to the marks, and how undo steps back, lives here.
 */

export type MarkTool = Mark['shape']
export type BoxHandle = 'nw' | 'ne' | 'sw' | 'se'
export type ArrowHandle = 'from' | 'to'
export type MarkHandle = BoxHandle | ArrowHandle

/** A box narrower or an arrow shorter than this (fraction of the picture) is a click, not a shape. */
export const MIN_SHAPE = 0.01

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const clampPoint = (p: MarkPoint): MarkPoint => ({ x: clamp01(p.x), y: clamp01(p.y) })

function boxFrom(a: MarkPoint, b: MarkPoint): MarkBox {
  const p = clampPoint(a)
  const q = clampPoint(b)
  return {
    x: Math.min(p.x, q.x),
    y: Math.min(p.y, q.y),
    w: Math.abs(p.x - q.x),
    h: Math.abs(p.y - q.y)
  }
}

/**
 * The shape a finished drag makes, or `null` when the drag was too small to be
 * one. An arrow's head is where he pressed (`to`) and its tail where he let go
 * (`from`). A text mark sits where he pressed; the release does not matter.
 */
export function shapeFromDrag(
  tool: MarkTool,
  press: MarkPoint,
  release: MarkPoint,
  n: number
): Mark | null {
  if (tool === 'text') return { n, shape: 'text', at: clampPoint(press), text: '' }
  if (tool === 'arrow') {
    const to = clampPoint(press)
    const from = clampPoint(release)
    if (Math.hypot(from.x - to.x, from.y - to.y) < MIN_SHAPE) return null
    return { n, shape: 'arrow', from, to, text: '' }
  }
  const box = boxFrom(press, release)
  if (box.w < MIN_SHAPE || box.h < MIN_SHAPE) return null
  return { n, shape: 'box', box, text: '' }
}

/** Move a whole mark by a fraction offset, stopping at the picture's edges. */
export function moveMark(mark: Mark, dx: number, dy: number): Mark {
  if (mark.shape === 'box') {
    const { box } = mark
    return {
      ...mark,
      box: {
        ...box,
        x: Math.min(1 - box.w, Math.max(0, box.x + dx)),
        y: Math.min(1 - box.h, Math.max(0, box.y + dy))
      }
    }
  }
  if (mark.shape === 'arrow') {
    const xs = [mark.from.x, mark.to.x]
    const ys = [mark.from.y, mark.to.y]
    const ddx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx))
    const ddy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy))
    return {
      ...mark,
      from: { x: mark.from.x + ddx, y: mark.from.y + ddy },
      to: { x: mark.to.x + ddx, y: mark.to.y + ddy }
    }
  }
  return { ...mark, at: clampPoint({ x: mark.at.x + dx, y: mark.at.y + dy }) }
}

/**
 * Drag one handle to a point. A box corner moves while the opposite corner
 * stays put (crossing over flips the box, never inverts it); an arrow end
 * moves on its own, so the head can be re-aimed or the tail lengthened.
 */
export function dragHandle(mark: Mark, handle: MarkHandle, to: MarkPoint): Mark {
  if (mark.shape === 'box') {
    const { x, y, w, h } = mark.box
    const opposite: Record<BoxHandle, MarkPoint> = {
      nw: { x: x + w, y: y + h },
      ne: { x, y: y + h },
      sw: { x: x + w, y },
      se: { x, y }
    }
    if (!(handle in opposite)) return mark
    return { ...mark, box: boxFrom(opposite[handle as BoxHandle], to) }
  }
  if (mark.shape === 'arrow' && (handle === 'from' || handle === 'to')) {
    return { ...mark, [handle]: clampPoint(to) }
  }
  return mark
}

/** Number the pins 1, 2, 3… in drawing order (the array's order). */
export function renumber(marks: Mark[]): Mark[] {
  return marks.map((m, i) => (m.n === i + 1 ? m : { ...m, n: i + 1 }))
}

/**
 * A mark's number once empty text marks are pruned and the rest renumbered, or
 * `null` when that mark is itself pruned (or absent).
 */
export function numberAfterPrune(marks: Mark[], n: number): number | null {
  const at = marks.findIndex((m) => m.n === n)
  if (at < 0) return null
  const kept = (m: Mark): boolean => m.shape !== 'text' || m.text.trim() !== ''
  return kept(marks[at]) ? 1 + marks.slice(0, at).filter(kept).length : null
}

/** Text marks are only their words; one with none has nothing to show. */
export function pruneEmptyText(marks: Mark[]): Mark[] {
  return renumber(marks.filter((m) => m.shape !== 'text' || m.text.trim() !== ''))
}

// ---------------------------------------------------------------------------
// The editing state, with undo.

export interface MarkupState {
  marks: Mark[]
  selected: number | null // the selected mark's pin number
  past: Mark[][] // undo stack, most recent last
  gestureBase: Mark[] | null // marks when the current drag or label edit began
}

export type MarkupAction =
  | { type: 'draw'; tool: MarkTool; press: MarkPoint; release: MarkPoint }
  | { type: 'select'; n: number | null }
  | { type: 'begin' } // a drag or a label edit starts: one undo step for all of it
  | { type: 'move'; n: number; dx: number; dy: number } // offset from the gesture's start
  | { type: 'handle'; n: number; handle: MarkHandle; to: MarkPoint }
  | { type: 'text'; n: number; text: string }
  | { type: 'end' }
  | { type: 'delete'; n?: number }
  | { type: 'prune' } // drop text marks left with no words (they would show nothing)
  | { type: 'sweep' } // prune empty text marks with no undo step (they cannot be seen or clicked)
  | { type: 'undo'; hideEmpty?: boolean } // hideEmpty: skip steps that only change what cannot be seen

export function initialMarkup(marks: Mark[] = []): MarkupState {
  return { marks: renumber(marks), selected: null, past: [], gestureBase: null }
}

function sameMarks(a: Mark[], b: Mark[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

function commit(state: MarkupState, marks: Mark[], selected: number | null): MarkupState {
  if (sameMarks(state.marks, marks)) return { ...state, selected }
  return { ...state, marks, selected, past: [...state.past, state.marks] }
}

function replaceMark(marks: Mark[], n: number, fn: (m: Mark) => Mark): Mark[] {
  return marks.map((m) => (m.n === n ? fn(m) : m))
}

export function markupReducer(state: MarkupState, action: MarkupAction): MarkupState {
  switch (action.type) {
    case 'draw': {
      const n = state.marks.length + 1
      const mark = shapeFromDrag(action.tool, action.press, action.release, n)
      if (!mark) return state
      return commit(state, [...state.marks, mark], n)
    }
    case 'select':
      return state.marks.some((m) => m.n === action.n) || action.n === null
        ? { ...state, selected: action.n }
        : state
    case 'begin':
      return { ...state, gestureBase: state.marks }
    case 'move': {
      const base = state.gestureBase ?? state.marks
      const original = base.find((m) => m.n === action.n)
      if (!original) return state
      const moved = moveMark(original, action.dx, action.dy)
      return { ...state, marks: replaceMark(base, action.n, () => moved) }
    }
    case 'handle': {
      const base = state.gestureBase ?? state.marks
      const original = base.find((m) => m.n === action.n)
      if (!original) return state
      const dragged = dragHandle(original, action.handle, action.to)
      return { ...state, marks: replaceMark(base, action.n, () => dragged) }
    }
    case 'text': {
      const marks = replaceMark(state.marks, action.n, (m) => ({ ...m, text: action.text }))
      // Inside a label edit the whole edit is one undo step; outside, each change is.
      return state.gestureBase ? { ...state, marks } : commit(state, marks, state.selected)
    }
    case 'end': {
      const base = state.gestureBase
      if (!base) return state
      const ended = { ...state, gestureBase: null }
      return sameMarks(base, state.marks) ? ended : { ...ended, past: [...state.past, base] }
    }
    case 'delete': {
      const n = action.n ?? state.selected
      if (n === null || !state.marks.some((m) => m.n === n)) return state
      return commit(state, renumber(state.marks.filter((m) => m.n !== n)), null)
    }
    case 'prune': {
      if (state.gestureBase) return state
      const kept = pruneEmptyText(state.marks)
      if (kept.length === state.marks.length) return state
      const selected =
        state.selected === null ? null : numberAfterPrune(state.marks, state.selected)
      // A text mark abandoned empty straight after placing it leaves no trace to undo.
      const last = state.past[state.past.length - 1]
      if (last && sameMarks(last, kept)) {
        return { ...state, marks: kept, selected, past: state.past.slice(0, -1) }
      }
      return commit(state, kept, selected)
    }
    case 'sweep': {
      if (state.gestureBase) return state
      const kept = pruneEmptyText(state.marks)
      if (kept.length === state.marks.length) return state
      const selected =
        state.selected === null ? null : numberAfterPrune(state.marks, state.selected)
      return { ...state, marks: kept, selected }
    }
    case 'undo': {
      if (state.gestureBase || state.past.length === 0) return state
      const seen = action.hideEmpty ? pruneEmptyText(state.marks) : state.marks
      let past = state.past
      let marks: Mark[]
      // With hideEmpty a step that changes nothing on the picture is not a step.
      do {
        marks = past[past.length - 1]
        past = past.slice(0, -1)
        if (action.hideEmpty) marks = pruneEmptyText(marks)
      } while (action.hideEmpty && past.length > 0 && sameMarks(marks, seen))
      const selected = marks.some((m) => m.n === state.selected) ? state.selected : null
      return { marks, selected, past, gestureBase: null }
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry shared by the view and the saved PNG.

/** Where the number pin sits (List mode only): a box's top-left corner, an arrow's tail, a text mark's point. */
export function pinPoint(mark: Mark): MarkPoint {
  if (mark.shape === 'box') return { x: mark.box.x, y: mark.box.y }
  if (mark.shape === 'arrow') return mark.from
  return mark.at
}

/**
 * Where a mark's label goes on the picture (On picture mode has no number
 * pins, so the label is what joins the mark). `at` is the point of the label
 * box that touches the mark. A box's label sits against its top edge (its
 * bottom edge when the box is near the top of the picture); an arrow's label
 * is centred on the tail, with the line running from the label's edge to the
 * head; a text mark is its label, its corner at the mark's point. Near the
 * right edge a box's or text mark's label hangs to the left instead.
 */
export interface LabelAnchor {
  at: MarkPoint
  alignX: 'start' | 'end' | 'center' // start: the label extends right of `at`
  alignY: 'start' | 'end' | 'center' // start: the label extends below `at`
}

export function labelAnchor(mark: Mark): LabelAnchor {
  if (mark.shape === 'box') {
    const { x, y, w, h } = mark.box
    const right = x > 0.5
    const lx = right ? x + w : x
    return y > 0.1
      ? { at: { x: lx, y }, alignX: right ? 'end' : 'start', alignY: 'end' }
      : { at: { x: lx, y: y + h }, alignX: right ? 'end' : 'start', alignY: 'start' }
  }
  if (mark.shape === 'arrow') return { at: mark.from, alignX: 'center', alignY: 'center' }
  const p = mark.at
  return { at: p, alignX: p.x > 0.5 ? 'end' : 'start', alignY: p.y > 0.85 ? 'end' : 'start' }
}

/** The label box's top-left corner for a box of `w`×`h`, at any unit the caller draws in. */
export function labelOrigin(anchor: LabelAnchor, w: number, h: number): MarkPoint {
  const at = anchor.at
  const along = (align: LabelAnchor['alignX'], size: number, v: number): number =>
    align === 'start' ? v : align === 'end' ? v - size : v - size / 2
  return { x: along(anchor.alignX, w, at.x), y: along(anchor.alignY, h, at.y) }
}

/** The two back corners of an arrowhead whose point is `to`, in the caller's units. */
export function arrowHeadCorners(
  from: MarkPoint,
  to: MarkPoint,
  size: number
): [MarkPoint, MarkPoint] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const spread = Math.PI / 7
  return [
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) }
  ]
}

/** The name the notes list and the report show for a shape. */
export function shapeName(shape: Mark['shape']): string {
  return shape === 'box' ? 'Box' : shape === 'arrow' ? 'Arrow' : 'Text'
}

/** Marks as saved: four decimals are ample for a fraction of a picture. */
export function savedMarks(marks: Mark[]): Mark[] {
  const r = (v: number): number => Math.round(v * 10000) / 10000
  const pt = (p: MarkPoint): MarkPoint => ({ x: r(p.x), y: r(p.y) })
  return renumber(marks).map((m) => {
    if (m.shape === 'box') {
      const { x, y, w, h } = m.box
      return { n: m.n, shape: 'box', box: { x: r(x), y: r(y), w: r(w), h: r(h) }, text: m.text }
    }
    if (m.shape === 'arrow') {
      return { n: m.n, shape: 'arrow', from: pt(m.from), to: pt(m.to), text: m.text }
    }
    return { n: m.n, shape: 'text', at: pt(m.at), text: m.text }
  })
}

/** A picture's path as the markup records it: the document's src, URL-decoded. */
export function pictureKey(src: string): string {
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

/** Only a picture on disk beside the request can be marked up (not a web or inline picture). */
export function isMarkablePicture(src: string): boolean {
  return !!src && !/^(https?:|data:|file:)/i.test(src) && isInsideRequestPath(src)
}

// ---------------------------------------------------------------------------
// Where a markup lives in the report. The original picture is never touched;
// only these records change.

/** Put `markup` in the list in place of the one for the same picture; `null` removes it. */
export function upsertMarkup(
  list: PictureMarkup[] | undefined,
  picture: string,
  markup: PictureMarkup | null
): PictureMarkup[] | undefined {
  const current = list ?? []
  if (!markup) {
    const rest = current.filter((m) => m.picture !== picture)
    return rest.length > 0 ? rest : undefined
  }
  // An edit keeps its place, so the notes do not jump around.
  return current.some((m) => m.picture === picture)
    ? current.map((m) => (m.picture === picture ? markup : m))
    : [...current, markup]
}

function withMarkups<T extends { markups?: PictureMarkup[] }>(
  holder: T,
  markups: PictureMarkup[] | undefined
): T {
  const next = { ...holder }
  if (markups) next.markups = markups
  else delete next.markups
  return next
}

/**
 * Attach (or with `null`, remove) a marked-up picture on a decision's answer.
 * An answer that does not exist yet is created undecided, so marking a picture
 * before picking is kept.
 */
export function setDecisionMarkup(
  r: QaReport,
  itemId: string,
  decision: { id: string; question: string },
  picture: string,
  markup: PictureMarkup | null
): QaReport {
  return {
    ...r,
    items: r.items.map((it) => {
      if (it.id !== itemId) return it
      const decisions = it.decisions ?? []
      const existing = decisions.find((d) => d.id === decision.id)
      if (!existing && !markup) return it
      const base = existing ?? { id: decision.id, question: decision.question, choice: '' }
      const updated = withMarkups(base, upsertMarkup(base.markups, picture, markup))
      return {
        ...it,
        decisions: existing
          ? decisions.map((d) => (d.id === decision.id ? updated : d))
          : [...decisions, updated]
      }
    })
  }
}

/** Where a pasted screenshot sits: a check (report item) or a light-run observation. */
export type ShotHolder = { kind: 'item'; id: string } | { kind: 'observation'; id: string }

/** Attach (or with `null`, remove) a marked-up copy of one of the holder's screenshots. */
export function setShotMarkup(
  r: QaReport,
  holder: ShotHolder,
  picture: string,
  markup: PictureMarkup | null
): QaReport {
  if (holder.kind === 'item') {
    return {
      ...r,
      items: r.items.map((it: ReportItem) =>
        it.id === holder.id ? withMarkups(it, upsertMarkup(it.markups, picture, markup)) : it
      )
    }
  }
  if (!r.observations) return r
  return {
    ...r,
    observations: r.observations.map((o) =>
      o.id === holder.id ? withMarkups(o, upsertMarkup(o.markups, picture, markup)) : o
    )
  }
}

/** Markups for the screenshots still in the list (a removed screenshot's marks go with it). */
export function markupsFor(
  holder: { screenshots: string[]; markups?: PictureMarkup[] } | undefined
): PictureMarkup[] {
  if (!holder?.markups) return []
  return holder.markups.filter((m) => holder.screenshots.includes(m.picture))
}
