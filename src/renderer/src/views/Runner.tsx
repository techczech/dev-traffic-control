import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronDown,
  Flag,
  Inbox as InboxIcon,
  Quote as QuoteIcon,
  Rows3,
  RotateCw,
  Square,
  SquarePen,
  TriangleAlert
} from 'lucide-react'
import { useApp } from '../state/app'
import { renderBold } from '../lib/richtext'
import { formatClock, verdictCounts } from '../lib/format'
import { followRecordExit, recordExit, type RecordExit } from '../lib/recordExit'
import { copyCollectPromptAfterFinish } from '../lib/collectPromptCopy'
import { blobToPngBase64, firstImageFile } from '../lib/imageToPng'
import {
  addQuote,
  addScreenshot,
  answeredCount,
  applyVerdict,
  firstUnansweredId,
  markUnansweredWorks,
  removeQuote,
  removeScreenshot,
  setComment,
  setFlagComment,
  setQuoteComment,
  toggleFlag
} from '../lib/runnerState'
import { cancelPendingReportSave, isActivatableTarget, selectRunnerSurface } from '../lib/lightRun'
import { EMPTY_TICKS, isTicked, nextUntickled, seedRecency, tickOff, tickOn } from '../lib/ticks'
import type { TickKind, TickRef } from '../lib/ticks'
import { SpineRail } from '../components/SpineRail'
import { VerdictRow } from '../components/VerdictRow'
import { QuoteBlocks } from '../components/QuoteBlocks'
import { ShotStrip } from '../components/ShotStrip'
import { MarkupView, ZoomMarkUpBar } from '../components/MarkupView'
import { MarkedPictures } from '../components/MarkedPictures'
import { screenshotSession } from '../lib/markupSession'
import type { MarkupSession } from '../lib/markupSession'
import { markupsFor, setShotMarkup } from '../lib/markup'
import { FinishConfirm } from '../components/FinishConfirm'
import { AgentStatus } from '../components/AgentStatus'
import { FinishedCollectionStatus } from '../components/FinishedCollectionStatus'
import { Reading } from './Reading'
import { LightRun } from './LightRun'
import type {
  PictureMarkup,
  QaReport,
  QaRequest,
  ReportItem,
  Verdict
} from '../../../main/qa/types'
import { readingTextSizeClass, type ReportTicks } from '../../../shared/ipc'
import { useCommandScope } from '../commands/provider'
import { requestKey } from '../lib/inbox'
import {
  recoveryFailureMessage,
  reportDisplayError,
  validateReportMutationResult,
  validateSaveReportResult,
  type ReportDisplayError
} from '../lib/reportErrors'

interface Zoom {
  url: string
  name: string
  shot?: ZoomShot // set when the picture is one of the check's screenshots (Mark up)
}
interface ZoomShot {
  rel: string
  itemId: string
}
interface QuoteHint {
  itemId: string
  raw: string
  before: string
  after: string
  left: number
  top: number
}

