import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Image as ImageIcon, MessageSquare } from 'lucide-react'
import { renderRuns, runsText, optionShortLabel, splitOptionLabel } from '../lib/richtext'
import { growTextarea } from '../lib/growTextarea'
import type { DocBlock } from '../lib/richtext'
import type { DecisionInfo } from '../lib/decisions'
import type { DecisionAnswer, PictureMarkup } from '../../../main/qa/types'
import { DocumentImage } from './DocumentImage'
import { MarkedPictures } from './MarkedPictures'

type DecisionDoc = Extract<DocBlock, { kind: 'decision' }>

/** What an image needs to resolve: the per-request cache and the request path. */
export interface DecisionImages {
  cacheRef: React.RefObject<Map<string, Promise<string>>>
  requestPath: string
}

export interface DecisionCardProps {
  block: DecisionDoc
  info: DecisionInfo | undefined
  answer: DecisionAnswer | undefined
  readOnly: boolean
  /** The decision the rail is pointing at: outlined in the document. */
  current: boolean
  images: DecisionImages
  onChoice: (choice: string) => void
  onComment: (text: string) => void
  onCompare: () => void
  onEnlarge: (option: number, picture: number) => void
  /** Reopen the mark-up view on a picture the reviewer already marked. */
  onEditMarks?: (markup: PictureMarkup) => void
  /** Show a marked-up copy large. */
  onZoom?: (url: string, name: string) => void
}

export function OptionCaption({ label }: { label: string }): React.JSX.Element {
  const [head, rest] = splitOptionLabel(label)
  return (
    <div className="cap">
      <b>{rest ? `${head}:` : head}</b>
      {rest ? ` ${rest}` : ''}
    </div>
  )
}

function DecisionHeader({
  info,
  answered,
  pictures
}: {
  info: DecisionInfo
  answered: boolean
  pictures?: number
}): React.JSX.Element {
  return (
    <div className="dn">
      <span className={`dm${answered ? ' done' : ''}`} aria-hidden="true" />
      Decision {info.number} of {info.total} · {info.name}
      {pictures ? <span className="cnt">{pictures} pictures</span> : null}
    </div>
  )
}

/**
 * One decision in the document. With linked pictures it is the side-by-side
 * card; without, it is the plain button block old records have always had.
 */
export function DecisionBlock(props: DecisionCardProps): React.JSX.Element {
  if (props.info && props.info.pictured.length > 0) return <PictureDecision {...props} />
  return <PlainDecision {...props} />
}

/** The one-click block: question, options, optional comment. Unchanged in behaviour. */
function PlainDecision({
  block,
  info,
  answer,
  readOnly,
  current,
  onChoice,
  onComment
}: DecisionCardProps): React.JSX.Element {
  const choice = answer?.choice ?? ''
  const comment = answer?.comment ?? ''
  const [showComment, setShowComment] = useState(!!comment)
  return (
    <div
      className={`decision${choice ? ' answered' : ''}${current ? ' jump' : ''}`}
      data-decision={block.id}
    >
      {info && <DecisionHeader info={info} answered={!!choice} />}
      <div className="dq">{renderRuns(block.question)}</div>
      <div className="dopts" role="radiogroup" aria-label="Decision options">
        {block.options.map((opt) => {
          const on = choice === opt
          return (
            <button
              key={opt}
              type="button"
              className={`dopt${on ? ' on' : ''}`}
              role="radio"
              aria-checked={on}
              disabled={readOnly}
              onClick={() => onChoice(opt)}
            >
              {on ? <Check strokeWidth={2} /> : <span className="dot" aria-hidden="true" />}
              <span>{opt}</span>
            </button>
          )
        })}
      </div>
      {!readOnly && !showComment && !comment && (
        <button type="button" className="daddc" onClick={() => setShowComment(true)}>
          <MessageSquare strokeWidth={2} />
          Add a comment
        </button>
      )}
      {(showComment || comment) && (
        <textarea
          className="dcomment"
          rows={1}
          placeholder="Optional comment on this decision…"
          value={comment}
          readOnly={readOnly}
          aria-label={`Comment on decision: ${runsText(block.question)}`}
          onChange={(e) => {
            onComment(e.target.value)
            growTextarea(e.target)
          }}
        />
      )}
    </div>
  )
}

/**
 * The side-by-side card. Two states while a picture is chosen: editing (every
 * picture visible, the others faded, the comment box under the pick) and
 * settled (the pick large with its text and comment, the rest small). It
 * settles when focus leaves the card; a card that opens already answered starts
 * settled, and Change reopens it.
 */
