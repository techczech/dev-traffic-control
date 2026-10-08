import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  ImageOff,
  List,
  PenLine,
  MessageSquareText,
  RectangleHorizontal,
  Type,
  Undo2
} from 'lucide-react'
import type { Mark, MarkPoint } from '../../../main/qa/types'
import { readNotesMode, writeNotesMode } from '../lib/markupSession'
import type { MarkupSession, NotesMode } from '../lib/markupSession'
import { useCommandChord, useCommandScope } from '../commands/provider'
import { displayChord } from '../commands/keymap'
import type { CommandId } from '../commands/registry'
import {
  arrowHeadCorners,
  initialMarkup,
  labelAnchor,
  markupReducer,
  numberAfterPrune,
  pinPoint,
  pruneEmptyText,
  savedMarks,
  shapeFromDrag,
  shapeName
} from '../lib/markup'
import type { MarkHandle, MarkTool } from '../lib/markup'
import { renderMarkedPng } from '../lib/markupRender'

type Drag =
  | { kind: 'draw'; press: MarkPoint }
  | {
      kind: 'move'
      n: number
      start: MarkPoint
      moved: boolean
      wasSelected: boolean // a click on an already selected mark types its label
    }
  | { kind: 'handle'; n: number; handle: MarkHandle }

const TOOL_COMMAND: Record<MarkTool, CommandId> = {
  arrow: 'markup.tool-arrow',
  box: 'markup.tool-box',
  text: 'markup.tool-text'
}

const TOOL_HINT: Record<MarkTool, string> = {
  arrow: 'Arrow: press on the point, drag to where the note goes',
  box: 'Rectangle: drag on the picture',
  text: 'Text: click where the note goes'
}

function ToolButton({
  tool,
  on,
  onPick
}: {
  tool: MarkTool
  on: boolean
  onPick: () => void
}): React.JSX.Element {
  const chord = displayChord(useCommandChord(TOOL_COMMAND[tool]))
  return (
    <button type="button" className={`mktool${on ? ' on' : ''}`} aria-pressed={on} onClick={onPick}>
      <ShapeIcon shape={tool} />
      {toolName(tool)}
      {chord && <kbd>{chord}</kbd>}
    </button>
  )
}

const toolName = (t: MarkTool): string => (t === 'box' ? 'Rectangle' : shapeName(t))

function ShapeIcon({ shape }: { shape: Mark['shape'] }): React.JSX.Element {
  if (shape === 'arrow') return <ArrowUpRight strokeWidth={2} aria-hidden="true" />
  if (shape === 'box') return <RectangleHorizontal strokeWidth={2} aria-hidden="true" />
  return <Type strokeWidth={2} aria-hidden="true" />
}

