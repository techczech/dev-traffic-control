import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BadgeCheck, Check, RotateCw, TriangleAlert } from 'lucide-react'
import { FinishConfirm } from '../components/FinishConfirm'
import { AgentStatus } from '../components/AgentStatus'
import { FinishedCollectionStatus } from '../components/FinishedCollectionStatus'
import { ShotStrip } from '../components/ShotStrip'
import { MarkupView, ZoomMarkUpBar } from '../components/MarkupView'
import { MarkedPictures } from '../components/MarkedPictures'
import { screenshotSession } from '../lib/markupSession'
import type { MarkupSession } from '../lib/markupSession'
import { markupsFor, setShotMarkup } from '../lib/markup'
import { formatClock } from '../lib/format'
import { growTextarea, observeTextareaGrowth } from '../lib/growTextarea'
import { blobToPngBase64, firstImageFile } from '../lib/imageToPng'
import { renderBold } from '../lib/richtext'
import {
  addObservation,
  addObservationScreenshot,
  addScreenshot,
  applyVerdict,
  ensureItem,
  markUnansweredWorks,
  nextObservationId,
  removeObservation,
  removeObservationScreenshot,
  removeScreenshot,
  setComment,
  setObservationText
} from '../lib/runnerState'
import {
  cancelPendingReportSave,
  isActivatableTarget,
  lightRunLayout,
  lightVerdictPresentation,
  nextMainCheckIndex,
  shouldShowLightComment,
  showParkedDot
} from '../lib/lightRun'
import { useApp } from '../state/app'
import { useCommandScope } from '../commands/provider'
import { followRecordExit, recordExit, type RecordExit } from '../lib/recordExit'
import { copyCollectPromptAfterFinish } from '../lib/collectPromptCopy'
import type {
  Observation,
  PictureMarkup,
  QaReport,
  QaRequest,
  ReportItem,
  RequestItem
} from '../../../main/qa/types'
import {
  recoveryFailureMessage,
  reportDisplayError,
  validateReportMutationResult,
  validateSaveReportResult,
  type ReportDisplayError
} from '../lib/reportErrors'
import { readingTextSizeClass } from '../../../shared/ipc'

type FocusTarget = { kind: 'check' | 'observation'; id: string }

interface Zoom {
  url: string
  name: string
  shot?: { rel: string; target: FocusTarget } // one of the reviewer's screenshots (Mark up)
}

