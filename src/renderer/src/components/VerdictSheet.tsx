import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, X } from 'lucide-react'
import type { ReleaseVerdict } from '../../../main/qa/releaseRecords'
import type { HomeReleaseQuestion } from '../lib/projectHome'
import type { VerdictLayout } from '../../../shared/ipc'
import { useCommandScope } from '../commands/provider'
import { InlineText } from './InlineText'
import { ShotStrip } from './ShotStrip'
import { VerdictList } from './VerdictList'
import { blobToPngBase64, firstImageFile } from '../lib/imageToPng'

interface SheetProps {
  projectName: string
  version: string
  questions: HomeReleaseQuestion[]
  startAt?: number
  answer: (
    id: string,
    verdict: ReleaseVerdict,
    comment: string,
    screenshots: string[]
  ) => Promise<void>
  /** Stores one pasted or dropped PNG for feature `id`; its path, or `null` if refused. */
  attachShot: (id: string, pngBase64: string) => Promise<string | null>
  readShot: (relPath: string) => Promise<string | null>
  onClose: () => void
  /** Ticket 27: which way he last used; the sheet opens that way. */
  layout?: VerdictLayout
  /** Remembers the way he switched to. */
  onLayoutChange?: (layout: VerdictLayout) => void
}

/**
 * Ticket 27: the verdict sheet has a switch at the top — One at a time (the
 * sheet as ticket 21 drew it) or All at once (every waiting feature as a
 * card, VerdictList). Both answer through the same callbacks, pictures
 * included, and the sheet remembers which way he last used.
 */
export function VerdictSheet(props: SheetProps): React.JSX.Element {
  const [layout, setLayout] = useState<VerdictLayout>(props.layout ?? 'one')
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null)
  // One at a time: which feature is on screen. Kept here so the dialog is
  // named by it ("Verdict 2 of 3"), as ticket 21 drew it.
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(props.startAt ?? 0, 0), props.questions.length - 1)
  )
  const [dragOver, setDragOver] = useState(false)
  // One at a time takes a picture dropped anywhere on the sheet, as ticket 25
  // drew it; All at once takes it on the card it lands on.
  const dropOnSheetRef = useRef<((file: File | null) => void) | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const { onClose, onLayoutChange } = props

  useEffect(() => {
    sheet.current?.focus()
  }, [])

  const choose = useCallback(
    (next: VerdictLayout): void => {
      setLayout(next)
      onLayoutChange?.(next)
    },
    [onLayoutChange]
  )

  // Esc goes back, through the command layer like every other surface
  // (ADR-0011); with a picture zoomed, it closes the picture first.
  useCommandScope({
    'app.close-back': { priority: 100, handler: () => (zoom ? setZoom(null) : onClose()) },
    'verdicts.toggle-layout': {
      priority: 100,
      handler: () => choose(layout === 'one' ? 'all' : 'one')
    }
  })

  if (props.questions.length === 0) return <></>

  const switcher = (
    <div className="wseg verdict-switch" role="group" aria-label="Verdicts">
      <button
        type="button"
        className={layout === 'one' ? 'on' : ''}
        aria-pressed={layout === 'one'}
        onClick={() => choose('one')}
      >
        One at a time
      </button>
      <button
        type="button"
        className={layout === 'all' ? 'on' : ''}
        aria-pressed={layout === 'all'}
        onClick={() => choose('all')}
      >
        All at once
      </button>
    </div>
  )

  return (
    <div
      ref={sheet}
      className={`verdict-sheet ${layout === 'all' ? 'all-at-once' : 'one-at-a-time'}${
        dragOver ? ' dragover' : ''
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={
        layout === 'all'
          ? 'Verdicts all at once'
          : `Verdict ${index + 1} of ${props.questions.length}`
      }
      tabIndex={-1}
      onDragOver={(event) => {
        if (layout !== 'one') return
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (layout !== 'one') return
        event.preventDefault()
        setDragOver(false)
        dropOnSheetRef.current?.(firstDroppedImage(event.dataTransfer))
      }}
    >
      <div className="verdict-sheet-bar">
        <button type="button" className="verdict-back" onClick={onClose}>
          <ChevronLeft className="ic" strokeWidth={2} />
          Back to {props.projectName}
        </button>
        <kbd>Esc</kbd>
      </div>
      {layout === 'all' ? (
        <VerdictList
          version={props.version}
          questions={props.questions}
          startAt={props.startAt ?? 0}
          switcher={switcher}
          answer={props.answer}
          attachShot={props.attachShot}
          readShot={props.readShot}
          onZoom={(url, name) => setZoom({ url, name })}
        />
      ) : (
        <OneAtATime
          {...props}
          index={index}
          setIndex={setIndex}
          dropOnSheetRef={dropOnSheetRef}
          switcher={switcher}
          onZoom={(url, name) => setZoom({ url, name })}
        />
      )}
      {zoom && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Screenshot ${zoom.name}`}
          onClick={() => setZoom(null)}
        >
          <img className="zoomimg" src={zoom.url} alt={zoom.name} />
        </div>
      )}
    </div>
  )
}

