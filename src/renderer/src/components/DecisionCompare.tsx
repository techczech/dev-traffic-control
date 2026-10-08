import { useEffect, useLayoutEffect, useRef } from 'react'
import { Check, PenLine, X } from 'lucide-react'
import { optionShortLabel } from '../lib/richtext'
import type { OptionPicture } from '../lib/richtext'
import type { DecisionInfo } from '../lib/decisions'
import type { DecisionAnswer } from '../../../main/qa/types'
import { DocumentImage } from './DocumentImage'
import { OptionCaption } from './DecisionCard'
import { growTextarea } from '../lib/growTextarea'
import type { DecisionImages } from './DecisionCard'
import { isMarkablePicture, pictureKey } from '../lib/markup'

/** The Mark up button's words: Edit marks once the picture carries marks. */
function markUpLabel(answer: DecisionAnswer | undefined, src: string): string {
  const key = pictureKey(src)
  return answer?.markups?.some((m) => m.picture === key) ? 'Edit marks' : 'Mark up'
}

interface Pick {
  info: DecisionInfo
  answer: DecisionAnswer | undefined
  readOnly: boolean
  images: DecisionImages
  onChoice: (choice: string) => void
  onComment?: (text: string) => void
}

/**
 * The window-sized compare view: every picture of one decision side by side
 * with its full text and a Choose button; options without a picture sit in a
 * plain row underneath. Choosing writes through the same answer path as the
 * card (the parent passes the same `onChoice`). Esc is handled by the Reading
 * surface's close command.
 */
