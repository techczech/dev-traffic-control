import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import type { ReleaseVerdict } from '../../../main/qa/releaseRecords'
import type { HomeReleaseQuestion } from '../lib/projectHome'
import { useCommandChord, useCommandScope } from '../commands/provider'
import { displayChord } from '../commands/keymap'
import { isActivatableTarget } from '../lib/lightRun'
import { blobToPngBase64, firstImageFile } from '../lib/imageToPng'
import { formatClock } from '../lib/format'
import { InlineText } from './InlineText'
import { ShotStrip } from './ShotStrip'

/** One answer given in this sheet: shown on its faded card, which stays in the list. */
interface GivenAnswer {
  verdict: ReleaseVerdict
  at: string
}

/**
 * Ticket 27, drawing `verdicts-all-at-once`: every waiting feature of the
 * release as a card with its coloured edge. The focused card opens How to
 * check, its comment box and its screenshot strip; Space answers Works and F
 * Something's off, as in a check; ↑/↓ move between cards. Answered cards fade,
 * show the verdict and its time, and stay in the list.
 *
 * Answers and pictures go through the same callbacks as the one-at-a-time
 * sheet (ticket 25's confined handlers); there is no second write path.
 *
 * A picture belongs to the card that was focused when it was pasted or the
 * card it was dropped on, fixed at that moment. If that card is answered
 * before the picture has saved, the picture goes with no verdict (the PNG
 * stays on disk, as a removed one does); it never lands on another card.
 */