function basename(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/** The single-screen surface for a light request. */
export function LightRun({
  path,
  request,
  initialReport
}: {
  path: string
  request: QaRequest
  initialReport: QaReport
}): React.JSX.Element {
  const { helpOpen, navigate, openProject, scope, settings, showToast, snapshot, switcherOpen } =
    useApp()
  const parkedIds = useMemo(() => new Set(request.parked.map((item) => item.id)), [request.parked])
  const mainCheckIds = useMemo(() => request.items.map((item) => item.id), [request.items])
  const detailIds = useMemo(
    () =>
      request.items
        .filter((item) => item.steps.length > 0 || item.expected.length > 0)
        .map((item) => item.id),
    [request.items]
  )

  const [report, setReport] = useState(initialReport)
  const [saveError, setSaveError] = useState<ReportDisplayError | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const [markupSession, setMarkupSession] = useState<MarkupSession | null>(null)
  const [justFinished, setJustFinished] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [parkOpen, setParkOpen] = useState(true)
  const [openDetails, setOpenDetails] = useState<Set<string>>(new Set())
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(
    mainCheckIds[0] ? { kind: 'check', id: mainCheckIds[0] } : null
  )

  const reportRef = useRef(initialReport)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const terminalWriteRef = useRef(false)
  const [rev, setRev] = useState(0)
  const readOnly = !!report.completedAt
  const controlsDisabled = readOnly || finishing

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

  const doSave = useCallback(
    async (snapshot: QaReport) => {
      try {
        const result = await window.qa.saveReport(path, snapshot)
        setSaveError(validateSaveReportResult(result).error)
      } catch (error) {
        setSaveError(reportDisplayError(error))
      }
    },
    [path]
  )

  useEffect(() => {
    if (rev === 0 || terminalWriteRef.current) return
    dirtyRef.current = true
    const snapshot = reportRef.current
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

  // The debounce timer is cancelled by unmount; flush its latest snapshot so
  // switching surfaces inside that 400 ms window cannot discard the last edit.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        dirtyRef.current = false
        void doSave(reportRef.current)
      }
    }
  }, [doSave])

  const mutate = useCallback((producer: (current: QaReport) => QaReport) => {
    const previous = reportRef.current
    if (previous.completedAt || terminalWriteRef.current) return
    const next = producer(previous)
    if (next === previous) return
    reportRef.current = next
    setReport(next)
    setRev((revision) => revision + 1)
  }, [])

  const activeItems = useCallback(
    (snapshot: QaReport) =>
      snapshot.items.filter((item) => !item.removed && !parkedIds.has(item.id)),
    [parkedIds]
  )

  const doFinish = useCallback(async () => {
    if (terminalWriteRef.current) return
    setConfirmOpen(false)
    terminalWriteRef.current = true
    setFinishing(true)
    cancelPendingReportSave(saveTimerRef, dirtyRef)
    try {
      const result = await window.qa.finishRun(path, reportRef.current)
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
      await copyCollectPromptAfterFinish(path, request.title, showToast)
    } catch (error) {
      terminalWriteRef.current = false
      dirtyRef.current = true
      setFinishing(false)
      setSaveError(reportDisplayError(error))
    }
  }, [path, request, showToast])

  const requestFinish = useCallback(() => {
    const snapshot = reportRef.current
    if (snapshot.completedAt) return
    const items = activeItems(snapshot)
    const unanswered = items.filter((item) => item.status === 'unanswered').length
    if (unanswered > 0) setConfirmOpen(true)
    else void doFinish()
  }, [activeItems, doFinish])

  const finishEverythingWorks = useCallback(() => {
    mutate((current) => markUnansweredWorks(current, parkedIds))
    void doFinish()
  }, [doFinish, mutate, parkedIds])

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
    } catch (error) {
      terminalWriteRef.current = false
      setSaveError(reportDisplayError(error))
    }
  }, [path])

  useEffect(() => {
    if (!justFinished) return
    const timer = setTimeout(
      () => followRecordExit(exitRef.current, { openProject, navigate }),
      1600
    )
    return () => clearTimeout(timer)
  }, [justFinished, navigate, openProject])

  const ingestImage = useCallback(
    async (target: FocusTarget, file: File | null) => {
      if (!file) return
      const base64 = await blobToPngBase64(file)
      if (!base64) {
        showToast('That image could not be read')
        return
      }
      try {
        const rel = await window.qa.addShot(path, target.id, base64)
        mutate((current) =>
          target.kind === 'observation'
            ? addObservationScreenshot(current, target.id, rel)
            : addScreenshot(current, target.id, rel)
        )
      } catch {
        showToast('That image could not be read')
      }
    },
    [mutate, path, showToast]
  )

  useEffect(() => {
    if (controlsDisabled) return
    function onPaste(event: ClipboardEvent): void {
      if (document.querySelector('.mkwin')) return
      const file = firstImageFile(event.clipboardData?.items ?? null)
      if (!file || !focusTarget) return
      event.preventDefault()
      void ingestImage(focusTarget, file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [controlsDisabled, focusTarget, ingestImage])

  const showPasteHint = useCallback(
    (target: FocusTarget) => {
      setFocusTarget(target)
      showToast('Paste with ⌘V, or drag a screenshot onto the check')
    },
    [showToast]
  )

  const focusCheck = useCallback(
    (index: number) => {
      if (mainCheckIds.length === 0) return
      const resolved = Math.min(Math.max(index, 0), mainCheckIds.length - 1)
      const id = mainCheckIds[resolved]
      setFocusTarget({ kind: 'check', id })
      setTimeout(() => {
        const row = Array.from(document.querySelectorAll<HTMLElement>('[data-lr-main-check]')).find(
          (element) => element.dataset.lrMainCheck === id
        )
        row?.focus()
        row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }, 0)
    },
    [mainCheckIds]
  )

  const moveCheck = useCallback(
    (delta: number) => {
      const focusedId = focusTarget?.kind === 'check' ? focusTarget.id : null
      focusCheck(nextMainCheckIndex(mainCheckIds, focusedId, delta))
    },
    [focusCheck, focusTarget, mainCheckIds]
  )

  const toggleDetail = useCallback((id: string) => {
    setOpenDetails((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allDetailsOpen =
    detailIds.length > 0 && detailIds.every((detailId) => openDetails.has(detailId))
  const toggleAllDetails = useCallback(() => {
    setOpenDetails(allDetailsOpen ? new Set() : new Set(detailIds))
  }, [allDetailsOpen, detailIds])

  const addObservationBlock = useCallback(() => {
    const id = nextObservationId(reportRef.current)
    mutate(addObservation)
    setFocusTarget({ kind: 'observation', id })
    setTimeout(() => {
      const textarea = Array.from(
        document.querySelectorAll<HTMLTextAreaElement>('[data-lr-observation-text]')
      ).find((element) => element.dataset.lrObservationText === id)
      textarea?.focus()
      if (textarea) growTextarea(textarea)
    }, 0)
  }, [mutate])

  const removeObservationBlock = useCallback(
    (id: string) => {
      mutate((current) => removeObservation(current, id))
      if (focusTarget?.kind === 'observation' && focusTarget.id === id) {
        setFocusTarget(mainCheckIds[0] ? { kind: 'check', id: mainCheckIds[0] } : null)
      }
    },
    [focusTarget, mainCheckIds, mutate]
  )

  const focusedCheckId = focusTarget?.kind === 'check' ? focusTarget.id : null
  const commandEnabled = !confirmOpen && !zoom && !helpOpen && !switcherOpen && !markupSession
  // Mark up one of the reviewer's screenshots; the copy is stored beside it.
  const openShotMarkup = (rel: string, target: FocusTarget): void => {
    const current = reportRef.current
    const holder =
      target.kind === 'check'
        ? current.items.find((it) => it.id === target.id)
        : current.observations?.find((o) => o.id === target.id)
    if (!holder || controlsDisabled) return
    setZoom(null)
    setMarkupSession(
      screenshotSession({
        requestPath: path,
        itemId: target.id,
        rel,
        title: 'title' in holder ? holder.title : 'Observation',
        existing: holder.markups?.find((m) => m.picture === rel),
        onSaved: (markup) =>
          mutate((r) =>
            setShotMarkup(
              r,
              { kind: target.kind === 'check' ? 'item' : 'observation', id: target.id },
              rel,
              markup
            )
          )
      })
    )
  }
  const zoomMarked = (shot: NonNullable<Zoom['shot']>): boolean => {
    const holder =
      shot.target.kind === 'check'
        ? report.items.find((it) => it.id === shot.target.id)
        : report.observations?.find((o) => o.id === shot.target.id)
    return !!holder?.markups?.some((m) => m.picture === shot.rel)
  }
  useCommandScope({
    'run.finish-confirm': { enabled: confirmOpen, priority: 90, handler: () => void doFinish() },
    'app.close-back': {
      enabled: confirmOpen || !!zoom,
      priority: 90,
      handler: () => (confirmOpen ? setConfirmOpen(false) : setZoom(null))
    },
    'nav.move-down': { enabled: commandEnabled, handler: () => moveCheck(1) },
    'nav.move-up': { enabled: commandEnabled, handler: () => moveCheck(-1) },
    'light.focus-check': {
      enabled: commandEnabled && mainCheckIds.length > 0,
      handler: (event) => event && focusCheck(Number(event.key) - 1)
    },
    'light.toggle-detail': {
      enabled: commandEnabled && !!focusedCheckId && detailIds.includes(focusedCheckId),
      handler: () => focusedCheckId && toggleDetail(focusedCheckId)
    },
    'light.toggle-all-details': {
      enabled: commandEnabled && detailIds.length > 0,
      handler: toggleAllDetails
    },
    'light.toggle-works': {
      enabled: commandEnabled && !controlsDisabled && !!focusedCheckId,
      preventDefault: false,
      handler: (event) => {
        if (isActivatableTarget(event?.target ?? null)) return
        event?.preventDefault()
        if (focusedCheckId) mutate((current) => applyVerdict(current, focusedCheckId, 'pass'))
      }
    },
    'light.toggle-problem': {
      enabled: commandEnabled && !controlsDisabled && !!focusedCheckId,
      handler: () =>
        focusedCheckId && mutate((current) => applyVerdict(current, focusedCheckId, 'fail'))
    },
    'light.everything-works': {
      enabled: commandEnabled && !controlsDisabled,
      handler: finishEverythingWorks
    },
    'light.add-observation': {
      enabled: commandEnabled && !controlsDisabled,
      handler: addObservationBlock
    },
    'light.remove-observation': {
      enabled: commandEnabled && !controlsDisabled && focusTarget?.kind === 'observation',
      handler: () => focusTarget?.kind === 'observation' && removeObservationBlock(focusTarget.id)
    },
    'light.paste-screenshot': {
      enabled: commandEnabled && !controlsDisabled && !!focusTarget,
      preventDefault: false,
      handler: () => focusTarget && showPasteHint(focusTarget)
    },
    'markup.open': {
      enabled: !!zoom?.shot && !controlsDisabled && !markupSession,
      priority: 90,
      handler: () => zoom?.shot && openShotMarkup(zoom.shot.rel, zoom.shot.target)
    },
    'run.finish': { enabled: commandEnabled, handler: requestFinish },
    'run.reopen': {
      enabled: commandEnabled && !!report.completedAt,
      handler: () => void doReopen()
    },
    'light.open-detailed': {
      enabled: commandEnabled,
      handler: () => navigate({ kind: 'runner', path, detailed: true })
    },
    'run.retry-save': {
      enabled: commandEnabled && !!saveError,
      handler: () => void doSave(reportRef.current)
    }
  })

  const total = activeItems(report).length
  const unanswered = activeItems(report).filter((item) => item.status === 'unanswered').length
  const layout = lightRunLayout(request.items.length)
  const finishedClock = formatClock(report.completedAt ?? null)
  const recoverCorrupt = async (): Promise<void> => {
    try {
      const opened = await window.qa.setAsideCorruptReport(path, reportRef.current)
      reportRef.current = opened.report
      setReport(opened.report)
      dirtyRef.current = false
      setSaveError(null)
      showToast('The old report was set aside. Your report is ready.')
    } catch (error) {
      const failure = reportDisplayError(error)
      setSaveError(failure)
      showToast(recoveryFailureMessage(failure))
    }
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
          <button className="retry" onClick={() => void recoverCorrupt()}>
            Set aside and start fresh
          </button>
        </>
      ) : (
        <button className="retry" onClick={() => void doSave(reportRef.current)}>
          <RotateCw className="ic s" strokeWidth={2} />
          Retry
        </button>
      )}
    </div>
  )

  return (
    <div className={`view lightrun ${readingTextSizeClass(settings?.readingTextSize)}`}>
      {banner}
      <div className="lr-scroll">
        <div className="lr-frame" data-find-scope>
          <header className="lr-head">
            <div className="lr-head-row">
              <button
                className="backbtn"
                aria-label="Back to inbox"
                onClick={() => leave(exitView)}
              >
                <ArrowLeft className="ic" strokeWidth={2} />
              </button>
              <h1 className="lr-title">{request.title}</h1>
              <div className="lr-head-actions">
                {layout.showChecks && (
                  <button
                    className="lr-detailed"
                    aria-label="Detailed view"
                    onClick={() => navigate({ kind: 'runner', path, detailed: true })}
                  >
                    Details
                  </button>
                )}
                {readOnly && (
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
                )}
              </div>
            </div>
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
            <div className="lr-chips">
              {request.app && <span className="lr-chip lr-chip-mono">{request.app}</span>}
              {request.version && <span className="lr-chip lr-chip-mono">{request.version}</span>}
              {request.labels.kind && <span className="lr-chip">{request.labels.kind}</span>}
            </div>
            {request.intro && <p className="lr-intro">{renderBold(request.intro)}</p>}
          </header>

          {layout.showChecks && (
            <>
              <div className="lr-sect">
                <span className="lr-sect-label">Does it work?</span>
                {detailIds.length > 0 && (
                  <button
                    className="lr-step-all"
                    aria-pressed={allDetailsOpen}
                    onClick={toggleAllDetails}
                  >
                    ⋮ Step by step
                  </button>
                )}
              </div>

              <div className="lr-check-list">
                {request.items.map((requestItem) => {
                  const item = report.items.find((candidate) => candidate.id === requestItem.id)
                  if (!item) return null
                  return (
                    <LightCheck
                      key={item.id}
                      item={item}
                      requestItem={requestItem}
                      requestPath={path}
                      readOnly={controlsDisabled}
                      focused={focusTarget?.kind === 'check' && focusTarget.id === item.id}
                      detailOpen={openDetails.has(item.id)}
                      onFocus={() => setFocusTarget({ kind: 'check', id: item.id })}
                      onToggleWorks={() =>
                        mutate((current) => applyVerdict(current, item.id, 'pass'))
                      }
                      onToggleProblem={() =>
                        mutate((current) => applyVerdict(current, item.id, 'fail'))
                      }
                      onComment={(text) => mutate((current) => setComment(current, item.id, text))}
                      onToggleDetail={() => toggleDetail(item.id)}
                      onDropImage={(file) => void ingestImage({ kind: 'check', id: item.id }, file)}
                      onPasteHint={() => showPasteHint({ kind: 'check', id: item.id })}
                      onZoom={(url, name, rel) =>
                        setZoom({
                          url,
                          name,
                          shot: rel ? { rel, target: { kind: 'check', id: item.id } } : undefined
                        })
                      }
                      onEditMarks={(m) => openShotMarkup(m.picture, { kind: 'check', id: item.id })}
                      onRemoveShot={(rel) =>
                        mutate((current) => removeScreenshot(current, item.id, rel))
                      }
                    />
                  )
                })}
              </div>
            </>
          )}

          {request.parked.length > 0 && (
            <section className="lr-park">
              <button
                className="lr-park-hd"
                aria-expanded={parkOpen}
                onClick={() => setParkOpen((open) => !open)}
              >
                <span>Also worth checking</span>
                <span className="lr-park-count">{request.parked.length} · optional</span>
                <span className="lr-park-caret">{parkOpen ? '▾' : '▸'}</span>
              </button>
              {parkOpen && (
                <>
                  <div className="lr-park-list">
                    {request.parked.map((parked) => {
                      const item = report.items.find((candidate) => candidate.id === parked.id)
                      return (
                        <div className="lr-park-item" key={parked.id}>
                          {showParkedDot(!!item) && <span className="lr-park-dot" />}
                          {item ? (
                            <LightCheck
                              compact
                              item={item}
                              requestPath={path}
                              readOnly={controlsDisabled}
                              focused={focusTarget?.kind === 'check' && focusTarget.id === item.id}
                              detailOpen={false}
                              text={parked.text}
                              onFocus={() => setFocusTarget({ kind: 'check', id: item.id })}
                              onToggleWorks={() =>
                                mutate((current) => applyVerdict(current, item.id, 'pass'))
                              }
                              onToggleProblem={() =>
                                mutate((current) => applyVerdict(current, item.id, 'fail'))
                              }
                              onComment={(text) =>
                                mutate((current) => setComment(current, item.id, text))
                              }
                              onToggleDetail={() => {}}
                              onDropImage={(file) =>
                                void ingestImage({ kind: 'check', id: item.id }, file)
                              }
                              onPasteHint={() => showPasteHint({ kind: 'check', id: item.id })}
                              onZoom={(url, name, rel) =>
                                setZoom({
                                  url,
                                  name,
                                  shot: rel
                                    ? { rel, target: { kind: 'check', id: item.id } }
                                    : undefined
                                })
                              }
                              onEditMarks={(m) =>
                                openShotMarkup(m.picture, { kind: 'check', id: item.id })
                              }
                              onRemoveShot={(rel) =>
                                mutate((current) => removeScreenshot(current, item.id, rel))
                              }
                            />
                          ) : (
                            <>
                              <span className="lr-park-text">{renderBold(parked.text)}</span>
                              <button
                                className="lr-test-now"
                                disabled={controlsDisabled}
                                onClick={() => {
                                  mutate((current) => ensureItem(current, parked.id, parked.text))
                                  setFocusTarget({ kind: 'check', id: parked.id })
                                }}
                              >
                                test now
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="lr-park-note">
                    Reference only — no verdict needed. A later sweep or an automated test can pick
                    these up.
                  </p>
                </>
              )}
            </section>
          )}

          <section className="lr-obs">
            <h2 className="lr-obs-hd">💡 Other observations</h2>
            <p className="lr-obs-sub">
              Anything you noticed or thought of while poking around — a bug, an idea, a rough edge.
              Each one is its own note, so keep them separate; related to a check or not.
            </p>
            {(report.observations ?? []).map((observation) => (
              <ObservationBlock
                key={observation.id}
                observation={observation}
                requestPath={path}
                readOnly={controlsDisabled}
                onFocus={() => setFocusTarget({ kind: 'observation', id: observation.id })}
                onText={(text) =>
                  mutate((current) => setObservationText(current, observation.id, text))
                }
                onDropImage={(file) =>
                  void ingestImage({ kind: 'observation', id: observation.id }, file)
                }
                onPasteHint={() => showPasteHint({ kind: 'observation', id: observation.id })}
                onZoom={(url, name, rel) =>
                  setZoom({
                    url,
                    name,
                    shot: rel
                      ? { rel, target: { kind: 'observation', id: observation.id } }
                      : undefined
                  })
                }
                onEditMarks={(m) =>
                  openShotMarkup(m.picture, { kind: 'observation', id: observation.id })
                }
                onRemoveShot={(rel) =>
                  mutate((current) => removeObservationScreenshot(current, observation.id, rel))
                }
                onRemove={() => removeObservationBlock(observation.id)}
              />
            ))}
            <button
              className="lr-obs-add"
              disabled={controlsDisabled}
              onClick={addObservationBlock}
            >
              ＋ Add an observation
            </button>
          </section>
          {/* Finish is the one way out, and it comes last, after the
              observations, so nothing is left behind. */}
          <div className="lr-foot lr-foot-end">
            <button
              className="lr-finish lr-finish-primary"
              disabled={controlsDisabled}
              onClick={requestFinish}
            >
              <Check className="lr-everything-icon" strokeWidth={2.5} />
              Finish
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <FinishConfirm
          unanswered={unanswered}
          total={total}
          onConfirm={() => void doFinish()}
          onCancel={() => setConfirmOpen(false)}
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
          {zoom.shot && !controlsDisabled && (
            <ZoomMarkUpBar
              marked={zoomMarked(zoom.shot)}
              onMarkUp={() => zoom.shot && openShotMarkup(zoom.shot.rel, zoom.shot.target)}
            />
          )}
        </div>
      )}
      {markupSession && (
        <MarkupView session={markupSession} onClose={() => setMarkupSession(null)} />
      )}
    </div>
  )
}

function LightCheck({
  item,
  requestItem,
  requestPath,
  readOnly,
  focused,
  detailOpen,
  compact = false,
  text,
  onFocus,
  onToggleWorks,
  onToggleProblem,
  onComment,
  onToggleDetail,
  onDropImage,
  onPasteHint,
  onZoom,
  onEditMarks,
  onRemoveShot
}: {
  item: ReportItem
  requestItem?: RequestItem
  requestPath: string
  readOnly: boolean
  focused: boolean
  detailOpen: boolean
  compact?: boolean
  text?: string
  onFocus: () => void
  onToggleWorks: () => void
  onToggleProblem: () => void
  onComment: (text: string) => void
  onToggleDetail: () => void
  onDropImage: (file: File | null) => void
  onPasteHint: () => void
  onZoom: (url: string, name: string, rel?: string) => void
  onEditMarks: (markup: PictureMarkup) => void
  onRemoveShot: (rel: string) => void
}): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const hasDetail =
    !!requestItem && (requestItem.steps.length > 0 || requestItem.expected.length > 0)
  const displayText = text ?? requestItem?.context ?? item.title
  const screenshotLabel =
    item.screenshots.length === 0
      ? '📷 Screenshot'
      : `📷 ${item.screenshots.length} screenshot${item.screenshots.length === 1 ? '' : 's'}`
  const verdictPresentation = lightVerdictPresentation(item.status)

  return (
    <div
      className={`lr-check${verdictPresentation.rowClass}${focused ? ' lr-focus' : ''}${
        compact ? ' lr-check-parked' : ''
      }${dragOver ? ' lr-dragover' : ''}`}
      data-lr-main-check={compact ? undefined : item.id}
      tabIndex={-1}
      onMouseDown={onFocus}
      onFocusCapture={onFocus}
      onDragOver={(event) => {
        if (readOnly) return
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        setDragOver(false)
        if (readOnly) return
        event.preventDefault()
        onDropImage(firstImageFileFromDrop(event.dataTransfer))
      }}
    >
      <button
        className="lr-tick"
        aria-label={
          verdictPresentation.title
            ? `${verdictPresentation.title}. Mark works`
            : item.status === 'pass'
              ? 'Clear works'
              : 'Works'
        }
        title={verdictPresentation.title}
        disabled={readOnly}
        onClick={onToggleWorks}
      >
        <Check className="lr-tick-icon" strokeWidth={3} />
      </button>
      <div className="lr-check-body">
        <div className="lr-check-text">
          <span>{renderBold(displayText)}</span>
          {verdictPresentation.chip && (
            <span className="lr-verdict-chip" title={verdictPresentation.title}>
              {verdictPresentation.chip}
            </span>
          )}
        </div>
        <div className="lr-check-actions">
          <button
            className={`lr-flag${item.status === 'fail' ? ' lr-active' : ''}`}
            disabled={readOnly}
            onClick={onToggleProblem}
          >
            {item.status === 'fail' ? "⚑ Something's off — tap to clear" : "⚑ Something's off"}
          </button>
          <button
            className={`lr-shot${item.screenshots.length > 0 ? ' lr-active' : ''}`}
            disabled={readOnly}
            onClick={onPasteHint}
          >
            {screenshotLabel}
          </button>
          {hasDetail && (
            <button className="lr-more" aria-expanded={detailOpen} onClick={onToggleDetail}>
              {detailOpen ? '▾ Steps' : '▸ Steps'}
            </button>
          )}
        </div>
        {shouldShowLightComment(item.status, item.comment) && (
          <textarea
            className="lr-note"
            rows={1}
            ref={(textarea) => {
              if (textarea) return observeTextareaGrowth(textarea)
              return
            }}
            aria-label={`Problem note for ${displayText}`}
            value={item.comment}
            readOnly={readOnly}
            onFocus={(event) => growTextarea(event.currentTarget)}
            onInput={(event) => growTextarea(event.currentTarget)}
            onChange={(event) => onComment(event.currentTarget.value)}
          />
        )}
        {item.screenshots.length > 0 && (
          <ShotStrip
            requestPath={requestPath}
            screenshots={item.screenshots}
            readOnly={readOnly}
            onZoom={onZoom}
            onRemove={onRemoveShot}
            onPasteHint={onPasteHint}
          />
        )}
        <MarkedPictures
          requestPath={requestPath}
          markups={markupsFor(item)}
          readOnly={readOnly}
          caption={(m) => m.picture.split('/').pop() ?? m.picture}
          onEdit={onEditMarks}
          onZoom={(url, name) => onZoom(url, name)}
        />
        {hasDetail && detailOpen && requestItem && (
          <div className="lr-detail">
            {requestItem.steps.length > 0 && (
              <>
                <p className="lr-detail-label">How to check</p>
                <ul>
                  {requestItem.steps.map((step, index) => (
                    <li key={index}>{renderBold(step)}</li>
                  ))}
                </ul>
              </>
            )}
            {requestItem.expected.length > 0 && (
              <>
                <p className="lr-detail-label">Expect</p>
                <ul>
                  {requestItem.expected.map((expected, index) => (
                    <li key={index}>{renderBold(expected)}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ObservationBlock({
  observation,
  requestPath,
  readOnly,
  onFocus,
  onText,
  onDropImage,
  onPasteHint,
  onZoom,
  onEditMarks,
  onRemoveShot,
  onRemove
}: {
  observation: Observation
  requestPath: string
  readOnly: boolean
  onFocus: () => void
  onText: (text: string) => void
  onDropImage: (file: File | null) => void
  onPasteHint: () => void
  onZoom: (url: string, name: string, rel?: string) => void
  onEditMarks: (markup: PictureMarkup) => void
  onRemoveShot: (rel: string) => void
  onRemove: () => void
}): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  return (
    <div
      className={`lr-obs-item${dragOver ? ' lr-dragover' : ''}`}
      onMouseDown={onFocus}
      onFocusCapture={onFocus}
      onDragOver={(event) => {
        if (readOnly) return
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        setDragOver(false)
        if (readOnly) return
        event.preventDefault()
        onDropImage(firstImageFileFromDrop(event.dataTransfer))
      }}
    >
      <textarea
        ref={(textarea) => {
          if (textarea) return observeTextareaGrowth(textarea)
          return
        }}
        data-lr-observation-text={observation.id}
        rows={1}
        value={observation.text}
        readOnly={readOnly}
        aria-label={`Observation ${observation.id}`}
        onFocus={(event) => growTextarea(event.currentTarget)}
        onInput={(event) => growTextarea(event.currentTarget)}
        onChange={(event) => onText(event.target.value)}
      />
      <div className="lr-obs-item-foot">
        <button className="lr-obs-shot" disabled={readOnly} onClick={onPasteHint}>
          📷 Screenshot
        </button>
        {observation.screenshots.length > 0 && (
          <ShotStrip
            requestPath={requestPath}
            screenshots={observation.screenshots}
            readOnly={readOnly}
            onZoom={onZoom}
            onRemove={onRemoveShot}
            onPasteHint={onPasteHint}
          />
        )}
        <button className="lr-obs-remove" disabled={readOnly} onClick={onRemove}>
          Remove
        </button>
      </div>
      <MarkedPictures
        requestPath={requestPath}
        markups={markupsFor(observation)}
        readOnly={readOnly}
        caption={(m) => m.picture.split('/').pop() ?? m.picture}
        onEdit={onEditMarks}
        onZoom={(url, name) => onZoom(url, name)}
      />
    </div>
  )
}

/** Drop-transfer variant of {@link firstImageFile}. */
function firstImageFileFromDrop(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer) return null
  for (const file of Array.from(dataTransfer.files)) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}