export function DecisionCompare({
  info,
  answer,
  readOnly,
  images,
  onChoice,
  onComment,
  onClose,
  onZoom,
  onMarkUp
}: Pick & {
  onComment: (text: string) => void
  onClose: () => void
  onZoom: (url: string, name: string) => void
  /** Open the mark-up view on one of this decision's pictures. */
  onMarkUp?: (option: number, picture: number) => void
}): React.JSX.Element {
  const choice = answer?.choice ?? ''
  const comment = answer?.comment ?? ''
  const commentRef = useRef<HTMLTextAreaElement | null>(null)
  const focusComment = useRef(false)
  const plain = info.options.map((_o, i) => i).filter((i) => !info.pictured.includes(i))
  const chosenIndex = choice ? info.options.indexOf(choice) : -1

  useLayoutEffect(() => {
    if (commentRef.current) growTextarea(commentRef.current)
  })
  useEffect(() => {
    if (focusComment.current && commentRef.current) {
      focusComment.current = false
      commentRef.current.focus()
    }
  }, [choice])

  const pick = (o: number): void => {
    if (choice !== info.options[o]) focusComment.current = true
    onChoice(info.options[o])
  }
  const commentBox = (label: string): React.JSX.Element | null =>
    readOnly ? (
      comment ? (
        <div className="dcmt">{comment}</div>
      ) : null
    ) : (
      <>
        <div className="clbl">Your comment on this pick</div>
        <textarea
          ref={commentRef}
          className="ccomment"
          rows={2}
          value={comment}
          placeholder="Optional comment on this pick…"
          aria-label={`Comment on ${label}`}
          onChange={(e) => {
            onComment(e.target.value)
            growTextarea(e.target)
          }}
        />
      </>
    )

  return (
    <div
      className="overlay cmpwin"
      role="dialog"
      aria-modal="true"
      aria-label={`Compare pictures: ${info.name}`}
      onClick={onClose}
    >
      <div className="cmpsheet" onClick={(e) => e.stopPropagation()}>
        <div className="cmphead">
          <div className="q">
            <div className="eb">
              <span className={`dm${choice ? ' done' : ''}`} aria-hidden="true" />
              Decision {info.number} of {info.total} · {info.name}
            </div>
            <div className="qt">{info.question}</div>
          </div>
          <div className="esc">
            <kbd>Esc</kbd> closes
            <button type="button" className="xbtn" aria-label="Close" onClick={onClose}>
              <X strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="cmpbody">
          <div
            className="cols"
            style={{
              gridTemplateColumns: `repeat(${Math.min(info.pictured.length, 3)}, minmax(0, 1fr))`
            }}
          >
            {info.pictured.map((o) => {
              const sel = choice === info.options[o]
              const dim = !!choice && !sel
              return (
                <div key={o} className={`col${sel ? ' sel' : ''}${dim ? ' dim' : ''}`}>
                  {info.pictures[o].map((pic: OptionPicture, i) => (
                    <div
                      key={i}
                      className="colimg"
                      onClick={(e) => {
                        const img = (e.target as HTMLElement).closest('img')
                        if (img) onZoom(img.currentSrc || img.src, pic.alt || info.options[o])
                      }}
                    >
                      <DocumentImage
                        cacheRef={images.cacheRef}
                        requestPath={images.requestPath}
                        src={pic.src}
                        alt={pic.alt || info.options[o]}
                        className="dpic"
                      />
                      {onMarkUp && !readOnly && isMarkablePicture(pictureKey(pic.src)) && (
                        <button
                          type="button"
                          className="mkopen onpic"
                          onClick={(e) => {
                            e.stopPropagation()
                            onMarkUp(o, i)
                          }}
                        >
                          <PenLine strokeWidth={2} aria-hidden="true" />
                          {markUpLabel(answer, pic.src)}
                        </button>
                      )}
                    </div>
                  ))}
                  <OptionCaption label={info.options[o]} />
                  <button
                    type="button"
                    className="choose"
                    role="radio"
                    aria-checked={sel}
                    disabled={readOnly}
                    onClick={() => pick(o)}
                  >
                    {sel && <Check strokeWidth={2} />}
                    {sel ? 'Chosen' : 'Choose this'}
                  </button>
                  {sel && commentBox(optionShortLabel(info.options[o]))}
                </div>
              )
            })}
          </div>
          {plain.length > 0 && (
            <div className="otherrow">
              <span className="lb">No picture:</span>
              {plain.map((o) => {
                const on = choice === info.options[o]
                return (
                  <button
                    key={o}
                    type="button"
                    className={`obtn${on ? ' on' : ''}`}
                    role="radio"
                    aria-checked={on}
                    disabled={readOnly}
                    onClick={() => pick(o)}
                  >
                    {on ? <Check strokeWidth={2} /> : <span className="dot" aria-hidden="true" />}
                    <span>{info.options[o]}</span>
                  </button>
                )
              })}
            </div>
          )}
          {chosenIndex >= 0 && !info.pictured.includes(chosenIndex) && (
            <div className="plaincomment">
              {commentBox(optionShortLabel(info.options[chosenIndex]))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A picture enlarged from the card. Steps (the picture-previous and picture-next commands, ←/→, or the round buttons) run over
 * this decision's pictures only. The pick can be made from here.
 */
export function DecisionLightbox({
  info,
  answer,
  readOnly,
  images,
  start,
  onChoice,
  onStep,
  onClose,
  onMarkUp
}: Omit<Pick, 'onComment'> & {
  /** Position in the decision's flattened pictures. */
  start: number
  onStep: (index: number) => void
  onClose: () => void
  /** Open the mark-up view on the picture shown. */
  onMarkUp?: (option: number, picture: number) => void
}): React.JSX.Element {
  const flat = info.pictured.flatMap((o) =>
    info.pictures[o].map((pic, picture) => ({ option: o, picture, pic }))
  )
  const n = flat.length
  const index = ((start % n) + n) % n
  const item = flat[index]
  const label = info.options[item.option]
  const short = optionShortLabel(label)
  const chosen = answer?.choice === label
  const rest = label.indexOf(':') > 0 ? label.slice(label.indexOf(':') + 1).trim() : ''
  const optionsInOrder = Array.from(
    new Set(flat.map((f) => optionShortLabel(info.options[f.option])))
  )

  return (
    <div
      className="overlay lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Picture ${short}`}
      onClick={onClose}
    >
      <div className="lbmid" onClick={(e) => e.stopPropagation()}>
        {n > 1 && (
          <button
            type="button"
            className="nv"
            aria-label="Previous picture"
            onClick={() => onStep(index - 1)}
          >
            ‹
          </button>
        )}
        <DocumentImage
          cacheRef={images.cacheRef}
          requestPath={images.requestPath}
          src={item.pic.src}
          alt={item.pic.alt || label}
          className="lbimg"
        />
        {n > 1 && (
          <button
            type="button"
            className="nv"
            aria-label="Next picture"
            onClick={() => onStep(index + 1)}
          >
            ›
          </button>
        )}
      </div>
      <div className="lbcap" onClick={(e) => e.stopPropagation()}>
        <b>{short}</b> ({index + 1} of {n}){rest ? `: ${rest}` : ''}
      </div>
      <div className="lbrow" onClick={(e) => e.stopPropagation()}>
        {n > 1 && (
          <span>
            <kbd>←</kbd> <kbd>→</kbd> steps between {optionsInOrder.join(' and ')} only
          </span>
        )}
        {onMarkUp && !readOnly && isMarkablePicture(pictureKey(item.pic.src)) && (
          <button
            type="button"
            className="lbbtn mkopen"
            onClick={() => onMarkUp(item.option, item.picture)}
          >
            <PenLine strokeWidth={2} aria-hidden="true" />
            {markUpLabel(answer, item.pic.src)}
            <kbd>M</kbd>
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            className="lbbtn"
            onClick={() => {
              if (!chosen) onChoice(label)
              onClose()
            }}
          >
            <Check strokeWidth={2} />
            {chosen ? `Chosen: ${short}` : `Choose ${short}`}
          </button>
        )}
        <span>
          <kbd>Esc</kbd> closes
        </span>
      </div>
    </div>
  )
}