export function VerdictList({
  version,
  questions,
  startAt,
  switcher,
  answer,
  attachShot,
  readShot,
  onZoom
}: {
  version: string
  questions: HomeReleaseQuestion[]
  startAt: number
  /** The One at a time / All at once switch, drawn at the top right. */
  switcher: React.ReactNode
  answer: (
    id: string,
    verdict: ReleaseVerdict,
    comment: string,
    screenshots: string[]
  ) => Promise<void>
  attachShot: (id: string, pngBase64: string) => Promise<string | null>
  readShot: (relPath: string) => Promise<string | null>
  onZoom: (url: string, name: string) => void
}): React.JSX.Element {
  const [focusedId, setFocusedId] = useState<string | undefined>(
    () => questions[Math.min(Math.max(startAt, 0), questions.length - 1)]?.id
  )
  const [answers, setAnswers] = useState<Record<string, GivenAnswer>>({})
  const [comments, setComments] = useState<Record<string, string>>({})
  const [shots, setShots] = useState<Record<string, string[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [howOpen, setHowOpen] = useState<Record<string, boolean>>({})
  // Cards whose answer has begun: a picture finishing its save after that is
  // not added to them, and is never moved to another card.
  const closed = useRef(new Set<string>())
  const cards = useRef(new Map<string, HTMLElement>())
  const focusedRef = useRef(focusedId)
  useLayoutEffect(() => {
    focusedRef.current = focusedId
  }, [focusedId])

  const setError = (id: string, message: string): void =>
    setErrors((current) => ({ ...current, [id]: message }))

  const ingest = useCallback(
    async (id: string, file: File | null): Promise<void> => {
      if (!file || closed.current.has(id)) return
      const base64 = await blobToPngBase64(file)
      const rel = base64 ? await attachShot(id, base64).catch(() => null) : null
      if (closed.current.has(id)) return
      if (!rel) {
        setErrors((current) => ({ ...current, [id]: 'That picture could not be attached.' }))
        return
      }
      setErrors((current) => ({ ...current, [id]: '' }))
      setShots((current) => {
        const list = current[id] ?? []
        return list.includes(rel) ? current : { ...current, [id]: [...list, rel] }
      })
    },
    [attachShot]
  )

  // ⌘V anywhere attaches to the focused card; a paste with no picture is left
  // alone so text still pastes into a comment box.
  useEffect(() => {
    function onPaste(event: ClipboardEvent): void {
      const file = firstImageFile(event.clipboardData?.items ?? null)
      if (!file) return
      event.preventDefault()
      const id = focusedRef.current
      if (id) void ingest(id, file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [ingest])

  const nextOpenAfter = (id: string, answered: Record<string, GivenAnswer>): string | undefined => {
    const at = questions.findIndex((question) => question.id === id)
    const order = [...questions.slice(at + 1), ...questions.slice(0, at)]
    return order.find((question) => !answered[question.id])?.id
  }

  const give = async (id: string, verdict: ReleaseVerdict): Promise<void> => {
    if (pending || answers[id]) return
    setPending(id)
    closed.current.add(id)
    try {
      const comment = verdict === 'off' ? (comments[id] ?? '').trim() : ''
      await answer(id, verdict, comment, shots[id] ?? [])
      const given = { ...answers, [id]: { verdict, at: new Date().toISOString() } }
      setAnswers(given)
      setError(id, '')
      // As in a check: answering the focused card moves on to the next open one.
      if (focusedRef.current === id) setFocusedId(nextOpenAfter(id, given) ?? id)
    } catch (cause) {
      closed.current.delete(id)
      setError(id, cause instanceof Error ? cause.message : 'The verdict could not be saved.')
    } finally {
      setPending(null)
    }
  }

  const move = (delta: number): void => {
    const at = questions.findIndex((question) => question.id === focusedId)
    const next = questions[Math.min(Math.max(at + delta, 0), questions.length - 1)]
    if (next) setFocusedId(next.id)
  }

  useEffect(() => {
    if (!focusedId) return
    cards.current.get(focusedId)?.scrollIntoView?.({ block: 'nearest' })
  }, [focusedId])

  const focusedOpen = !!focusedId && !answers[focusedId]
  useCommandScope({
    'nav.move-down': { priority: 100, handler: () => move(1) },
    'nav.move-up': { priority: 100, handler: () => move(-1) },
    'verdicts.works': {
      enabled: focusedOpen && !pending,
      priority: 100,
      preventDefault: false,
      handler: (event) => {
        // Space on a focused button presses that button, as everywhere.
        if (isActivatableTarget(event?.target ?? null)) return
        event?.preventDefault()
        if (focusedId) void give(focusedId, 'works')
      }
    },
    'verdicts.off': {
      enabled: focusedOpen && !pending,
      priority: 100,
      handler: () => focusedId && void give(focusedId, 'off')
    }
  })

  const moveChord = `${displayChord(useCommandChord('nav.move-up'))} ${displayChord(useCommandChord('nav.move-down'))}`
  const worksChord = displayChord(useCommandChord('verdicts.works'))
  const offChord = displayChord(useCommandChord('verdicts.off'))
  const backChord = displayChord(useCommandChord('app.close-back'))
  const waiting = questions.filter((question) => !answers[question.id]).length

  return (
    <div className="verdict-sheet-body verdict-list">
      <div className="verdict-top">
        <div className="verdict-step">
          {version} · {waiting} of {questions.length} waiting
        </div>
        {switcher}
      </div>
      <div className="verdict-cards">
        {questions.map((question) => {
          const id = question.id
          const given = answers[id]
          const focused = id === focusedId
          const busy = pending === id
          return (
            <article
              key={question.key}
              ref={(element) => {
                if (element) cards.current.set(id, element)
                else cards.current.delete(id)
              }}
              className={`verdict-card${focused ? ' focused' : ''}${given ? ' answered' : ''}${
                dragOver === id ? ' dragover' : ''
              }`}
              aria-label={question.title}
              aria-current={focused ? 'true' : undefined}
              onClick={() => setFocusedId(id)}
              onDragOver={(event) => {
                if (given) return
                event.preventDefault()
                setDragOver(id)
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => {
                event.preventDefault()
                setDragOver(null)
                if (given) return
                setFocusedId(id)
                void ingest(id, firstDroppedImage(event.dataTransfer))
              }}
            >
              <h3 className="verdict-card-title">{question.title}</h3>
              {question.detail && (
                <p className="verdict-detail">
                  <InlineText text={question.detail} />
                </p>
              )}
              {given ? (
                <p className={`verdict-card-given ${given.verdict}`}>
                  {given.verdict === 'works' ? (
                    <Check className="ic" strokeWidth={2.2} />
                  ) : (
                    <X className="ic" strokeWidth={2.2} />
                  )}
                  {given.verdict === 'works' ? 'Works' : 'Something’s off'} ·{' '}
                  {formatClock(given.at)}
                </p>
              ) : (
                <>
                  {focused && question.howToCheck && (
                    <div className="verdict-card-how">
                      <button
                        type="button"
                        className={`verdict-how-toggle${howOpen[id] ? ' open' : ''}`}
                        aria-expanded={!!howOpen[id]}
                        onClick={() =>
                          setHowOpen((current) => ({ ...current, [id]: !current[id] }))
                        }
                      >
                        <ChevronRight className="ic" strokeWidth={2.2} />
                        How to check
                      </button>
                      {howOpen[id] && (
                        <div className="verdict-how">
                          <InlineText text={question.howToCheck} />
                        </div>
                      )}
                    </div>
                  )}
                  {focused && (
                    <>
                      <label className="verdict-comment">
                        <span className="verdict-sr">Comment on {question.title}</span>
                        <textarea
                          value={comments[id] ?? ''}
                          placeholder="Anything to say? (optional)"
                          onChange={(event) =>
                            setComments((current) => ({ ...current, [id]: event.target.value }))
                          }
                        />
                      </label>
                      <div className="verdict-shots">
                        <ShotStrip
                          key={id}
                          read={readShot}
                          screenshots={shots[id] ?? []}
                          readOnly={false}
                          onZoom={onZoom}
                          onRemove={(rel) =>
                            setShots((current) => ({
                              ...current,
                              [id]: (current[id] ?? []).filter((shot) => shot !== rel)
                            }))
                          }
                          onPasteHint={() =>
                            setError(id, 'Paste a screenshot with ⌘V, or drop one onto this card.')
                          }
                        />
                      </div>
                    </>
                  )}
                  {errors[id] && (
                    <p className="verdict-error" role="alert">
                      {errors[id]}
                    </p>
                  )}
                  <div className="verdict-actions">
                    <button
                      type="button"
                      className="verdict-btn works"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation()
                        void give(id, 'works')
                      }}
                    >
                      <Check className="ic" strokeWidth={2.2} />
                      Works
                      {focused && worksChord && <kbd>{worksChord}</kbd>}
                    </button>
                    <button
                      type="button"
                      className="verdict-btn off"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation()
                        void give(id, 'off')
                      }}
                    >
                      <X className="ic" strokeWidth={2.2} />
                      Something&apos;s off
                      {focused && offChord && <kbd>{offChord}</kbd>}
                    </button>
                  </div>
                </>
              )}
            </article>
          )
        })}
      </div>
      <p className="verdict-keys">
        {moveChord} move between features · {worksChord} works · {offChord} something&apos;s off ·{' '}
        {backChord} back
      </p>
    </div>
  )
}

function firstDroppedImage(transfer: DataTransfer | null): File | null {
  for (const file of Array.from(transfer?.files ?? [])) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}