export function MarkupView({
  session,
  onClose
}: {
  session: MarkupSession
  onClose: () => void
}): React.JSX.Element {
  const [state, dispatch] = useReducer(markupReducer, session.marks, initialMarkup)
  const [tool, setTool] = useState<MarkTool>('box')
  const [mode, setMode] = useState<NotesMode>(readNotesMode)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ press: MarkPoint; release: MarkPoint } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const picRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)
  const stateRef = useRef(state)
  const editingRef = useRef(editing)
  const modeRef = useRef(mode)
  const keepEmptyRef = useRef(false)
  const rowRefs = useRef(new Map<number, HTMLTextAreaElement>())
  useLayoutEffect(() => {
    stateRef.current = state
    editingRef.current = editing
    modeRef.current = mode
  })

  useEffect(() => {
    let current = true
    window.qa.readShot(session.requestPath, session.picture).then(
      (url) => current && setSrc(url),
      () => current && setFailed(true)
    )
    return () => {
      current = false
    }
  }, [session.requestPath, session.picture])

  useEffect(() => {
    const img = imgRef.current
    if (!img || !src) return
    const measure = (): void => setSize({ w: img.clientWidth, h: img.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(img)
    measure()
    return () => ro.disconnect()
  }, [src])

  // In list mode a new mark's note is typed in its row.
  useEffect(() => {
    if (mode === 'list' && editing !== null) rowRefs.current.get(editing)?.focus()
  }, [mode, editing])

  const startEditing = (n: number): void => {
    if (editingRef.current === n) return
    if (editingRef.current !== null) dispatch({ type: 'end' })
    dispatch({ type: 'begin' })
    editingRef.current = n
    setEditing(n)
  }
  const finishEditing = (): void => {
    if (editingRef.current === null) return
    dispatch({ type: 'end' })
    // On the picture a text mark with no words would show nothing at all.
    if (!keepEmptyRef.current && modeRef.current === 'picture') dispatch({ type: 'prune' })
    editingRef.current = null
    setEditing(null)
  }
  const undo = (): void => {
    // While a label is open its empty text mark is what the reviewer sees, so undo takes
    // that back; otherwise a step that only changes an unseen mark is skipped.
    const hideEmpty = editingRef.current === null && modeRef.current === 'picture'
    if (editingRef.current !== null) {
      // Keep an empty text mark here: undo should take back the placing itself.
      keepEmptyRef.current = true
      ;(document.activeElement as HTMLElement | null)?.blur()
      finishEditing()
      keepEmptyRef.current = false
    }
    dispatch({ type: 'undo', hideEmpty })
  }

  const pointFrom = (e: React.PointerEvent): MarkPoint => {
    const rect = picRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 }
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }
  const capture = (e: React.PointerEvent): void => {
    try {
      picRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointers cannot be captured; moves still arrive */
    }
  }

  const onStageDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || !src) return
    if (editingRef.current !== null) {
      ;(document.activeElement as HTMLElement | null)?.blur()
      finishEditing()
      if (tool === 'text') return
    }
    dispatch({ type: 'select', n: null })
    const press = pointFrom(e)
    drag.current = { kind: 'draw', press }
    setDraft({ press, release: press })
    capture(e)
  }
  const onShapeDown = (n: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (editingRef.current === n) return
    const wasSelected = stateRef.current.selected === n
    if (editingRef.current !== null) {
      // Ending the edit can prune empty text marks and renumber the rest; the
      // press belongs to the mark under the pointer, at its new number.
      const marks = stateRef.current.marks
      const after = modeRef.current === 'picture' ? numberAfterPrune(marks, n) : n
      finishEditing()
      if (after === null) return
      n = after
    }
    dispatch({ type: 'select', n })
    dispatch({ type: 'begin' })
    drag.current = {
      kind: 'move',
      n,
      start: pointFrom(e),
      moved: false,
      wasSelected
    }
    capture(e)
  }
  const onHandleDown = (n: number, handle: MarkHandle) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    dispatch({ type: 'begin' })
    drag.current = { kind: 'handle', n, handle }
    capture(e)
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const p = pointFrom(e)
    if (d.kind === 'draw') setDraft({ press: d.press, release: p })
    else if (d.kind === 'move') {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      if (!d.moved && Math.hypot(dx * size.w, dy * size.h) < 3) return
      d.moved = true
      dispatch({ type: 'move', n: d.n, dx, dy })
    } else dispatch({ type: 'handle', n: d.n, handle: d.handle, to: p })
  }
  const onUp = (e: React.PointerEvent): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'draw') {
      setDraft(null)
      const release = pointFrom(e)
      const n = stateRef.current.marks.length + 1
      if (shapeFromDrag(tool, d.press, release, n)) {
        dispatch({ type: 'draw', tool, press: d.press, release })
        // A label pops up as soon as the shape is finished, ready to type.
        dispatch({ type: 'begin' })
        editingRef.current = n
        setEditing(n)
      }
      return
    }
    dispatch({ type: 'end' })
    // A click selects (handles show); a click on a mark already selected
    // opens its label for typing.
    if (d.kind === 'move' && !d.moved && d.wasSelected) startEditing(d.n)
  }

  const toggleMode = (): void => {
    const next = mode === 'picture' ? 'list' : 'picture'
    finishEditing()
    // An empty text mark has a row in the list but nothing to see on the picture.
    if (next === 'picture') dispatch({ type: 'sweep' })
    writeNotesMode(next)
    setMode(next)
  }

  const done = async (): Promise<void> => {
    if (saving) return
    ;(document.activeElement as HTMLElement | null)?.blur()
    finishEditing()
    const marks = pruneEmptyText(stateRef.current.marks)
    if (marks.length === 0) {
      if (session.marks.length > 0) session.onSaved(null)
      onClose()
      return
    }
    const img = imgRef.current
    if (!img) return
    setSaving(true)
    setError(null)
    try {
      const png = await renderMarkedPng(img, marks, mode === 'picture')
      const marked = await window.qa.addShot(session.requestPath, session.itemId, png)
      session.onSaved({
        picture: session.picture,
        marked,
        notes: mode,
        marks: savedMarks(marks),
        ...(session.option ? { option: session.option } : {})
      })
      onClose()
    } catch {
      setError('The marked-up picture could not be saved. Your marks are still here.')
      setSaving(false)
    }
  }

  useCommandScope({
    'app.close-back': {
      priority: 100,
      handler: () => {
        // Esc while typing keeps the label; otherwise it discards the drawing.
        if (editingRef.current !== null) {
          ;(document.activeElement as HTMLElement | null)?.blur()
          finishEditing()
        } else onClose()
      }
    },
    'markup.tool-arrow': { priority: 100, handler: () => setTool('arrow') },
    'markup.tool-box': { priority: 100, handler: () => setTool('box') },
    'markup.tool-text': { priority: 100, handler: () => setTool('text') },
    'markup.undo': { priority: 100, handler: undo },
    'markup.delete': {
      priority: 100,
      enabled: state.selected !== null && editing === null,
      handler: () => dispatch({ type: 'delete' })
    },
    'markup.toggle-notes': { priority: 100, handler: toggleMode },
    'markup.label-done': {
      priority: 100,
      enabled: editing !== null,
      handler: () => {
        ;(document.activeElement as HTMLElement | null)?.blur()
        finishEditing()
      }
    },
    'markup.done': { priority: 100, handler: () => void done() }
  })

  const px = (p: MarkPoint): { x: number; y: number } => ({ x: p.x * size.w, y: p.y * size.h })
  const count = state.marks.length

  const labelEditor = (m: Mark, className: string): React.JSX.Element => (
    <textarea
      className={className}
      rows={1}
      autoFocus
      value={m.text}
      placeholder="Type a note…"
      aria-label={`Note ${m.n}`}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => dispatch({ type: 'text', n: m.n, text: e.target.value })}
      onBlur={() => {
        if (editingRef.current === m.n) finishEditing()
      }}
    />
  )

  const shapes = state.marks.map((m) => {
    const sel = state.selected === m.n
    if (m.shape === 'box') {
      const a = px({ x: m.box.x, y: m.box.y })
      const w = m.box.w * size.w
      const h = m.box.h * size.h
      return (
        <g key={m.n} className={sel ? 'sel' : undefined}>
          <rect className="mkstroke" x={a.x} y={a.y} width={w} height={h} rx={8} />
          <rect
            className="mkhit"
            x={a.x}
            y={a.y}
            width={w}
            height={h}
            rx={8}
            style={{ pointerEvents: sel ? 'all' : 'stroke' }}
            onPointerDown={onShapeDown(m.n)}
          />
        </g>
      )
    }
    if (m.shape === 'arrow') {
      const from = px(m.from)
      const to = px(m.to)
      const [c1, c2] = arrowHeadCorners(from, to, 16)
      return (
        <g key={m.n} className={sel ? 'sel' : undefined}>
          <line
            className="mkstroke"
            x1={from.x}
            y1={from.y}
            x2={(c1.x + c2.x) / 2}
            y2={(c1.y + c2.y) / 2}
          />
          <polygon
            className="mkarrowhead"
            points={`${to.x},${to.y} ${c1.x},${c1.y} ${c2.x},${c2.y}`}
          />
          <line
            className="mkhit"
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            onPointerDown={onShapeDown(m.n)}
          />
        </g>
      )
    }
    return null
  })

  const draftShape = (() => {
    if (!draft || tool === 'text') return null
    const shape = shapeFromDrag(tool, draft.press, draft.release, 0)
    if (!shape) return null
    if (shape.shape === 'box') {
      const a = px(shape.box)
      return (
        <rect
          className="mkstroke draft"
          x={a.x}
          y={a.y}
          width={shape.box.w * size.w}
          height={shape.box.h * size.h}
          rx={8}
        />
      )
    }
    if (shape.shape === 'arrow') {
      const from = px(shape.from)
      const to = px(shape.to)
      const [c1, c2] = arrowHeadCorners(from, to, 16)
      return (
        <g className="draft">
          <line className="mkstroke" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
          <polygon
            className="mkarrowhead"
            points={`${to.x},${to.y} ${c1.x},${c1.y} ${c2.x},${c2.y}`}
          />
        </g>
      )
    }
    return null
  })()

  const handles = (m: Mark): React.JSX.Element[] => {
    const at = (p: MarkPoint, handle: MarkHandle): React.JSX.Element => (
      <span
        key={handle}
        className={`mkhandle h-${handle}`}
        style={{ left: p.x * size.w, top: p.y * size.h }}
        aria-hidden="true"
        onPointerDown={onHandleDown(m.n, handle)}
      />
    )
    if (m.shape === 'box') {
      const { x, y, w, h } = m.box
      return [
        at({ x, y }, 'nw'),
        at({ x: x + w, y }, 'ne'),
        at({ x, y: y + h }, 'sw'),
        at({ x: x + w, y: y + h }, 'se')
      ]
    }
    if (m.shape === 'arrow') return [at(m.from, 'from'), at(m.to, 'to')]
    return []
  }

  const labels =
    mode === 'picture'
      ? state.marks.map((m) => {
          const isEditing = editing === m.n
          if (!isEditing && !m.text.trim()) return null
          const anchor = labelAnchor(m)
          const shift = { start: '0%', end: '-100%', center: '-50%' }
          const tx = shift[anchor.alignX]
          const ty = shift[anchor.alignY]
          return (
            <div
              key={m.n}
              className={`mklabel${isEditing ? ' editing' : ''}${state.selected === m.n ? ' sel' : ''}`}
              style={{
                left: anchor.at.x * size.w,
                top: anchor.at.y * size.h,
                transform: `translate(${tx}, ${ty})`
              }}
              onPointerDown={onShapeDown(m.n)}
            >
              {isEditing ? labelEditor(m, 'mkinput') : <span className="mktext">{m.text}</span>}
            </div>
          )
        })
      : null

  return (
    <div
      className="overlay mkwin"
      role="dialog"
      aria-modal="true"
      aria-label={`Mark up ${session.eyebrow}`}
    >
      <div className={`mksheet${mode === 'list' ? ' listmode' : ''}`}>
        <div className="mkhead">
          <div className="mkq">
            <div className="eb">Mark up · {session.eyebrow}</div>
            <div className="qt">{session.title}</div>
          </div>
          <div
            className="mktools"
            role="toolbar"
            aria-label="Mark-up tools"
            // Buttons here must not take focus: a click would blur an open label
            // and close it before the button's own action runs.
            onMouseDown={(e) => e.preventDefault()}
          >
            {(['arrow', 'box', 'text'] as MarkTool[]).map((t) => (
              <ToolButton key={t} tool={t} on={tool === t} onPick={() => setTool(t)} />
            ))}
            <span className="mksep" aria-hidden="true" />
            <button
              type="button"
              className="mktool"
              disabled={state.past.length === 0}
              onClick={undo}
            >
              <Undo2 strokeWidth={2} aria-hidden="true" />
              Undo
            </button>
            <span className="mksep" aria-hidden="true" />
            <div className="mkmode" role="group" aria-label="Where the notes show">
              <button
                type="button"
                aria-pressed={mode === 'picture'}
                className={mode === 'picture' ? 'on' : undefined}
                onClick={() => mode !== 'picture' && toggleMode()}
              >
                <MessageSquareText strokeWidth={2} aria-hidden="true" />
                On picture
              </button>
              <button
                type="button"
                aria-pressed={mode === 'list'}
                className={mode === 'list' ? 'on' : undefined}
                onClick={() => mode !== 'list' && toggleMode()}
              >
                <List strokeWidth={2} aria-hidden="true" />
                List
              </button>
            </div>
          </div>
          <div className="mkend">
            <span className="mkesc">
              <kbd>Esc</kbd> discards
            </span>
            <button
              type="button"
              className="mkdone"
              disabled={saving || !src}
              onClick={() => void done()}
            >
              <Check strokeWidth={2.4} aria-hidden="true" />
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
        </div>
        {error && (
          <div className="mkerror" role="alert">
            {error}
          </div>
        )}
        <div className="mkbody">
          <div className="mkstage">
            {failed ? (
              <div className="docimg-state failed" role="status">
                <ImageOff aria-hidden="true" strokeWidth={2} />
                <span>Could not load the picture</span>
              </div>
            ) : (
              <div
                ref={picRef}
                className={`mkpic tool-${tool}`}
                onPointerDown={onStageDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              >
                {src && (
                  <img
                    ref={imgRef}
                    src={src}
                    alt={session.eyebrow}
                    draggable={false}
                    onLoad={() => {
                      const img = imgRef.current
                      if (img) setSize({ w: img.clientWidth, h: img.clientHeight })
                    }}
                  />
                )}
                {src && size.w > 0 && (
                  <>
                    <svg
                      className="mksvg"
                      width={size.w}
                      height={size.h}
                      viewBox={`0 0 ${size.w} ${size.h}`}
                    >
                      {shapes}
                      {draftShape}
                    </svg>
                    {(mode === 'list' ? state.marks : []).map((m) => {
                      const p = pinPoint(m)
                      return (
                        <span
                          key={m.n}
                          className={`mkpin${state.selected === m.n ? ' sel' : ''}`}
                          style={{ left: p.x * size.w, top: p.y * size.h }}
                          onPointerDown={onShapeDown(m.n)}
                        >
                          {m.n}
                        </span>
                      )
                    })}
                    {labels}
                    {state.selected !== null &&
                      editing === null &&
                      state.marks.filter((m) => m.n === state.selected).flatMap((m) => handles(m))}
                    {count === 0 && !draft && <div className="mkhint">{TOOL_HINT[tool]}</div>}
                  </>
                )}
              </div>
            )}
          </div>
          {mode === 'list' && (
            <aside className="mklist" aria-label="Notes">
              <h4>
                <span>Notes</span>
                <span>
                  {count} {count === 1 ? 'mark' : 'marks'}
                </span>
              </h4>
              {count === 0 ? (
                <div className="mkempty">
                  <b>Nothing marked yet.</b> Drag on the picture to draw a box or an arrow. Each
                  shape gets a number here, and you type its note in the row.
                </div>
              ) : (
                state.marks.map((m) => (
                  <div
                    key={m.n}
                    className={`mkrow${state.selected === m.n || editing === m.n ? ' sel' : ''}`}
                    onPointerDown={() => dispatch({ type: 'select', n: m.n })}
                  >
                    <span className="mkpin">{m.n}</span>
                    <div className="mkrowbody">
                      <div className="mkshape">
                        <ShapeIcon shape={m.shape} />
                        {shapeName(m.shape)}
                      </div>
                      <textarea
                        ref={(el) => {
                          if (el) rowRefs.current.set(m.n, el)
                          else rowRefs.current.delete(m.n)
                        }}
                        rows={2}
                        value={m.text}
                        placeholder="Type a note…"
                        aria-label={`Note ${m.n}`}
                        onFocus={() => startEditing(m.n)}
                        onBlur={() => {
                          if (editingRef.current === m.n) finishEditing()
                        }}
                        onChange={(e) => dispatch({ type: 'text', n: m.n, text: e.target.value })}
                      />
                    </div>
                  </div>
                ))
              )}
            </aside>
          )}
        </div>
        <div className="mkfoot">
          Drag to draw ·{' '}
          {mode === 'picture'
            ? 'click a label to type on the picture'
            : 'type each note in the list'}{' '}
          · <kbd>⌫</kbd> removes the selected mark · <kbd>⌘Z</kbd> undoes
        </div>
      </div>
    </div>
  )
}

/**
 * The Mark up button under an enlarged screenshot (a run's or a review's
 * strip). Clicking it must not close the zoom behind it first.
 */
export function ZoomMarkUpBar({
  marked,
  onMarkUp
}: {
  marked: boolean
  onMarkUp: () => void
}): React.JSX.Element {
  return (
    <div className="zoombar" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="mkopen" onClick={onMarkUp}>
        <PenLine strokeWidth={2} aria-hidden="true" />
        {marked ? 'Edit marks' : 'Mark up'}
        <kbd>M</kbd>
      </button>
      <span>
        <kbd>Esc</kbd> closes
      </span>
    </div>
  )
}