/**
 * Ticket 21, drawing B (docs/design/2026-09-23-verdict-flow). Give the
 * verdict opens this sheet instead of sending him to Releases: "releases is
 * only for full release notes, not for me giving feedback". It walks the
 * waiting features one at a time and closes back onto the Overview.
 *
 * The questions are fixed when the sheet opens, so an answer that shrinks the
 * snapshot's waiting list cannot shift the feature he is looking at.
 *
 * Ticket 25: under the comment box sits the same screenshot strip a check
 * has. ⌘V or a drop attaches a picture to the feature on screen; the pictures
 * go with the verdict, and ✕ drops one from it (the PNG stays on disk, as in
 * a run). Skipping a feature leaves its pictures out of any answer.
 */
function OneAtATime({
  version,
  questions,
  answer,
  attachShot,
  readShot,
  onClose,
  index,
  setIndex,
  dropOnSheetRef,
  switcher,
  onZoom
}: SheetProps & {
  index: number
  setIndex: (index: number) => void
  dropOnSheetRef: React.MutableRefObject<((file: File | null) => void) | null>
  switcher: React.ReactNode
  onZoom: (url: string, name: string) => void
}): React.JSX.Element {
  const [comment, setComment] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const question = questions[index]
  const questionId = question?.id
  // The feature on screen now, for a picture save that finishes later.
  const onScreen = useRef(questionId)
  useLayoutEffect(() => {
    onScreen.current = questionId
  }, [questionId])

  const advance = (): void => {
    setComment('')
    setShots([])
    setError('')
    if (index + 1 >= questions.length) onClose()
    else setIndex(index + 1)
  }

  const ingest = useCallback(
    async (file: File | null): Promise<void> => {
      if (!file || !questionId) return
      const base64 = await blobToPngBase64(file)
      const rel = base64 ? await attachShot(questionId, base64).catch(() => null) : null
      // He answered or skipped while it saved: the picture belongs to a
      // feature no longer on screen, so it goes with no verdict. The PNG
      // stays on disk, as a removed one does.
      if (onScreen.current !== questionId) return
      if (!rel) {
        setError('That picture could not be attached.')
        return
      }
      setError('')
      setShots((current) => (current.includes(rel) ? current : [...current, rel]))
    },
    [attachShot, questionId]
  )

  useEffect(() => {
    dropOnSheetRef.current = (file) => void ingest(file)
    return () => {
      dropOnSheetRef.current = null
    }
  }, [dropOnSheetRef, ingest])

  // ⌘V anywhere in the sheet attaches to the feature on screen; a paste that
  // carries no picture is left alone, so text still pastes into the comment.
  useEffect(() => {
    function onPaste(event: ClipboardEvent): void {
      const file = firstImageFile(event.clipboardData?.items ?? null)
      if (!file) return
      event.preventDefault()
      void ingest(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [ingest])

  const give = async (verdict: ReleaseVerdict): Promise<void> => {
    if (!question || pending) return
    setPending(true)
    try {
      await answer(question.id, verdict, verdict === 'off' ? comment.trim() : '', shots)
      advance()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The verdict could not be saved.')
    } finally {
      setPending(false)
    }
  }

  if (!question) return <></>
  const next = questions[index + 1]

  return (
    <div className="verdict-sheet-body">
      <div className="verdict-top">
        <div className="verdict-step">
          {version} · verdict {index + 1} of {questions.length}
        </div>
        {switcher}
      </div>
      <div className="verdict-dots" aria-hidden="true">
        {questions.map((q, i) => (
          <i key={q.key} className={i <= index ? 'on' : ''} />
        ))}
      </div>
      <h2 className="verdict-title">{question.title}</h2>
      {question.detail && (
        <p className="verdict-detail">
          <InlineText text={question.detail} />
        </p>
      )}
      {question.howToCheck && (
        <div className="verdict-how">
          <b>How to check.</b> <InlineText text={question.howToCheck} />
        </div>
      )}
      <label className="verdict-comment">
        <span>Anything to say? (optional)</span>
        <textarea
          value={comment}
          placeholder="Only if something's off"
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      <div className="verdict-shots">
        <ShotStrip
          key={question.id}
          read={readShot}
          screenshots={shots}
          readOnly={false}
          onZoom={onZoom}
          onRemove={(rel) => setShots((current) => current.filter((shot) => shot !== rel))}
          onPasteHint={() => setError('Paste a screenshot with ⌘V, or drop one onto the sheet.')}
        />
      </div>
      {error && (
        <p className="verdict-error" role="alert">
          {error}
        </p>
      )}
      <div className="verdict-actions">
        <button
          type="button"
          className="verdict-btn works"
          disabled={pending}
          onClick={() => void give('works')}
        >
          <Check className="ic" strokeWidth={2.2} />
          Works
        </button>
        <button
          type="button"
          className="verdict-btn off"
          disabled={pending}
          onClick={() => void give('off')}
        >
          <X className="ic" strokeWidth={2.2} />
          Something&apos;s off
        </button>
        <button type="button" className="verdict-btn skip" disabled={pending} onClick={advance}>
          Skip for now
        </button>
      </div>
      {next && <p className="verdict-next">Next: {next.title}</p>}
    </div>
  )
}

function firstDroppedImage(transfer: DataTransfer | null): File | null {
  for (const file of Array.from(transfer?.files ?? [])) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}