function basename(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/** The Runner: work through one request card by card, autosaving the report. */
export function Runner({
  path,
  detailed = false
}: {
  path: string
  detailed?: boolean
}): React.JSX.Element {
  const {
    back,
    navigate,
    openProject,
    showToast,
    snapshot,
    scope,
    settings,
    runnerMode,
    setRunnerMode,
    helpOpen,
    switcherOpen
  } = useApp()

  // A note authored from this run lands in the run's own folder, pre-linked back
  // to the request.
  const runDir = path.slice(0, path.lastIndexOf('/'))
  const requestFileName = path.split('/').pop() ?? path
  const openObservations = useCallback(() => {
    navigate({ kind: 'note', newIn: runDir, linkedRun: requestFileName, fromRun: path })
  }, [navigate, runDir, requestFileName, path])

  const [request, setRequest] = useState<QaRequest | null>(null)
  const [report, setReport] = useState<QaReport | null>(null)
  const [idx, setIdx] = useState(0)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<ReportDisplayError | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const [markupSession, setMarkupSession] = useState<MarkupSession | null>(null)
  const [justFinished, setJustFinished] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [quoteHint, setQuoteHint] = useState<QuoteHint | null>(null)
  const [wide, setWide] = useState(false)
  const [corruptReport, setCorruptReport] = useState<{ path: string; message: string } | null>(null)

  const reportRef = useRef<QaReport | null>(null)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const terminalWriteRef = useRef(false)
  const idxRef = useRef(0)
  // Ticks: personal progress, app-local via IPC — the
  // report never carries them. Recency backs ⇧Space; the ref pair mirrors the
  // report's ref+state discipline so the keyboard handler reads fresh state.
  const [ticks, setTicks] = useState<ReportTicks>({})
  const ticksRef = useRef<ReportTicks>({})
  const recencyRef = useRef<Record<string, TickRef[]>>({})
  const [rev, setRev] = useState(0)
  // Callback ref, not useRef: the wrap div only exists after openRun resolves,
  // so a mount-time effect would observe null and `wide` would never fire.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null)

  const readOnly = !!report?.completedAt
  const stateKey = requestKey(snapshot?.root ?? '', path)
  const controlsDisabled = readOnly || finishing
  // A doc-review delegates to the Reading surface: every test-run effect
  // below stays inert for it, and the render hands over wholesale.
  const runnerSurface = request ? selectRunnerSurface(request, detailed) : null
  const isReview = runnerSurface === 'review'
  const isLight = runnerSurface === 'light'

  // Leaving the run hands back to the record's own project home, never to the
  // dashboard of everything (lib/recordExit.ts for the three-way resolution).
  const exitView = recordExit(path, snapshot, scope)
  const leave = (exit: RecordExit): void => followRecordExit(exit, { openProject, navigate })
  // The auto-return reads the exit through a ref at fire time: a snapshot push
  // during the 1600 ms hold must not restart the clock.
  const exitRef = useRef<RecordExit>(exitView)
  useEffect(() => {
    exitRef.current = exitView
  })

  // Open the run — never writes on open. Runner is keyed
  // by path in App, so this mounts fresh per run and runs once.
  useEffect(() => {
    let cancelled = false
    // Ticks load alongside the run; a ticks failure must never block opening
    // (progress marks are the least important thing on the card).
    const ticksLoad = window.qa.getTicks(stateKey).catch((): ReportTicks => ({}))
    Promise.all([window.qa.openRun(path), ticksLoad])
      .then(([opened, storedTicks]) => {
        if (cancelled) return
        const { request: req, report: rep } = opened
        setRequest(req)
        setReport(rep)
        setCorruptReport(opened.corruptReport ?? null)
        reportRef.current = rep
        ticksRef.current = storedTicks
        setTicks(storedTicks)
        recencyRef.current = Object.fromEntries(
          Object.entries(storedTicks).map(([id, t]) => [id, seedRecency(t)])
        )
        const firstId = firstUnansweredId(rep)
        const startIdx = firstId ? rep.items.findIndex((i) => i.id === firstId) : 0
        const resolved = startIdx >= 0 ? startIdx : 0
        setIdx(resolved)
        idxRef.current = resolved
      })
      .catch(() => {
        if (!cancelled) showToast('Could not open this run')
      })
    return () => {
      cancelled = true
    }
  }, [path, showToast, stateKey])

  // Width drives the expanded rail (labels appear only when wide).
  useEffect(() => {
    if (!wrapEl) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWide(entry.contentRect.width >= 640)
    })
    ro.observe(wrapEl)
    return () => ro.disconnect()
  }, [wrapEl])

  const doSave = useCallback(
    async (snapshot: QaReport) => {
      try {
        const result = await window.qa.saveReport(path, snapshot)
        const validated = validateSaveReportResult(result)
        if (validated.error) {
          setSaveError(validated.error)
          return
        }
        setSavedAt(validated.savedAt)
        setSaveError(null)
      } catch (error) {
        setSaveError(reportDisplayError(error))
      }
    },
    [path]
  )

  const recoverCorrupt = useCallback(
    async (preserve?: QaReport): Promise<void> => {
      try {
        const opened = preserve
          ? await window.qa.setAsideCorruptReport(path, preserve)
          : await window.qa.setAsideCorruptReport(path)
        setRequest(opened.request)
        setReport(opened.report)
        reportRef.current = opened.report
        dirtyRef.current = false
        setSaveError(null)
        setCorruptReport(null)
        showToast('The old report was set aside. Your report is ready.')
      } catch (error) {
        const failure = reportDisplayError(error)
        setSaveError(failure)
        showToast(recoveryFailureMessage(failure))
      }
    },
    [path, showToast]
  )

  // Debounced autosave: every mutation bumps `rev`; only the last timer survives.
  useEffect(() => {
    if (rev === 0 || terminalWriteRef.current) return
    dirtyRef.current = true
    const snapshot = reportRef.current
    if (!snapshot) return
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      dirtyRef.current = false
      void doSave(snapshot)
    }, 400)
    return () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [rev, doSave])

  // Flush at the switch boundary: unmounting cancels the pending debounce timer,
  // so a mutation made within the last 400 ms would silently never reach disk.
  // Fire-and-forget the latest state on the way out.
  useEffect(() => {
    return () => {
      if (dirtyRef.current && reportRef.current) {
        dirtyRef.current = false
        void doSave(reportRef.current)
      }
    }
  }, [doSave])

  // The single mutation channel — every report change flows through runnerState.
  const mutate = useCallback((producer: (r: QaReport) => QaReport) => {
    const prev = reportRef.current
    if (!prev || prev.completedAt || terminalWriteRef.current) return
    const next = producer(prev)
    if (next === prev) return
    reportRef.current = next
    setReport(next)
    setRev((r) => r + 1)
  }, [])

  // The single tick mutation channel — updates ref+state, persists via IPC
  // (fire-and-forget: a lost tick write is a lost pencil mark, not lost data).
  const toggleTickAt = useCallback(
    (itemId: string, kind: TickKind, index: number) => {
      if (reportRef.current?.completedAt) return
      const cur = ticksRef.current[itemId] ?? EMPTY_TICKS
      const wasOn = isTicked(cur, kind, index)
      const nextItem = wasOn ? tickOff(cur, kind, index) : tickOn(cur, kind, index)
      const next = { ...ticksRef.current }
      if (nextItem.steps.length === 0 && nextItem.expected.length === 0) delete next[itemId]
      else next[itemId] = nextItem
      ticksRef.current = next
      setTicks(next)
      const rec = (recencyRef.current[itemId] ?? []).filter(
        (r) => !(r.kind === kind && r.index === index)
      )
      if (!wasOn) rec.push({ kind, index })
      recencyRef.current[itemId] = rec
      window.qa.setItemTicks(stateKey, itemId, nextItem).catch(() => {})
    },
    [stateKey]
  )

  const focusComment = useCallback((itemId: string) => {
    setTimeout(() => {
      const box = document.querySelector<HTMLTextAreaElement>(`[data-comment="${itemId}"]`)
      if (box) {
        box.focus()
        box.selectionStart = box.selectionEnd = box.value.length
      }
    }, 0)
  }, [])

  const focusFlagComment = useCallback((itemId: string, expectedIndex: number) => {
    setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>(`[data-flag-comment="${itemId}:${expectedIndex}"]`)
        ?.focus()
    }, 0)
  }, [])

  const applyVerdictTo = useCallback(
    (itemId: string, v: Verdict) => {
      mutate((r) => applyVerdict(r, itemId, v))
      // Partial pass and Fail hand focus onward — but only when the verdict is
      // turned on, not when the same key toggles it off. With flaggable bullets
      // present, focus stays global so 1–9 can flag immediately (the flag's own
      // comment input takes focus when a flag is added); the general comment is
      // focused only when there is nothing to flag.
      if (v === 'partial' || v === 'fail') {
        const cur = reportRef.current?.items.find((i) => i.id === itemId)
        const reqItem = request?.items.find((ri) => ri.id === itemId)
        if (cur && cur.status === v && !(reqItem && reqItem.expected.length > 0)) {
          focusComment(itemId)
        }
      }
    },
    [mutate, focusComment, request]
  )

  const move = useCallback(
    (delta: number) => {
      const rep = reportRef.current
      if (!rep) return
      const next = Math.min(Math.max(idxRef.current + delta, 0), rep.items.length - 1)
      idxRef.current = next
      setIdx(next)
      if (runnerMode === 'list') {
        setTimeout(() => {
          document
            .querySelector(`[data-card="${next}"]`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }, 0)
      }
    },
    [runnerMode]
  )

  const jumpTo = useCallback(
    (i: number) => {
      idxRef.current = i
      setIdx(i)
      if (runnerMode === 'list') {
        setTimeout(() => {
          document.querySelector(`[data-card="${i}"]`)?.scrollIntoView({ block: 'start' })
        }, 0)
      }
    },
    [runnerMode]
  )

  // ---- finish / reopen lifecycle ------------------------------------------
  const doFinish = useCallback(async () => {
    if (terminalWriteRef.current) return
    setConfirmOpen(false)
    const snapshot = reportRef.current
    if (!snapshot) return
    terminalWriteRef.current = true
    setFinishing(true)
    cancelPendingReportSave(saveTimerRef, dirtyRef)
    try {
      const result = await window.qa.finishRun(path, snapshot)
      const validated = validateReportMutationResult(result)
      if (!validated.report) {
        terminalWriteRef.current = false
        dirtyRef.current = true
        setFinishing(false)
        setSaveError(validated.error)
        return
      }
      const stamped = validated.report
      reportRef.current = stamped
      setReport(stamped)
      setJustFinished(true)
      setFinishing(false)
      // The report is on disk, so the prompt is a courtesy on top of it: the
      // helper catches its own failures and the finish stands either way.
      if (request) await copyCollectPromptAfterFinish(path, request.title, showToast)
    } catch (error) {
      terminalWriteRef.current = false
      dirtyRef.current = true
      setFinishing(false)
      setSaveError(reportDisplayError(error))
    }
  }, [path, request, showToast])

  const requestFinish = useCallback(() => {
    const rep = reportRef.current
    if (!rep || rep.completedAt) return
    const checkIds = new Set(request?.items.map((item) => item.id) ?? [])
    const progressReport = {
      ...rep,
      items: rep.items.filter((item) => checkIds.has(item.id))
    }
    const total = request?.items.length ?? 0
    const unanswered = total - answeredCount(progressReport)
    if (unanswered > 0) setConfirmOpen(true)
    else void doFinish()
  }, [doFinish, request])

  const doReopen = useCallback(async () => {
    terminalWriteRef.current = true
    cancelPendingReportSave(saveTimerRef, dirtyRef)
    try {
      const result = await window.qa.reopenRun(path)
      const validated = validateReportMutationResult(result)
      if (!validated.report) {
        terminalWriteRef.current = false
        setSaveError(validated.error)
        return
      }
      const cleared = validated.report
      reportRef.current = cleared
      setReport(cleared)
      setJustFinished(false)
      terminalWriteRef.current = false
      // Main clears the stored ticks on reopen (a fresh walk) —
      // mirror it locally so the circles empty without a re-fetch.
      ticksRef.current = {}
      setTicks({})
      recencyRef.current = {}
    } catch (error) {
      terminalWriteRef.current = false
      setSaveError(reportDisplayError(error))
    }
  }, [path])

  // After finishing, hold the filled state briefly, then return to the run's
  // project home (or the dashboard only when no project is knowable).
  useEffect(() => {
    if (!justFinished) return
    const timer = setTimeout(
      () => followRecordExit(exitRef.current, { openProject, navigate }),
      1600
    )
    return () => clearTimeout(timer)
  }, [justFinished, navigate, openProject])

  // ---- screenshots ---------------------------------------------------------
  const ingestImage = useCallback(
    async (itemId: string, file: File | null) => {
      if (!file) return
      const base64 = await blobToPngBase64(file)
      if (!base64) {
        showToast('That image could not be read')
        return
      }
      try {
        const rel = await window.qa.addShot(path, itemId, base64)
        mutate((r) => addScreenshot(r, itemId, rel))
      } catch {
        showToast('That image could not be read')
      }
    },
    [path, mutate, showToast]
  )

  // Mark up one of a check's screenshots; the copy is stored beside it.
  const openShotMarkup = (shot: ZoomShot): void => {
    const current = reportRef.current
    const item = current?.items.find((it) => it.id === shot.itemId)
    if (!item || !request) return
    setZoom(null)
    setMarkupSession(
      screenshotSession({
        requestPath: path,
        itemId: shot.itemId,
        rel: shot.rel,
        title: item.title,
        existing: item.markups?.find((m) => m.picture === shot.rel),
        onSaved: (markup) =>
          mutate((r) => setShotMarkup(r, { kind: 'item', id: shot.itemId }, shot.rel, markup))
      })
    )
  }

  // Paste anywhere in the run attaches to the current item (⌘V).
  useEffect(() => {
    if (readOnly || isReview || isLight) return
    function onPaste(e: ClipboardEvent): void {
      if (document.querySelector('.mkwin')) return
      const file = firstImageFile(e.clipboardData?.items ?? null)
      if (!file) return
      e.preventDefault()
      const rep = reportRef.current
      const item = rep?.items[idxRef.current]
      if (item) void ingestImage(item.id, file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [readOnly, isReview, isLight, ingestImage])

  // ---- selection → quote affordance ---------------------------------------
  const computeSelection = useCallback((): QuoteHint | null => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    const anc = range.commonAncestorContainer
    const el = anc.nodeType === 1 ? (anc as Element) : anc.parentElement
    const quotable = el?.closest<HTMLElement>('.quotable')
    if (!quotable) return null
    const itemId = quotable.dataset.item
    if (!itemId) return null
    const raw = sel.toString()
    if (!raw.trim()) return null
    const sc = range.startContainer
    const ec = range.endContainer
    const before = sc.nodeType === 3 ? (sc.textContent ?? '').slice(0, range.startOffset) : ''
    const after = ec.nodeType === 3 ? (ec.textContent ?? '').slice(range.endOffset) : ''
    const rect = range.getBoundingClientRect()
    return { itemId, raw, before, after, left: rect.left + rect.width / 2, top: rect.top }
  }, [])

  const addFromSelection = useCallback(
    (hint: QuoteHint | null) => {
      if (!hint) return
      mutate((r) => addQuote(r, hint.itemId, hint.raw, { before: hint.before, after: hint.after }))
      window.getSelection()?.removeAllRanges()
      setQuoteHint(null)
    },
    [mutate]
  )

  useEffect(() => {
    // No selection affordance for a finished run; a stale hint is never rendered
    // (the FAB is gated on !readOnly), so nothing to clear here.
    if (readOnly || isReview || isLight) return
    function onMouseUp(e: MouseEvent): void {
      if (e.target instanceof Element && e.target.closest('.quotefab')) return
      setTimeout(() => setQuoteHint(computeSelection()), 10)
    }
    function onSelectionChange(): void {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) setQuoteHint(null)
    }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [readOnly, isReview, isLight, computeSelection])

  const currentCommandItem = report?.items[idx]
  const runCommandsEnabled =
    !!request &&
    !corruptReport &&
    !request.degraded &&
    !isReview &&
    !isLight &&
    !confirmOpen &&
    !zoom &&
    !markupSession &&
    !helpOpen &&
    !switcherOpen
  const editableCommandsEnabled =
    !corruptReport &&
    runCommandsEnabled &&
    !!currentCommandItem &&
    !report?.completedAt &&
    !finishing
  useCommandScope({
    'run.finish-confirm': { enabled: confirmOpen, priority: 90, handler: () => void doFinish() },
    'app.close-back': {
      enabled: confirmOpen || !!zoom || listOpen,
      priority: 90,
      handler: () => {
        if (confirmOpen) setConfirmOpen(false)
        else if (zoom) setZoom(null)
        else setListOpen(false)
      }
    },
    'markup.open': {
      enabled: !!zoom?.shot && !controlsDisabled && !markupSession,
      priority: 90,
      handler: () => zoom?.shot && openShotMarkup(zoom.shot)
    },
    'run.finish': {
      enabled: runCommandsEnabled && !!report?.items.length,
      handler: requestFinish
    },
    'run.reopen': {
      enabled: runCommandsEnabled && !!report?.completedAt,
      handler: () => void doReopen()
    },
    'run.open-other-surface': {
      enabled: runCommandsEnabled && request?.mode === 'light',
      handler: () => navigate({ kind: 'runner', path, detailed: false })
    },
    'light.everything-works': {
      enabled: editableCommandsEnabled,
      handler: () => {
        mutate((current) => markUnansweredWorks(current, new Set()))
        void doFinish()
      }
    },
    'light.add-observation': {
      enabled: editableCommandsEnabled,
      handler: openObservations
    },
    'run.item-list': { enabled: runCommandsEnabled, handler: () => setListOpen((value) => !value) },
    'run.next-item': { enabled: editableCommandsEnabled, handler: () => move(1) },
    'run.previous-item': { enabled: editableCommandsEnabled, handler: () => move(-1) },
    'verdict.pass': {
      enabled: editableCommandsEnabled,
      handler: () => currentCommandItem && applyVerdictTo(currentCommandItem.id, 'pass')
    },
    'verdict.partial': {
      enabled: editableCommandsEnabled,
      handler: () => currentCommandItem && applyVerdictTo(currentCommandItem.id, 'partial')
    },
    'verdict.fail': {
      enabled: editableCommandsEnabled,
      handler: () => currentCommandItem && applyVerdictTo(currentCommandItem.id, 'fail')
    },
    'verdict.skip': {
      enabled: editableCommandsEnabled,
      handler: () => currentCommandItem && applyVerdictTo(currentCommandItem.id, 'skip')
    },
    'run.flag-expected': {
      enabled: editableCommandsEnabled && !!request,
      handler: (event) => {
        if (!event || !request || !currentCommandItem || currentCommandItem.removed) return
        const bulletIndex = Number(event.key) - 1
        const reqItem = request.items.find((item) => item.id === currentCommandItem.id)
        if (!reqItem || bulletIndex >= reqItem.expected.length) return
        const wasFlagged = currentCommandItem.flagged.some(
          (flag) => flag.expectedIndex === bulletIndex
        )
        mutate((current) => toggleFlag(current, request, currentCommandItem.id, bulletIndex))
        if (!wasFlagged) focusFlagComment(currentCommandItem.id, bulletIndex)
      }
    },
    'run.tick-next': {
      enabled: editableCommandsEnabled && !!request,
      preventDefault: false,
      handler: (event) => {
        if (isActivatableTarget(event?.target ?? null) || !request || !currentCommandItem) return
        event?.preventDefault()
        const reqItem = request.items.find((item) => item.id === currentCommandItem.id)
        if (!reqItem || currentCommandItem.removed) return
        const next = nextUntickled(
          ticksRef.current[currentCommandItem.id] ?? EMPTY_TICKS,
          reqItem.steps.length,
          reqItem.expected.length
        )
        if (next) toggleTickAt(currentCommandItem.id, next.kind, next.index)
      }
    },
    'run.untick-last': {
      enabled: editableCommandsEnabled,
      handler: () => {
        if (!currentCommandItem) return
        const recency = recencyRef.current[currentCommandItem.id] ?? []
        const last = recency[recency.length - 1]
        if (last) toggleTickAt(currentCommandItem.id, last.kind, last.index)
      }
    },
    'run.comment': {
      enabled: editableCommandsEnabled,
      handler: () => currentCommandItem && focusComment(currentCommandItem.id)
    },
    'run.other-observations': { enabled: editableCommandsEnabled, handler: openObservations },
    'run.retry-save': {
      enabled: runCommandsEnabled && !!saveError && !!report,
      handler: () => report && void doSave(reportRef.current ?? report)
    },
    'run.paste-screenshot': {
      enabled: editableCommandsEnabled,
      preventDefault: false,
      handler: () => showToast('Paste a screenshot with ⌘V')
    },
    'run.quote': {
      enabled: editableCommandsEnabled,
      handler: () => addFromSelection(computeSelection())
    }
  })

  if (!request || !report) {
    return (
      <div className="view">
        <div className="vhead">
          <span className="vt">Opening run…</span>
          <span className="grow" />
        </div>
      </div>
    )
  }

  if (corruptReport) {
    return (
      <div className="view">
        <div className="vhead">
          <button className="backbtn" aria-label="Back" onClick={back}>
            <ArrowLeft className="ic" strokeWidth={2} />
          </button>
          <span className="vt">Report needs attention</span>
          <span className="grow" />
        </div>
        <div className="empty" role="alert">
          <h2>This run’s report cannot be opened</h2>
          <p>
            Dev Traffic Control found a damaged or conflicted report file. The request itself is
            safe. {corruptReport.message}
          </p>
          <p className="mono">{corruptReport.path}</p>
          <button className="secbtn" onClick={() => void window.qa.revealPath(corruptReport.path)}>
            Reveal in Finder
          </button>
          <button className="pri" onClick={() => void recoverCorrupt()}>
            Set aside and start fresh
          </button>
        </div>
      </div>
    )
  }

  // Document review → the Reading surface. The report was
  // opened through the same seam; Reading owns its state from here on.
  if (isReview && request.document) {
    return <Reading path={path} request={request} initialReport={report} />
  }

  // A light request hands over wholesale to the single-screen Light surface.
  // The route's detailed override is the lossless escape hatch back to Runner.
  if (isLight) {
    return <LightRun path={path} request={request} initialReport={report} />
  }

  // Degraded request (unparseable frontmatter or no items): render the raw
  // markdown as plain readable text — never an error. No cards, no
  // verdicts; the header carries an `unparsed` chip and the filename.
  if (request.degraded) {
    return (
      <div className="view">
        <div className="vhead">
          <button className="backbtn" aria-label="Back to inbox" onClick={() => leave(exitView)}>
            <ArrowLeft className="ic" strokeWidth={2} />
          </button>
          <div className="grow">
            <div className="vt rt">{request.title}</div>
            <div className="sub mono">{basename(path)}</div>
          </div>
          <span className="chip warn">unparsed</span>
        </div>
        <div className="scroll">
          <div className="plainraw">
            {request.raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')}
          </div>
        </div>
      </div>
    )
  }

  if (report.items.length === 0) {
    return (
      <div className="view">
        <div className="vhead">
          <button className="backbtn" aria-label="Back to inbox" onClick={() => back()}>
            <ArrowLeft className="ic" strokeWidth={2} />
          </button>
          <div className="grow">
            <div className="vt rt">{request.title}</div>
            <div className="lr-run-empty-chips">
              {request.app && <span className="chip mono">{request.app}</span>}
              {request.version && <span className="chip mono">{request.version}</span>}
              {request.labels.kind && <span className="chip">{request.labels.kind}</span>}
            </div>
          </div>
        </div>
        <div className="empty">
          <h2>Nothing to walk</h2>
          <p>There is nothing to walk here. This request contains only optional checks.</p>
          <button
            className="secbtn"
            aria-label="Light view"
            onClick={() => navigate({ kind: 'runner', path })}
          >
            Light view
          </button>
        </div>
      </div>
    )
  }

  const checkIds = new Set(request.items.map((item) => item.id))
  const progressReport = {
    ...report,
    items: report.items.filter((item) => checkIds.has(item.id))
  }
  const answered = answeredCount(progressReport)
  const total = request.items.length
  const checkIndexById = new Map(request.items.map((item, index) => [item.id, index]))
  const parkedIds = new Set(request.parked.map((item) => item.id))
  const activeItem = report.items[idx]
  const activeCheckIndex = activeItem ? checkIndexById.get(activeItem.id) : undefined
  const activeExtraLabel = activeItem?.removed
    ? 'Removed item'
    : parkedIds.has(activeItem?.id ?? '')
      ? 'Optional check'
      : 'Additional item'
  const finishedClock = formatClock(report.completedAt ?? null)
  // Notes cross-linked from this run's report; title resolved live.
  const linkedNotes = report.noteFiles.map((rel) => {
    const abs = `${runDir}/${rel}`
    const note = snapshot?.notes.find((n) => n.path === abs)
    return { path: abs, title: note?.title ?? rel.replace(/\.md$/, '') }
  })
  const cardHandlers = {
    request,
    readOnly: controlsDisabled,
    ticks,
    onToggleTick: toggleTickAt,
    onVerdict: applyVerdictTo,
    onToggleFlag: (itemId: string, bulletIndex: number) => {
      const wasFlagged = report.items
        .find((i) => i.id === itemId)
        ?.flagged.some((f) => f.expectedIndex === bulletIndex)
      mutate((r) => toggleFlag(r, request, itemId, bulletIndex))
      if (!wasFlagged) focusFlagComment(itemId, bulletIndex)
    },
    onFlagComment: (itemId: string, bulletIndex: number, text: string) =>
      mutate((r) => setFlagComment(r, itemId, bulletIndex, text)),
    onUnquote: (itemId: string, qi: number) => mutate((r) => removeQuote(r, itemId, qi)),
    onQuoteComment: (itemId: string, qi: number, text: string) =>
      mutate((r) => setQuoteComment(r, itemId, qi, text)),
    onComment: (itemId: string, text: string) => mutate((r) => setComment(r, itemId, text)),
    onZoom: (url: string, name: string, shot?: ZoomShot) => setZoom({ url, name, shot }),
    onEditMarks: (itemId: string, markup: PictureMarkup) =>
      openShotMarkup({ rel: markup.picture, itemId }),
    onRemoveShot: (itemId: string, rel: string) => mutate((r) => removeScreenshot(r, itemId, rel)),
    onDropImage: ingestImage,
    onPasteHint: () => showToast('Paste with ⌘V, or drag a screenshot onto the card'),
    onObservations: openObservations,
    linkedNotes,
    onOpenNote: (notePath: string) => navigate({ kind: 'note', path: notePath }),
    onFocusItem: jumpTo,
    onOpenList: () => setListOpen(true)
  }

  const banner = saveError && (
    <div className="banner" role="alert">
      <TriangleAlert className="ic" strokeWidth={2} />
      <span className="grow">
        {saveError.kind === 'invalid-on-disk'
          ? saveError.message
          : (saveError.message ?? `Could not save to ${basename(path)}.report.json`)}
      </span>
      {saveError.kind === 'invalid-on-disk' ? (
        <>
          <button className="retry" onClick={() => void window.qa.revealPath(saveError.path)}>
            Reveal in Finder
          </button>
          <button
            className="retry"
            onClick={() => void recoverCorrupt(reportRef.current ?? report)}
          >
            Set aside and start fresh
          </button>
        </>
      ) : (
        <button className="retry" onClick={() => void doSave(reportRef.current ?? report)}>
          <RotateCw className="ic s" strokeWidth={2} />
          Retry
        </button>
      )}
    </div>
  )

  return (
    <div className="view">
      <div className="vhead">
        <button className="backbtn" aria-label="Back to inbox" onClick={() => leave(exitView)}>
          <ArrowLeft className="ic" strokeWidth={2} />
        </button>
        <div className="grow">
          <div className="vt rt">{request.title}</div>
          <div className="sub mono">{basename(path)}</div>
          <div className="run-signal">
            {readOnly ? (
              <FinishedCollectionStatus
                requestPath={path}
                title={request.title}
                completedAt={report.completedAt ?? ''}
                onError={() => showToast('Could not copy the collect prompt')}
              />
            ) : (
              <AgentStatus requestPath={path} />
            )}
          </div>
        </div>
        {request.mode === 'light' && detailed && (
          <button className="ghostbtn" onClick={() => navigate({ kind: 'runner', path })}>
            Light view
          </button>
        )}
        <button
          className={`iconbtn${runnerMode === 'list' ? ' on' : ''}`}
          aria-pressed={runnerMode === 'list'}
          aria-label={runnerMode === 'list' ? 'Focus mode' : 'List mode'}
          title={runnerMode === 'list' ? 'Switch to focus mode' : 'Switch to list mode'}
          onClick={() => setRunnerMode(runnerMode === 'list' ? 'focus' : 'list')}
        >
          {runnerMode === 'list' ? (
            <Square className="ic" strokeWidth={2} />
          ) : (
            <Rows3 className="ic" strokeWidth={2} />
          )}
        </button>
        {readOnly ? (
          <>
            <span className="done-pill">
              <BadgeCheck className="ic s" strokeWidth={2} />
              Finished {finishedClock}
            </span>
            <button className="ghostbtn" onClick={() => void doReopen()}>
              <RotateCw className="ic s" strokeWidth={2} />
              Reopen
            </button>
          </>
        ) : (
          <button className="outbtn" disabled={finishing} onClick={requestFinish}>
            <Flag className="ic s" strokeWidth={2} />
            Finish run
          </button>
        )}
      </div>
      {banner}
      <div
        className={`runwrap ${readingTextSizeClass(settings?.readingTextSize)}${wide ? ' wide' : ''}`}
        ref={setWrapEl}
      >
        <div className="runbody">
          <SpineRail
            items={report.items}
            current={idx}
            finished={readOnly}
            finishedLabel={readOnly ? 'Finished' : 'Finish run'}
            onJump={jumpTo}
            onFinish={requestFinish}
            disabled={finishing}
          />
          <div className="cardwrap" data-find-scope>
            {readOnly && justFinished ? (
              <DoneCard
                report={report}
                finishedClock={finishedClock}
                onBack={() => leave(exitView)}
                onNote={openObservations}
              />
            ) : runnerMode === 'list' ? (
              <div className="scroll">
                {report.items.map((item, i) => (
                  <RunnerCard
                    key={item.id}
                    item={item}
                    index={i}
                    checkIndex={checkIndexById.get(item.id)}
                    extraLabel={
                      item.removed
                        ? 'Removed item'
                        : parkedIds.has(item.id)
                          ? 'Optional check'
                          : 'Additional item'
                    }
                    total={total}
                    requestPath={path}
                    {...cardHandlers}
                  />
                ))}
              </div>
            ) : (
              <>
                <div className="scroll">
                  <RunnerCard
                    item={report.items[idx]}
                    index={idx}
                    checkIndex={checkIndexById.get(report.items[idx].id)}
                    extraLabel={activeExtraLabel}
                    total={total}
                    requestPath={path}
                    {...cardHandlers}
                  />
                </div>
                <div className="runfoot">
                  <button className="navbtn" disabled={idx === 0} onClick={() => move(-1)}>
                    <ArrowLeft className="ic s" strokeWidth={2} />
                    Previous
                  </button>
                  <span className="mid">
                    {activeCheckIndex === undefined
                      ? `${activeExtraLabel} · ${answered} / ${total} answered`
                      : `${activeCheckIndex + 1} / ${total} · ${answered} answered`}{' '}
                    · saved {savedAt ? formatClock(savedAt) : '—'}
                  </span>
                  <button
                    className="navbtn"
                    disabled={idx === report.items.length - 1}
                    onClick={() => move(1)}
                  >
                    Next
                    <ArrowLeft
                      className="ic s"
                      strokeWidth={2}
                      style={{ transform: 'scaleX(-1)' }}
                    />
                  </button>
                </div>
              </>
            )}
            {runnerMode === 'list' && !(readOnly && justFinished) && (
              <div className="runfoot">
                <span className="mid">
                  {answered} / {total} answered · saved {savedAt ? formatClock(savedAt) : '—'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmOpen && (
        <FinishConfirm
          unanswered={total - answered}
          total={total}
          onConfirm={() => void doFinish()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
      {listOpen && (
        <div
          className="overlay top"
          role="dialog"
          aria-modal="true"
          aria-label="Item list"
          onClick={() => setListOpen(false)}
        >
          <div className="itemlist" onClick={(e) => e.stopPropagation()}>
            <div className="il-head">
              <span className="il-title">{request.title}</span>
              <span className="il-count mono">
                {answered} / {total}
              </span>
            </div>
            {report.items.map((it, i) => (
              <button
                key={it.id}
                className={`il-row${i === idx ? ' cur' : ''}`}
                onClick={() => {
                  jumpTo(i)
                  setListOpen(false)
                }}
              >
                <span className={`il-dot v-${it.status}`} />
                <span className="il-name">{it.title}</span>
                {it.removed ? (
                  <span className="il-gone">removed</span>
                ) : parkedIds.has(it.id) ? (
                  <span className="il-gone">optional</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
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
          {zoom.shot && !controlsDisabled && (
            <ZoomMarkUpBar
              marked={
                !!report.items
                  .find((it) => it.id === zoom.shot?.itemId)
                  ?.markups?.some((m) => m.picture === zoom.shot?.rel)
              }
              onMarkUp={() => zoom.shot && openShotMarkup(zoom.shot)}
            />
          )}
        </div>
      )}
      {markupSession && (
        <MarkupView session={markupSession} onClose={() => setMarkupSession(null)} />
      )}
      {quoteHint && !readOnly && (
        <button
          className="quotefab"
          aria-label="Quote the selected text"
          style={{
            left: Math.max(8, Math.min(quoteHint.left - 40, window.innerWidth - 96)),
            top: Math.max(8, quoteHint.top - 40)
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => addFromSelection(quoteHint)}
        >
          <QuoteIcon className="ic" strokeWidth={2} />
          Quote
          <kbd>Q</kbd>
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface CardHandlers {
  request: QaRequest
  readOnly: boolean
  ticks: ReportTicks
  onToggleTick: (itemId: string, kind: TickKind, index: number) => void
  onVerdict: (itemId: string, v: Verdict) => void
  onToggleFlag: (itemId: string, bulletIndex: number) => void
  onFlagComment: (itemId: string, bulletIndex: number, text: string) => void
  onUnquote: (itemId: string, qi: number) => void
  onQuoteComment: (itemId: string, qi: number, text: string) => void
  onComment: (itemId: string, text: string) => void
  onZoom: (url: string, name: string, shot?: ZoomShot) => void
  onEditMarks: (itemId: string, markup: PictureMarkup) => void
  onRemoveShot: (itemId: string, rel: string) => void
  onDropImage: (itemId: string, file: File | null) => void
  onPasteHint: () => void
  onObservations: () => void
  linkedNotes: { path: string; title: string }[]
  onOpenNote: (notePath: string) => void
  onFocusItem: (index: number) => void
  onOpenList: () => void
}

function RunnerCard({
  item,
  index,
  checkIndex,
  extraLabel,
  total,
  requestPath,
  request,
  readOnly,
  ticks,
  onToggleTick,
  onVerdict,
  onToggleFlag,
  onFlagComment,
  onUnquote,
  onQuoteComment,
  onComment,
  onZoom,
  onEditMarks,
  onRemoveShot,
  onDropImage,
  onPasteHint,
  onObservations,
  linkedNotes,
  onOpenNote,
  onFocusItem,
  onOpenList
}: CardHandlers & {
  item: ReportItem
  index: number
  checkIndex: number | undefined
  extraLabel: string
  total: number
  requestPath: string
}): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const reqItem = request.items.find((ri) => ri.id === item.id)
  const removed = !!item.removed
  const itemTicks = ticks[item.id] ?? EMPTY_TICKS
  // Flagging is available in ANY verdict state — the reviewer flags the failing line
  // first, then decides the verdict.
  const flaggable = !readOnly && !removed
  const mode = item.status === 'fail' ? 'mode-red' : 'mode-amber'
  const hasQuotes = (flaggable && item.flagged.length > 0) || item.quotes.length > 0

  return (
    <div
      className={`card${dragOver ? ' dragover' : ''}`}
      data-card={index}
      onMouseDown={() => onFocusItem(index)}
      onDragOver={(e) => {
        if (readOnly || removed) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false)
        if (readOnly || removed) return
        e.preventDefault()
        onDropImage(item.id, firstImageFileFromDrop(e.dataTransfer))
      }}
    >
      <button className="eyebrow aslist" onClick={onOpenList} title="Item list (L)">
        {checkIndex === undefined ? extraLabel : `Item ${checkIndex + 1} of ${total}`}
        <ChevronDown className="ic s" strokeWidth={2} />
      </button>
      <h1 className="itemtitle">{item.title}</h1>
      {reqItem?.context && <p className="context">{renderBold(reqItem.context)}</p>}
      {removed && (
        <span className="removed-chip">
          <TriangleAlert className="ic s" strokeWidth={2} />
          removed from request
        </span>
      )}

      {!removed && reqItem && (
        <div className="quotable" data-item={item.id}>
          {reqItem.steps.length > 0 && (
            <>
              <div className="lbl">Steps</div>
              <ol className="steps">
                {reqItem.steps.map((s, i) => {
                  const done = isTicked(itemTicks, 'steps', i)
                  return (
                    <li key={i} className={done ? 'ticked' : undefined}>
                      <TickDot
                        on={done}
                        disabled={readOnly}
                        label={`step ${i + 1}`}
                        onToggle={() => onToggleTick(item.id, 'steps', i)}
                      />
                      <span className="n">{i + 1}</span>
                      <span className="btxt">{renderBold(s)}</span>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
          {reqItem.expected.length > 0 && (
            <>
              <div className="lbl">Expected</div>
              <ul className="expected">
                {reqItem.expected.map((e, i) => {
                  const done = isTicked(itemTicks, 'expected', i)
                  if (!flaggable) {
                    // Read-only card: ticks display but are not editable;
                    // the tick dot doubles as the bullet mark.
                    return (
                      <li key={i} className={`exro${done ? ' ticked' : ''}`}>
                        <TickDot on={done} disabled label={`expected bullet ${i + 1}`} />
                        <span className="extxt">{renderBold(e)}</span>
                      </li>
                    )
                  }
                  const on = item.flagged.some((f) => f.expectedIndex === i)
                  return (
                    <li
                      key={i}
                      className={`exf ${mode}${on ? ' on' : ''}${done ? ' ticked' : ''}`}
                      role="button"
                      aria-pressed={on}
                      aria-label={`Flag expected bullet ${i + 1}${on ? ' — flagged' : ''}`}
                      onClick={() => {
                        // Selecting text inside the bullet must not toggle the flag.
                        if (!window.getSelection()?.isCollapsed) return
                        onToggleFlag(item.id, i)
                      }}
                    >
                      <TickDot
                        on={done}
                        label={`expected bullet ${i + 1}`}
                        onToggle={() => onToggleTick(item.id, 'expected', i)}
                      />
                      <span className="exnum">{i + 1}</span>
                      <span className="extxt">{renderBold(e)}</span>
                    </li>
                  )
                })}
              </ul>
              {flaggable && item.flagged.length === 0 && (
                <div className="flaghint">
                  Flag the line that doesn’t pass — click it or press <kbd>1</kbd>–<kbd>9</kbd>.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!removed && (
        <>
          <div className="lbl">Verdict</div>
          <VerdictRow
            status={item.status}
            disabled={readOnly}
            onVerdict={(v) => onVerdict(item.id, v)}
          />

          <div className="lbl">Comment</div>
          <QuoteBlocks
            item={item}
            flaggable={flaggable}
            readOnly={readOnly}
            onUnflag={(bi) => onToggleFlag(item.id, bi)}
            onFlagComment={(bi, text) => onFlagComment(item.id, bi, text)}
            onUnquote={(qi) => onUnquote(item.id, qi)}
            onQuoteComment={(qi, text) => onQuoteComment(item.id, qi, text)}
          />
          <textarea
            className="comment"
            data-comment={item.id}
            placeholder={hasQuotes ? 'Overall comment…' : 'Add a comment…'}
            value={item.comment}
            readOnly={readOnly}
            onChange={(e) => onComment(item.id, e.target.value)}
          />

          <div className="lbl">Screenshots</div>
          <ShotStrip
            requestPath={requestPath}
            screenshots={item.screenshots}
            readOnly={readOnly}
            onZoom={(url, name, rel) => onZoom(url, name, { rel, itemId: item.id })}
            onRemove={(rel) => onRemoveShot(item.id, rel)}
            onPasteHint={onPasteHint}
          />
          <MarkedPictures
            requestPath={requestPath}
            markups={markupsFor(item)}
            readOnly={readOnly}
            caption={(m) => m.picture.split('/').pop() ?? m.picture}
            onEdit={(m) => onEditMarks(item.id, m)}
            onZoom={(url, name) => onZoom(url, name)}
          />

          {!readOnly && (
            <button className="obsbtn" onClick={onObservations}>
              <SquarePen className="ic" strokeWidth={2} />
              Other observations
              {linkedNotes.length > 0 && <span className="obscount">{linkedNotes.length}</span>}
              <kbd>O</kbd>
            </button>
          )}
          {linkedNotes.length > 0 && (
            <div className="notechips">
              {linkedNotes.map((n) => (
                <button key={n.path} className="notechip" onClick={() => onOpenNote(n.path)}>
                  <SquarePen className="ic s" strokeWidth={2} />
                  <span className="notechip-t">{n.title}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DoneCard({
  report,
  finishedClock,
  onBack,
  onNote
}: {
  report: QaReport
  finishedClock: string
  onBack: () => void
  onNote: () => void
}): React.JSX.Element {
  const counts = verdictCounts(report.items.filter((i) => !i.removed).map((i) => i.status))
  return (
    <div className="donecard">
      <BadgeCheck className="big" strokeWidth={2} />
      <h2>Run finished</h2>
      <div className="sum">
        <span className="p">{counts.pass} pass</span>
        {counts.partial > 0 && (
          <>
            {' · '}
            <span className="pp">{counts.partial} partial</span>
          </>
        )}
        {counts.fail > 0 && (
          <>
            {' · '}
            <span className="f">{counts.fail} fail</span>
          </>
        )}
        {counts.skip > 0 && (
          <>
            {' · '}
            <span className="s">{counts.skip} skipped</span>
          </>
        )}
      </div>
      <div className="fine">
        Stamped complete at {finishedClock} — the agent can collect the report.
      </div>
      <div className="acts">
        <button className="primbtn" onClick={onBack}>
          <InboxIcon className="ic" strokeWidth={2} />
          Back to inbox
        </button>
        <button className="secbtn" onClick={onNote}>
          <SquarePen className="ic" strokeWidth={2} />
          Write a note
        </button>
      </div>
    </div>
  )
}

/**
 * The quiet tick affordance: empty circle → filled
 * tick, app accent — deliberately not a verdict colour, because a tick is a
 * pencil mark, never a signal. Kept out of the tab walk: Space/⇧Space is the
 * keyboard path, and forty focusable circles would bury every real control.
 */
function TickDot({
  on,
  disabled,
  label,
  onToggle
}: {
  on: boolean
  disabled?: boolean
  label: string
  onToggle?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`tick${on ? ' on' : ''}`}
      aria-pressed={on}
      aria-label={`Tick ${label}${on ? ' — done' : ''}`}
      disabled={disabled}
      tabIndex={-1}
      onClick={(e) => {
        // Never let the tick reach the bullet's flag toggle, and never tick on
        // the click that ends a text selection (the flag guard's law).
        e.stopPropagation()
        if (!window.getSelection()?.isCollapsed) return
        onToggle?.()
      }}
    >
      {on && <Check className="ic" strokeWidth={3} />}
    </button>
  )
}

/** Drop-transfer variant of {@link firstImageFile}. */
function firstImageFileFromDrop(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const file of Array.from(dt.files)) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}