function PictureDecision({
  block,
  info,
  answer,
  readOnly,
  current,
  images,
  onChoice,
  onComment,
  onCompare,
  onEnlarge,
  onEditMarks,
  onZoom
}: DecisionCardProps): React.JSX.Element {
  const choice = answer?.choice ?? ''
  const comment = answer?.comment ?? ''
  const chosenIndex = choice ? block.options.indexOf(choice) : -1
  const chosenPictured = chosenIndex >= 0 && block.pictures[chosenIndex].length > 0
  const [editing, setEditing] = useState(!chosenPictured)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const commentRef = useRef<HTMLTextAreaElement | null>(null)
  const focusComment = useRef(false)
  const pictured = info?.pictured ?? []
  const count = pictured.reduce((n, o) => n + block.pictures[o].length, 0)
  const plain = block.options.map((_o, i) => i).filter((i) => !pictured.includes(i))
  const settled = chosenPictured && !editing

  useLayoutEffect(() => {
    if (commentRef.current) growTextarea(commentRef.current)
  })
  useEffect(() => {
    if (focusComment.current && commentRef.current) {
      focusComment.current = false
      commentRef.current.focus()
    }
  }, [choice, editing])

  const pick = (o: number): void => {
    const label = block.options[o]
    if (choice !== label) {
      focusComment.current = true
      setEditing(true)
    }
    onChoice(label)
  }

  const commentBox = (label: string): React.JSX.Element | null => {
    if (readOnly) {
      return comment ? <div className="dcmt">{comment}</div> : null
    }
    return (
      <textarea
        ref={commentRef}
        className="dpcomment"
        rows={2}
        placeholder="Optional comment on this pick…"
        value={comment}
        aria-label={`Comment on ${label}`}
        onChange={(e) => {
          onComment(e.target.value)
          growTextarea(e.target)
        }}
      />
    )
  }

  const picture = (o: number, p: number, mode: 'card' | 'big'): React.JSX.Element => {
    const pic = block.pictures[o][p]
    return (
      <button
        key={`${o}.${p}`}
        type="button"
        className={`pimg${mode === 'big' ? ' big' : ''}`}
        aria-label={`Enlarge ${splitOptionLabel(block.options[o])[0]}`}
        onClick={() => onEnlarge(o, p)}
      >
        <DocumentImage
          cacheRef={images.cacheRef}
          requestPath={images.requestPath}
          src={pic.src}
          alt={pic.alt || block.options[o]}
          className="dpic"
        />
        {mode === 'card' && <span className="zi">Enlarge</span>}
      </button>
    )
  }

  const cols = Math.min(pictured.length, 3)
  const short = (o: number): string => optionShortLabel(block.options[o])

  return (
    <div
      ref={cardRef}
      className={`decision card2${choice ? ' answered' : ''}${current ? ' jump' : ''}${
        settled ? ' settled' : ''
      }`}
      data-decision={block.id}
      onBlur={(e) => {
        if (chosenPictured && !cardRef.current?.contains(e.relatedTarget as Node | null))
          setEditing(false)
      }}
    >
      {info && <DecisionHeader info={info} answered={!!choice} pictures={count} />}
      <div className="dq">{renderRuns(block.question)}</div>

      {settled ? (
        <div className="thumbs2">
          <div className="bigcol">
            {block.pictures[chosenIndex].map((_p, i) => picture(chosenIndex, i, 'big'))}
          </div>
          <div className="rest">
            <OptionCaption label={block.options[chosenIndex]} />
            {comment && (
              <div className="dcmt">
                <small>Your comment</small>
                {comment}
              </div>
            )}
            <div className="smalls">
              {pictured
                .filter((o) => o !== chosenIndex)
                .map((o) => (
                  <button
                    key={o}
                    type="button"
                    className="sm"
                    aria-label={`Enlarge ${short(o)}, not chosen`}
                    onClick={() => onEnlarge(o, 0)}
                  >
                    <DocumentImage
                      cacheRef={images.cacheRef}
                      requestPath={images.requestPath}
                      src={block.pictures[o][0].src}
                      alt={block.pictures[o][0].alt || block.options[o]}
                      className="dpic"
                    />
                    <small>{short(o)} · not chosen</small>
                  </button>
                ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="pgrid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {pictured.map((o) => {
            const sel = choice === block.options[o]
            const dim = !!choice && !sel
            return (
              <div key={o} className={`pcol${sel ? ' sel' : ''}${dim ? ' dim' : ''}`}>
                {block.pictures[o].map((_p, i) => picture(o, i, 'card'))}
                <OptionCaption label={block.options[o]} />
                <button
                  type="button"
                  className="pick"
                  role="radio"
                  aria-checked={sel}
                  disabled={readOnly}
                  onClick={() => pick(o)}
                >
                  {sel && <Check strokeWidth={2} />}
                  {sel ? 'Chosen' : `Choose ${short(o)}`}
                </button>
                {sel && commentBox(short(o))}
              </div>
            )
          })}
        </div>
      )}

      {plain.length > 0 && (
        <div className="dopts plainrow" role="radiogroup" aria-label="Options without a picture">
          {plain.map((o) => {
            const on = choice === block.options[o]
            return (
              <button
                key={o}
                type="button"
                className={`dopt${on ? ' on' : ''}`}
                role="radio"
                aria-checked={on}
                disabled={readOnly}
                onClick={() => pick(o)}
              >
                {on ? <Check strokeWidth={2} /> : <span className="dot" aria-hidden="true" />}
                <span>{block.options[o]}</span>
              </button>
            )
          })}
        </div>
      )}
      {chosenIndex >= 0 && !chosenPictured && commentBox(short(chosenIndex))}

      {answer?.markups && answer.markups.length > 0 && (
        <MarkedPictures
          requestPath={images.requestPath}
          markups={answer.markups}
          readOnly={readOnly || !onEditMarks}
          caption={(m) => (m.option ? optionShortLabel(m.option) : 'Picture')}
          onEdit={(m) => onEditMarks?.(m)}
          onZoom={onZoom}
        />
      )}

      <div className="hintrow">
        <ImageIcon strokeWidth={2} aria-hidden="true" />
        <span>
          Click a picture to enlarge it and mark it up · <kbd>←</kbd> <kbd>→</kbd> step between
          these {count} only
        </span>
        <button type="button" className="cmpbtn" onClick={onCompare}>
          <ImageIcon strokeWidth={2} aria-hidden="true" />
          Compare {count} pictures
        </button>
      </div>
      {settled && !readOnly && (
        <button
          type="button"
          className="daddc change"
          onClick={() => {
            focusComment.current = true
            setEditing(true)
          }}
        >
          Change
        </button>
      )}
    </div>
  )
}
