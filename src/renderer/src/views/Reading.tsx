import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  Flag,
  Image as ImageIcon,
  MessageSquare,
  MinusCircle,
  PanelRightClose,
  PanelRightOpen,
  Quote as QuoteIcon,
  RotateCw,
  TriangleAlert,
  X
} from 'lucide-react'
import { useApp } from '../state/app'
import { DISPOSITIONS } from '../lib/dispositions'
import { formatClock } from '../lib/format'
import { optionShortLabel, parseDocBlocks, renderRuns, runsText } from '../lib/richtext'
import type { DocBlock, InlineRun } from '../lib/richtext'
import {
  addReviewQuote,
  documentItem,
  DOCUMENT_ITEM_ID,
  flushPendingSave,
  layoutMarginTops,
  nextMarkerNumber,
  orderLedgerEntries,
  removeReviewQuote,
  resolveAnchors,
  setDecisionChoice,
  setDecisionComment,
  setDisposition,
  setDocumentComment,
  setReviewQuoteComment,
  setSectionMarkComment,
  textContainers,
  toggleSectionMark
} from '../lib/reviewState'
import type { AnchorSpot, LedgerEntry } from '../lib/reviewState'
import { addScreenshot, removeScreenshot } from '../lib/runnerState'
import { blobToPngBase64, firstImageFile } from '../lib/imageToPng'
import { ShotStrip } from '../components/ShotStrip'
import { DocumentImage } from '../components/DocumentImage'
import { DecisionBlock } from '../components/DecisionCard'
import type { DecisionImages } from '../components/DecisionCard'
import { DecisionCompare, DecisionLightbox } from '../components/DecisionCompare'
import {
  DecisionPopover,
  DecisionProgress,
  DecisionRailButton,
  DecisionRailRows
} from '../components/DecisionRail'
import { MarkupView, ZoomMarkUpBar } from '../components/MarkupView'
import { MarkedPictures } from '../components/MarkedPictures'
import { screenshotSession } from '../lib/markupSession'
import type { MarkupSession } from '../lib/markupSession'
import {
  isMarkablePicture,
  markupsFor,
  pictureKey,
  setDecisionMarkup,
  setShotMarkup
} from '../lib/markup'
import { listDecisions } from '../lib/decisions'
import type { DecisionInfo } from '../lib/decisions'
import { ReviewFinishConfirm } from '../components/ReviewFinishConfirm'
import { AgentStatus } from '../components/AgentStatus'
import { FinishedCollectionStatus } from '../components/FinishedCollectionStatus'
import type {
  DecisionAnswer,
  PictureMarkup,
  QaReport,
  QaRequest,
  Verdict
} from '../../../main/qa/types'
import { useCommandScope } from '../commands/provider'
import {
  recoveryFailureMessage,
  reportDisplayError,
  validateReportMutationResult,
  validateSaveReportResult,
  type ReportDisplayError
} from '../lib/reportErrors'
import { readingTextSizeClass } from '../../../shared/ipc'
import type { ReadingProgress } from '../../../shared/ipc'
import { requestKey } from '../lib/inbox'
import { resolveReadingPosition } from '../lib/specs'
import { copyCollectPromptAfterFinish } from '../lib/collectPromptCopy'

// The wide/narrow breakpoint. The hi-fi shows 460 px (narrow) and 800 px
// (wide) frames without naming a threshold; 720 px keeps the wide layout's
// 172 px rail + 262 px margin from crushing the document column.
const WIDE_BREAKPOINT = 720
const EMPTY_SPOTS = new Map<string, (AnchorSpot & { number: number })[]>()
const EMPTY_FALLBACKS = new Map<string | null, number[]>()
const EMPTY_MARKS = new Set<string>()
const EMPTY_DECISIONS = new Map<string, DecisionAnswer>()
const NOOP = (): void => {}

interface QuoteHint {
  raw: string
  before: string
  after: string
  section: string | null
  left: number
  top: number
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

/** Wrap an inline SVG string in a minimal, centred HTML document for the frame. */
function svgFrame(code: string): string {
  return `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:10px;font-family:system-ui,-apple-system,sans-serif}svg{max-width:100%;height:auto;display:block;margin:0 auto}</style>${code}`
}

/** Re-trigger a CSS one-shot animation class (the hi-fi's flash idiom). */
function flash(el: Element | null): void {
  if (!el) return
  el.classList.remove('flash')
  void (el as HTMLElement).offsetWidth
  el.classList.add('flash')
}

/** Size a ledger comment textarea to its content (the hi-fi's growing ctext). */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/**
 * The Reading surface (M7, ADR-0007/0008): the Snapshot as one continuous
 * document, headings as a TOC rail, quote-anchored comments in a margin
 * Ledger at width or a slide-over Ledger behind numbered Markers when narrow,
 * and a document-level Disposition. The Runner delegates here for
 * `kind: doc-review` requests; the report plumbing (single 'document' item,
 * debounced autosave with unmount flush) mirrors the Runner exactly.
 */
export function Reading({
  path,
  request,
  initialReport
}: {
  path: string
  request: QaRequest
  initialReport: QaReport
}): React.JSX.Element {
  const {
    back,
    snapshot,
    helpOpen,
    switcherOpen,
    settings,
    changeSetting,
    showToast,
    rightPanel,
    setRightPanel
  } = useApp()

  const [report, setReport] = useState<QaReport>(initialReport)
  // `rel` is set when the zoomed picture is one of his screenshots (Mark up).
  const [zoom, setZoom] = useState<{ url: string; name: string; rel?: string } | null>(null)
  // Ticket 30: the open mark-up view, over whatever it was opened from.
  const [markupSession, setMarkupSession] = useState<MarkupSession | null>(null)
  // Decisions: the one the rail points at, the big compare view, the picture
  // enlarged from a card, and the narrow rail's labelled list.
  const [curDecision, setCurDecision] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ id: string; index: number } | null>(null)
  const [railListOpen, setRailListOpen] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<ReportDisplayError | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [dispOpen, setDispOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [currentSec, setCurrentSec] = useState<string | null>(null)
  const [storedProgress, setStoredProgress] = useState<ReadingProgress | null>(null)
  const [quoteHint, setQuoteHint] = useState<QuoteHint | null>(null)
  const [wide, setWide] = useState(false)
  // First-use hint: seen once any entry exists; sticky for the session (the
  // hi-fi's hintSeen — removing every entry does not resurrect the hint).
  const [hintSeen, setHintSeen] = useState(() => {
    const it = documentItem(initialReport)
    return !!it && it.quotes.length + (it.sectionMarks?.length ?? 0) > 0
  })

  const reportRef = useRef<QaReport>(initialReport)
  const markupOpenRef = useRef(false)
  useLayoutEffect(() => {
    markupOpenRef.current = !!markupSession
  })
  const documentImageSourceCacheRef = useRef<Map<string, Promise<string>>>(new Map())
  const dirtyRef = useRef(false)
  const currentSecRef = useRef<string | null>(null)
  const decisionLockRef = useRef(0)
  const dispChipRef = useRef<HTMLButtonElement | null>(null)
  const relayoutRef = useRef<() => void>(() => {})
  const restoredProgressRef = useRef(false)
  const [rev, setRev] = useState(0)
  // Callback refs, not useRef: observers and layout must attach when the
  // elements appear, never observe a null from a loading pass (Runner law).
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null)
  const [flowEl, setFlowEl] = useState<HTMLDivElement | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [docEl, setDocEl] = useState<HTMLDivElement | null>(null)
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null)

  const readOnly = !!report.completedAt
  const doc = request.document
  const headings = useMemo(() => doc?.headings ?? [], [doc])
  const progressKey = snapshot?.root ? requestKey(snapshot.root, path) : ''

  const blocks = useMemo(() => parseDocBlocks(doc?.bodyMarkdown ?? ''), [doc])
  const containers = useMemo(() => textContainers(blocks), [blocks])

  const item = documentItem(report)
  const quotes = useMemo(() => item?.quotes ?? [], [item])
  const marks = useMemo(() => item?.sectionMarks ?? [], [item])
  const screenshots = useMemo(() => item?.screenshots ?? [], [item])
  const decisionMap = useMemo(() => {
    const map = new Map<string, DecisionAnswer>()
    for (const d of item?.decisions ?? []) map.set(d.id, d)
    return map
  }, [item])
  const decisions = useMemo(() => listDecisions(blocks, headings), [blocks, headings])
  const decisionInfo = useMemo(() => new Map(decisions.map((d) => [d.id, d])), [decisions])
  const decisionsBySection = useMemo(() => {
    const by = new Map<string | null, DecisionInfo[]>()
    for (const d of decisions) by.set(d.section, [...(by.get(d.section) ?? []), d])
    return by
  }, [decisions])
  const anchors = useMemo(() => resolveAnchors(containers, quotes), [containers, quotes])
  const entries = useMemo(
    () => orderLedgerEntries(quotes, marks, containers, anchors),
    [quotes, marks, containers, anchors]
  )

  // Review margin (relief pass R2): the wide-mode comments ledger is
  // collapsible. 'auto' hides it only while empty (his paper cut: an empty
  // margin sat there taking space); 'collapsed' forces it. When collapsed in
  // wide mode the comment path falls back to inline markers + the slide-over,
  // so the document reclaims the width with no loss of access.
  const entryCount = quotes.length + marks.length
  const reviewMargin = settings?.reviewMargin ?? 'auto'
  const collapsed =
    reviewMargin === 'collapsed' || (reviewMargin === 'auto' && entryCount === 0 && !readOnly)
  const ledgerChosen = rightPanel === 'ledger'
  const marginPlane = wide && ledgerChosen && !collapsed
  const compact = !marginPlane
  const setMargin = (v: 'open' | 'collapsed'): void => {
    changeSetting('reviewMargin', v)
    setRightPanel(v === 'open' ? 'ledger' : 'closed')
  }
  const effectivePanelOpen = ledgerChosen && panelOpen

  // Anchor spots grouped per container path, and unresolved quotes per section
  // (their Markers fall back to the section heading — T4).
  const spotsByPath = useMemo(() => {
    const map = new Map<string, (AnchorSpot & { number: number })[]>()
    for (const q of quotes) {
      const n = q.number ?? 0
      const spot = anchors.get(n)
      if (!spot) continue
      const list = map.get(spot.path) ?? []
      list.push({ ...spot, number: n })
      map.set(spot.path, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start)
    return map
  }, [quotes, anchors])
  const fallbackBySection = useMemo(() => {
    const map = new Map<string | null, number[]>()
    for (const q of quotes) {
      const n = q.number ?? 0
      if (anchors.get(n) !== null) continue
      const sec = q.section ?? null
      map.set(sec, [...(map.get(sec) ?? []), n])
    }
    return map
  }, [quotes, anchors])

  const sectionTitle = useCallback(
    (section: string | null): string =>
      section === null ? 'Preamble' : (headings.find((h) => h.id === section)?.title ?? section),
    [headings]
  )

  // ---- autosave: the Runner's exact debounce + unmount-flush pattern -------
  const doSave = useCallback(
    async (snap: QaReport) => {
      try {
        const result = await window.qa.saveReport(path, snap)
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

  useEffect(() => {
    if (rev === 0) return
    dirtyRef.current = true
    const snap = reportRef.current
    if (!snap) return
    const timer = setTimeout(() => {
      dirtyRef.current = false
      // A finish can land inside the debounce window (disposition key, ⇧F,
      // Enter) — never let the pre-stamp snapshot overwrite the stamped file.
      if (reportRef.current?.completedAt) return
      void doSave(snap)
    }, 400)
    return () => clearTimeout(timer)
  }, [rev, doSave])

  // Flush at the switch boundary: unmounting cancels the pending debounce, so
  // a comment typed within the last 400 ms would never reach disk (the
  // TallyBoard empty-outline lesson). Fire-and-forget the latest state.
  useEffect(() => {
    return () => {
      flushPendingSave(dirtyRef, reportRef, (r) => void doSave(r))
    }
  }, [doSave])

  const mutate = useCallback((producer: (r: QaReport) => QaReport) => {
    const prev = reportRef.current
    if (!prev || prev.completedAt) return
    const next = producer(prev)
    if (next === prev) return
    reportRef.current = next
    setReport(next)
    setRev((r) => r + 1)
  }, [])

  // ---- width drives the margin plane ---------------------------------------
  useEffect(() => {
    if (!wrapEl) return
    const ro = new ResizeObserver((obsEntries) => {
      for (const entry of obsEntries) setWide(entry.contentRect.width >= WIDE_BREAKPOINT)
    })
    ro.observe(wrapEl)
    return () => ro.disconnect()
  }, [wrapEl])

  // ---- scroll-spy ----------------------------------------------------------
  const spy = useCallback(() => {
    if (!scrollEl || !docEl) return
    const sr = scrollEl.getBoundingClientRect()
    let cur: string | null = headings.length > 0 ? headings[0].id : null
    for (const h of Array.from(docEl.querySelectorAll<HTMLElement>('[data-sec]'))) {
      if (h.getBoundingClientRect().top - sr.top <= 90) cur = h.dataset.sec ?? cur
    }
    currentSecRef.current = cur
    setCurrentSec(cur)
    // The decision the rail points at: the last one at or above the top edge,
    // else the first. A jump from the rail holds its choice while the smooth
    // scroll settles (the last decisions may not reach the top edge).
    if (Date.now() >= decisionLockRef.current) {
      const cards = Array.from(docEl.querySelectorAll<HTMLElement>('[data-decision]'))
      let curDec: string | null = cards.length > 0 ? (cards[0].dataset.decision ?? null) : null
      for (const c of cards) {
        if (c.getBoundingClientRect().top - sr.top <= 90) curDec = c.dataset.decision ?? curDec
      }
      setCurDecision(curDec)
    }
  }, [scrollEl, docEl, headings])

  useEffect(() => {
    if (!scrollEl) return
    // Initial spy runs off-frame — a synchronous setState in an effect body
    // cascades renders (lint law); scrolling then keeps it current.
    const raf = requestAnimationFrame(spy)
    scrollEl.addEventListener('scroll', spy)
    return () => {
      cancelAnimationFrame(raf)
      scrollEl.removeEventListener('scroll', spy)
    }
  }, [scrollEl, spy])

  const scrollToSec = useCallback(
    (sec: string) => {
      if (!scrollEl || !docEl) return
      const h = docEl.querySelector(`[data-sec="${sec}"]`)
      if (!h) return
      const sr = scrollEl.getBoundingClientRect()
      scrollEl.scrollTo({
        top: scrollEl.scrollTop + h.getBoundingClientRect().top - sr.top - 14,
        behavior: 'smooth'
      })
    },
    [scrollEl, docEl]
  )

  const jumpToDecision = useCallback(
    (id: string) => {
      setRailListOpen(false)
      setCurDecision(id)
      decisionLockRef.current = Date.now() + 900
      if (!scrollEl || !docEl) return
      const card = Array.from(docEl.querySelectorAll<HTMLElement>('[data-decision]')).find(
        (c) => c.dataset.decision === id
      )
      if (!card) return
      const sr = scrollEl.getBoundingClientRect()
      scrollEl.scrollTo({
        top: scrollEl.scrollTop + card.getBoundingClientRect().top - sr.top - 14,
        behavior: 'smooth'
      })
    },
    [scrollEl, docEl]
  )

  useEffect(() => {
    if (!progressKey) return
    let current = true
    void window.qa
      .getReadingProgress()
      .then((state) => {
        if (current) setStoredProgress(state[progressKey] ?? null)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [progressKey])

  useEffect(() => {
    if (restoredProgressRef.current || !scrollEl || !docEl || !storedProgress) return
    const resolved = resolveReadingPosition(headings, storedProgress)
    if (!resolved) return
    const heading = docEl.querySelector<HTMLElement>(`[data-sec="${resolved.sectionSlug}"]`)
    if (!heading) return
    const scrollRect = scrollEl.getBoundingClientRect()
    scrollEl.scrollTo({
      top: scrollEl.scrollTop + heading.getBoundingClientRect().top - scrollRect.top - 14
    })
    restoredProgressRef.current = true
  }, [docEl, headings, scrollEl, storedProgress])

  useEffect(() => {
    return () => {
      if (!progressKey) return
      const sectionSlug = currentSecRef.current
      const sectionIndex = headings.findIndex((heading) => heading.id === sectionSlug)
      if (!sectionSlug || sectionIndex < 0) return
      void window.qa.setReadingProgress(progressKey, {
        sectionSlug,
        sectionIndex,
        sectionCount: headings.length
      })
    }
  }, [headings, progressKey])

  // ---- active linking + flash round-trips (T5) -----------------------------
  const goToCard = useCallback(
    (key: string) => {
      setActive(key)
      if (compact) {
        setPanelOpen(true)
        setTimeout(() => {
          const c = panelEl?.querySelector(`.mcard[data-key="${key}"]`)
          c?.scrollIntoView({ block: 'nearest' })
          flash(c ?? null)
        }, 0)
        return
      }
      const c = flowEl?.querySelector(`.mcard[data-key="${key}"]`)
      c?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      flash(c ?? null)
    },
    [compact, flowEl, panelEl]
  )

  const anchorElFor = useCallback(
    (key: string): Element | null => {
      if (!docEl) return null
      if (key.startsWith('c')) {
        const n = Number(key.slice(1))
        const el = docEl.querySelector(`.anch[data-cid="${n}"]`)
        if (el) return el
        // Unresolved quote → its section heading; section-less → the title.
        const q = quotes.find((qq) => (qq.number ?? 0) === n)
        if (q?.section) return docEl.querySelector(`[data-sec="${q.section}"]`)
        return docEl.querySelector('h1') ?? docEl.firstElementChild
      }
      return docEl.querySelector(`[data-sec="${key.slice(3)}"]`)
    },
    [docEl, quotes]
  )

  const goToAnchor = useCallback(
    (key: string) => {
      setActive(key)
      const el = anchorElFor(key)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      flash(el)
    },
    [anchorElFor]
  )

  const jumpTo = useCallback(
    (n: number) => {
      if (!quotes.some((q) => (q.number ?? 0) === n)) return
      goToAnchor(`c${n}`)
      if (compact) {
        setPanelOpen(true)
        setTimeout(() => {
          const c = panelEl?.querySelector(`.mcard[data-key="c${n}"]`)
          c?.scrollIntoView({ block: 'nearest' })
          flash(c ?? null)
        }, 0)
      } else {
        flash(flowEl?.querySelector(`.mcard[data-key="c${n}"]`) ?? null)
      }
    },
    [quotes, goToAnchor, compact, panelEl, flowEl]
  )

  // ---- quoting (T4) --------------------------------------------------------
  const computeSelection = useCallback((): QuoteHint | null => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    const anc = range.commonAncestorContainer
    const el = anc.nodeType === 1 ? (anc as Element) : anc.parentElement
    if (!el?.closest('.readdoc')) return null
    const raw = sel.toString()
    if (!raw.trim()) return null
    const sc = range.startContainer
    const ec = range.endContainer
    const before = sc.nodeType === 3 ? (sc.textContent ?? '').slice(0, range.startOffset) : ''
    const after = ec.nodeType === 3 ? (ec.textContent ?? '').slice(range.endOffset) : ''
    // Section = nearest preceding (or containing) H2/H3 of the anchor.
    let section: string | null = null
    if (docEl) {
      const startEl = sc.nodeType === 1 ? (sc as Element) : sc.parentElement
      for (const h of Array.from(docEl.querySelectorAll('[data-sec]'))) {
        if (!startEl) break
        const pos = h.compareDocumentPosition(startEl)
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(startEl)) {
          section = h.getAttribute('data-sec')
        }
      }
    }
    const rect = range.getBoundingClientRect()
    return { raw, before, after, section, left: rect.left + rect.width / 2, top: rect.top }
  }, [docEl])

  const addFromSelection = useCallback(
    (hint: QuoteHint | null) => {
      if (!hint) return
      const prev = reportRef.current
      const num = nextMarkerNumber(documentItem(prev)?.quotes ?? [])
      mutate((r) =>
        addReviewQuote(r, hint.raw, { before: hint.before, after: hint.after }, hint.section)
      )
      if (reportRef.current === prev) return // selection trimmed to nothing
      window.getSelection()?.removeAllRanges()
      setQuoteHint(null)
      setHintSeen(true)
      setActive(`c${num}`)
      if (compact) setPanelOpen(true)
      // Comment field takes focus on creation (the v1 flag-focus pattern).
      setTimeout(() => {
        relayoutRef.current()
        document.querySelector<HTMLTextAreaElement>(`[data-ctext="${num}"]`)?.focus()
      }, 0)
    },
    [mutate, compact]
  )

  useEffect(() => {
    if (readOnly) return
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
  }, [readOnly, computeSelection])

  // ---- section marks (T5) --------------------------------------------------
  const toggleMarkCurrent = useCallback(() => {
    const sec = currentSecRef.current
    if (!sec) return
    mutate((r) => toggleSectionMark(r, sec))
  }, [mutate])

  // ---- disposition (T6) ----------------------------------------------------
  const setDisp = useCallback(
    (v: Verdict, viaKey: boolean) => {
      mutate((r) => setDisposition(r, v))
      setDispOpen(false)
      if (viaKey && dispChipRef.current) {
        const chip = dispChipRef.current
        chip.classList.remove('pulse')
        void chip.offsetWidth
        chip.classList.add('pulse')
      }
    },
    [mutate]
  )

  // Picking on the Finish sheet writes the verdict and leaves the sheet open —
  // he sees what he chose before confirming. Same toggle law as the chip
  // (re-picking the live verdict flips back to unanswered, ADR-0007 §2); no
  // chip pulse — the chip is behind the overlay.
  const pickSheetDisposition = useCallback(
    (v: Verdict) => mutate((r) => setDisposition(r, v)),
    [mutate]
  )

  // ---- finish / reopen (T7) ------------------------------------------------
  const doFinish = useCallback(async () => {
    setConfirmOpen(false)
    let snap = reportRef.current
    if (!snap || snap.completedAt) return
    // No disposition → Not reviewed goes on the wire (ADR-0008 §2).
    if (documentItem(snap)?.status === 'unanswered') snap = setDisposition(snap, 'skip')
    try {
      const result = await window.qa.finishRun(path, snap)
      const validated = validateReportMutationResult(result)
      if (!validated.report) {
        setSaveError(validated.error)
        return
      }
      const stamped = validated.report
      dirtyRef.current = false
      reportRef.current = stamped
      setReport(stamped)
      setDispOpen(false)
      setPanelOpen(false)
      // The report is on disk, so the prompt is a courtesy on top of it: the
      // helper catches its own failures and the finish stands either way.
      await copyCollectPromptAfterFinish(path, request.title, showToast)
    } catch (error) {
      setSaveError(reportDisplayError(error))
    }
  }, [path, request, showToast])

  const requestFinish = useCallback(() => {
    if (reportRef.current?.completedAt) return
    setConfirmOpen(true)
  }, [])

  const doReopen = useCallback(async () => {
    try {
      const result = await window.qa.reopenRun(path)
      const validated = validateReportMutationResult(result)
      if (!validated.report) {
        setSaveError(validated.error)
        return
      }
      const cleared = validated.report
      reportRef.current = cleared
      setReport(cleared)
    } catch (error) {
      setSaveError(reportDisplayError(error))
    }
  }, [path])

  // ---- margin layout (T5): measure anchors, stack cards, draw elbows -------
  const relayout = useCallback(() => {
    if (!marginPlane || !flowEl || !docEl) return
    // Size every comment box to its content first — card heights feed the maths.
    for (const t of Array.from(flowEl.querySelectorAll<HTMLTextAreaElement>('.mcard .ctext'))) {
      autoGrow(t)
    }
    const fr = flowEl.getBoundingClientRect()
    const mhead = flowEl.querySelector<HTMLElement>('.mhead')
    const minTop = (mhead?.offsetHeight ?? 0) + 14
    const measured: {
      key: string
      card: HTMLElement
      anchorRect: DOMRect
      anchorTop: number
      height: number
    }[] = []
    for (const e of entries) {
      const card = flowEl.querySelector<HTMLElement>(`.mcard[data-key="${e.key}"]`)
      const anchor = anchorElFor(e.key)
      if (!card || !anchor) continue
      const ar = anchor.getBoundingClientRect()
      measured.push({
        key: e.key,
        card,
        anchorRect: ar,
        anchorTop: ar.top - fr.top,
        height: card.offsetHeight
      })
    }
    const tops = layoutMarginTops(measured, minTop)
    measured.forEach((m, i) => {
      const top = tops[i]
      m.card.style.top = `${top}px`
      // Elbow connector: h1 at the anchor line, vertical drop, h2 into the card.
      const ay = m.anchorRect.top - fr.top + m.anchorRect.height / 2
      const cy = top + 14
      const cardLeft = m.card.getBoundingClientRect().left - fr.left
      const x1 = m.anchorRect.right - fr.left + 5
      const bend = cardLeft - 10
      const segs = flowEl.querySelectorAll<HTMLElement>(`[data-conn="${m.key}"]`)
      if (segs.length < 3) return
      const [h1, v, h2] = [segs[0], segs[1], segs[2]]
      h1.style.top = `${ay}px`
      h1.style.left = `${x1}px`
      h1.style.width = `${Math.max(bend - x1, 0)}px`
      v.style.left = `${bend}px`
      v.style.top = `${Math.min(ay, cy)}px`
      v.style.height = `${Math.abs(cy - ay)}px`
      h2.style.top = `${cy}px`
      h2.style.left = `${bend}px`
      h2.style.width = `${Math.max(cardLeft - bend, 0)}px`
    })
  }, [marginPlane, flowEl, docEl, entries, anchorElFor])
  useLayoutEffect(() => {
    relayoutRef.current = relayout
    relayout()
  }, [relayout, report, readOnly])

  // Re-lay the margin whenever the document column reflows (window resize,
  // rail width change) — anchor positions move with the text.
  useEffect(() => {
    if (!flowEl) return
    const ro = new ResizeObserver(() => relayoutRef.current())
    ro.observe(flowEl)
    return () => ro.disconnect()
  }, [flowEl])

  // Panel comment boxes size themselves the same way (narrow ledger).
  useLayoutEffect(() => {
    if (!panelEl) return
    for (const t of Array.from(panelEl.querySelectorAll<HTMLTextAreaElement>('.mcard .ctext'))) {
      autoGrow(t)
    }
  }, [panelEl, entries, report, panelOpen])

  const commandEnabled =
    !confirmOpen && !zoom && !helpOpen && !switcherOpen && !compareId && !lightbox && !markupSession
  // ---- mark-up (ticket 30) -------------------------------------------------
  const openDecisionMarkup = (id: string, option: number, pictureIndex: number): void => {
    const info = decisionInfo.get(id)
    const pic = info?.pictures[option]?.[pictureIndex]
    if (!info || !pic || readOnly) return
    const picture = pictureKey(pic.src)
    if (!isMarkablePicture(picture)) return
    const existing = decisionMap.get(id)?.markups?.find((m) => m.picture === picture)
    setLightbox(null)
    setZoom(null)
    setMarkupSession({
      eyebrow: optionShortLabel(info.options[option]),
      title: info.question,
      requestPath: path,
      picture,
      itemId: DOCUMENT_ITEM_ID,
      option: info.options[option],
      marks: existing?.marks ?? [],
      onSaved: (markup) =>
        mutate((r) =>
          setDecisionMarkup(r, DOCUMENT_ITEM_ID, { id, question: info.question }, picture, markup)
        )
    })
  }
  const openShotMarkup = (rel: string): void => {
    if (readOnly) return
    setZoom(null)
    setMarkupSession(
      screenshotSession({
        requestPath: path,
        itemId: DOCUMENT_ITEM_ID,
        rel,
        title: request.title,
        existing: item?.markups?.find((m) => m.picture === rel),
        onSaved: (markup) =>
          mutate((r) => setShotMarkup(r, { kind: 'item', id: DOCUMENT_ITEM_ID }, rel, markup))
      })
    )
  }
  const lightboxPicture = (() => {
    if (!lightbox) return null
    const info = decisionInfo.get(lightbox.id)
    if (!info) return null
    const flat = info.pictured.flatMap((o) => info.pictures[o].map((pic, i) => ({ o, i, pic })))
    if (flat.length === 0) return null
    const at = flat[((lightbox.index % flat.length) + flat.length) % flat.length]
    return isMarkablePicture(pictureKey(at.pic.src)) ? at : null
  })()
  const stepLightbox = (by: number): void => {
    if (!lightbox) return
    const info = decisionInfo.get(lightbox.id)
    if (!info) return
    const n = info.pictured.reduce((sum, o) => sum + info.pictures[o].length, 0)
    if (n > 1) setLightbox({ id: lightbox.id, index: (((lightbox.index + by) % n) + n) % n })
  }
  // The compare command opens the decision the rail points at, or the first
  // decision that has pictures when that one has none.
  const compareTarget =
    decisions.find((d) => d.id === curDecision && d.pictured.length > 0) ??
    decisions.find((d) => d.pictured.length > 0) ??
    null
  const reviewEditable = commandEnabled && !report.completedAt
  // With the sheet open the disposition keys stay live: its rows advertise
  // P/N/F/S, so the keys must reach the sheet's pick — which leaves the sheet
  // open — rather than the chip pulse hidden behind the overlay.
  const dispositionKeyable = reviewEditable || confirmOpen
  useCommandScope({
    'review.finish-confirm': {
      enabled: confirmOpen,
      priority: 90,
      handler: (event) => {
        // Enter activates whatever sheet control holds focus — a disposition
        // row, "Keep reviewing" — and only finishes when none does. Without
        // this, tabbing to a row and pressing Enter would finish the review
        // under his hand. In the comments box the command never fires at all
        // (the text-entry law), so Enter stays a newline there.
        const focused = document.activeElement
        if (event && focused instanceof HTMLButtonElement && focused.closest('.sheet.confirm')) {
          focused.click()
          return
        }
        void doFinish()
      }
    },
    'app.close-back': {
      enabled:
        confirmOpen ||
        !!zoom ||
        !!lightbox ||
        !!compareId ||
        railListOpen ||
        dispOpen ||
        (compact && effectivePanelOpen) ||
        !!active,
      priority: 90,
      handler: () => {
        if (confirmOpen) {
          // Esc in the comments box blurs the box first — a stray Esc while
          // typing must not throw the sheet away mid-sentence; the second Esc
          // is the cancel.
          const box = document.activeElement
          if (box instanceof HTMLTextAreaElement && box.closest('.sheet.confirm')) {
            box.blur()
            return
          }
          setConfirmOpen(false)
        } else if (zoom) setZoom(null)
        else if (lightbox) setLightbox(null)
        else if (compareId) setCompareId(null)
        else if (railListOpen) setRailListOpen(false)
        else if (dispOpen) setDispOpen(false)
        else if (compact && effectivePanelOpen) setPanelOpen(false)
        else setActive(null)
      }
    },
    'markup.open': {
      enabled: !readOnly && !markupSession && (!!zoom?.rel || !!lightboxPicture),
      priority: 90,
      handler: () => {
        if (zoom?.rel) openShotMarkup(zoom.rel)
        else if (lightbox && lightboxPicture)
          openDecisionMarkup(lightbox.id, lightboxPicture.o, lightboxPicture.i)
      }
    },
    'review.compare-decision': {
      enabled: commandEnabled && !!compareTarget,
      handler: () => compareTarget && setCompareId(compareTarget.id)
    },
    'review.picture-previous': {
      enabled: !!lightbox,
      priority: 90,
      handler: () => stepLightbox(-1)
    },
    'review.picture-next': {
      enabled: !!lightbox,
      priority: 90,
      handler: () => stepLightbox(1)
    },
    'review.finish': { enabled: commandEnabled, handler: requestFinish },
    'review.reopen': {
      enabled: commandEnabled && !!report.completedAt,
      handler: () => void doReopen()
    },
    'review.jump-comment': {
      enabled: commandEnabled,
      handler: (event) => event && jumpTo(Number(event.key))
    },
    'review.toggle-ledger': {
      enabled: commandEnabled,
      handler: () => {
        if (ledgerChosen) {
          setPanelOpen(false)
          setRightPanel('closed')
        } else {
          setRightPanel('ledger')
          if (!wide) setPanelOpen(true)
        }
      }
    },
    'review.quote': {
      enabled: reviewEditable,
      handler: () => addFromSelection(computeSelection() ?? quoteHint)
    },
    'review.mark-section': { enabled: reviewEditable, handler: toggleMarkCurrent },
    'review.approve': {
      enabled: dispositionKeyable,
      handler: () => (confirmOpen ? pickSheetDisposition('pass') : setDisp('pass', true))
    },
    'review.approve-changes': {
      enabled: dispositionKeyable,
      handler: () => (confirmOpen ? pickSheetDisposition('partial') : setDisp('partial', true))
    },
    'review.needs-rework': {
      enabled: dispositionKeyable,
      handler: () => (confirmOpen ? pickSheetDisposition('fail') : setDisp('fail', true))
    },
    'review.not-reviewed': {
      enabled: dispositionKeyable,
      handler: () => (confirmOpen ? pickSheetDisposition('skip') : setDisp('skip', true))
    }
  })

  // ---- derived chrome ------------------------------------------------------
  const fileBase = basename(path)
  const finishedClock = formatClock(report.completedAt ?? null)
  const savedClock = savedAt ? formatClock(savedAt) : '—'
  const statusLine = readOnly
    ? `${fileBase} · finished ${finishedClock} · report ready`
    : `${fileBase} · saved ${savedClock}`
  const countsText =
    `${quotes.length} comment${quotes.length === 1 ? '' : 's'}` +
    (marks.length > 0 ? ` · ${marks.length} section mark${marks.length === 1 ? '' : 's'}` : '')
  const projectSlug = useMemo(() => {
    const root = snapshot?.root
    if (!root || !path.startsWith(`${root}/`)) return null
    return path.slice(root.length + 1).split('/')[0] ?? null
  }, [snapshot, path])
  const dispDef = DISPOSITIONS.find((d) => d.v === item?.status) ?? null
  const requestDate = request.date ?? request.labels.date

  const markedSections = useMemo(() => new Set(marks.map((m) => m.section)), [marks])
  const quoteCountBySection = useMemo(() => {
    const map = new Map<string | null, number>()
    for (const q of quotes) {
      const sec = q.section ?? null
      map.set(sec, (map.get(sec) ?? 0) + 1)
    }
    return map
  }, [quotes])

  const onRemoveEntry = useCallback(
    (entry: LedgerEntry) => {
      if (entry.kind === 'quote') mutate((r) => removeReviewQuote(r, entry.quote.number ?? 0))
      else mutate((r) => toggleSectionMark(r, entry.mark.section))
      setActive((a) => (a === entry.key ? null : a))
      setTimeout(() => relayoutRef.current(), 0)
    },
    [mutate]
  )
  const onEntryComment = useCallback(
    (entry: LedgerEntry, text: string) => {
      if (entry.kind === 'quote')
        mutate((r) => setReviewQuoteComment(r, entry.quote.number ?? 0, text))
      else mutate((r) => setSectionMarkComment(r, entry.mark.section, text))
    },
    [mutate]
  )
  const onDecision = useCallback(
    (id: string, question: string, choice: string) =>
      mutate((r) => setDecisionChoice(r, id, question, choice)),
    [mutate]
  )
  const onDecisionComment = useCallback(
    (id: string, question: string, text: string) =>
      mutate((r) => setDecisionComment(r, id, question, text)),
    [mutate]
  )

  // ---- screenshots (attach to the single 'document' item) ------------------
  const ingestImage = useCallback(
    async (file: File | null) => {
      if (!file) return
      const base64 = await blobToPngBase64(file)
      if (!base64) {
        showToast('That image could not be read')
        return
      }
      try {
        const rel = await window.qa.addShot(path, DOCUMENT_ITEM_ID, base64)
        mutate((r) => addScreenshot(r, DOCUMENT_ITEM_ID, rel))
      } catch {
        showToast('That image could not be saved')
      }
    },
    [path, mutate, showToast]
  )
  const onRemoveShot = useCallback(
    (rel: string) => mutate((r) => removeScreenshot(r, DOCUMENT_ITEM_ID, rel)),
    [mutate]
  )

  // Paste anywhere in a review attaches a screenshot to the document — the one
  // thing the shared Runner paste path deliberately skips for reviews.
  useEffect(() => {
    if (readOnly) return
    function onPaste(e: ClipboardEvent): void {
      if (markupOpenRef.current) return
      const file = firstImageFile(e.clipboardData?.items ?? null)
      if (!file) return
      e.preventDefault()
      void ingestImage(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [readOnly, ingestImage])

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
          : (saveError.message ?? `Could not save to ${fileBase.replace(/\.md$/, '')}.report.json`)}
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
        <button className="retry" onClick={() => void doSave(reportRef.current ?? report)}>
          <RotateCw className="ic s" strokeWidth={2} />
          Retry
        </button>
      )}
    </div>
  )

  const dispositionRows = (
    <div className="disprows" role="group" aria-label="Disposition">
      {DISPOSITIONS.map(({ v, label, key, Icon }) => (
        <button
          key={v}
          className={`drow${item?.status === v ? ` sel-${v}` : ''}`}
          onClick={() => setDisp(v, false)}
        >
          <Icon strokeWidth={2} />
          <span className="grow">{label}</span>
          <kbd>{key}</kbd>
        </button>
      ))}
    </div>
  )

  const dispositionChip = (
    <button
      ref={dispChipRef}
      className={`dispchip ${dispDef ? `set-${dispDef.v}` : 'unset'}`}
      aria-haspopup="true"
      aria-expanded={dispOpen}
      aria-label="Disposition"
      onClick={() => {
        if (!readOnly) setDispOpen((o) => !o)
      }}
    >
      {dispDef ? <dispDef.Icon strokeWidth={2} /> : <MinusCircle strokeWidth={2} />}
      <span className="grow">{dispDef ? dispDef.label : 'Not yet given'}</span>
    </button>
  )

  const renderCard = (entry: LedgerEntry): React.JSX.Element => (
    <MarginCard
      key={entry.key}
      entry={entry}
      sectionTitle={sectionTitle}
      active={active === entry.key}
      readOnly={readOnly}
      onOpenAnchor={() => goToAnchor(entry.key)}
      onActivate={() => setActive(entry.key)}
      onRemove={() => onRemoveEntry(entry)}
      onComment={(text) => onEntryComment(entry, text)}
      onGrew={() => relayoutRef.current()}
    />
  )

  return (
    <div
      className={`view readwrap ${readingTextSizeClass(settings?.readingTextSize)}${wide ? ' wide' : ''}${readOnly ? ' done' : ''}`}
      ref={setWrapEl}
    >
      <div className="vhead">
        <button className="backbtn" aria-label="Back to previous view" onClick={back}>
          <ArrowLeft className="ic" strokeWidth={2} />
        </button>
        <div className="grow">
          <div className="vt rt">{request.title}</div>
          <div className="chiprow">
            {projectSlug && <span className="chip mono">{projectSlug}</span>}
            <span className="chip">doc-review</span>
            {request.labels.source && (
              <span className="chip src" title={request.labels.source}>
                {request.labels.source}
              </span>
            )}
            {request.labels.commit && <span className="chip mono">{request.labels.commit}</span>}
            {wide && requestDate && <span className="chip mono">{requestDate}</span>}
          </div>
          {request.fmSalvaged && (
            <div className="fmnote">
              Frontmatter recovered leniently — some labels may be missing.
            </div>
          )}
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
        {readOnly && (
          <>
            <button className="ghostbtn" onClick={() => void doReopen()}>
              <RotateCw className="ic s" strokeWidth={2} />
              Reopen
            </button>
          </>
        )}
        {wide && (
          <button
            className="cbtn"
            aria-label={
              !ledgerChosen || collapsed
                ? 'Show the comments margin'
                : 'Collapse the comments margin'
            }
            aria-pressed={ledgerChosen && !collapsed}
            title={
              !ledgerChosen || collapsed
                ? 'Show the comments margin'
                : 'Collapse the comments margin'
            }
            onClick={() => setMargin(!ledgerChosen || collapsed ? 'open' : 'collapsed')}
          >
            {!ledgerChosen || collapsed ? (
              <PanelRightOpen className="ic s" strokeWidth={2} />
            ) : (
              <PanelRightClose className="ic s" strokeWidth={2} />
            )}
          </button>
        )}
        {compact && (
          <button
            className="cbtn"
            aria-label="Open the ledger"
            title="Ledger (L)"
            onClick={() => {
              setRightPanel('ledger')
              setPanelOpen(true)
            }}
          >
            <MessageSquare className="ic s" strokeWidth={2} />
            <span className="cnt">{entryCount}</span>
          </button>
        )}
      </div>

      {banner}

      {compact && (
        <div className="hintline" hidden={hintSeen || readOnly}>
          <QuoteIcon strokeWidth={2} />
          <span>
            Select a line and press <kbd>Q</kbd> — your comment lands in the ledger.
          </span>
        </div>
      )}

      {(screenshots.length > 0 || !readOnly) && (
        <div className="readshots">
          <span className="rslbl">
            <ImageIcon strokeWidth={2} />
            Screenshots
          </span>
          <ShotStrip
            requestPath={path}
            screenshots={screenshots}
            readOnly={readOnly}
            onZoom={(url, name, rel) => setZoom({ url, name, rel })}
            onRemove={onRemoveShot}
            onPasteHint={() => showToast('Paste with ⌘V to attach a screenshot')}
          />
        </div>
      )}
      {markupsFor(item ?? undefined).length > 0 && (
        <div className="readshots-marks">
          <MarkedPictures
            requestPath={path}
            markups={markupsFor(item ?? undefined)}
            readOnly={readOnly}
            caption={(m) => m.picture.split('/').pop() ?? m.picture}
            onEdit={(m) => openShotMarkup(m.picture)}
            onZoom={(url, name) => setZoom({ url, name })}
          />
        </div>
      )}

      <div className="readbody">
        <nav className={`rail${decisions.length > 0 ? ' hasdec' : ''}`} aria-label="Sections">
          {decisions.length > 0 &&
            (wide ? (
              <DecisionProgress decisions={decisions} answers={decisionMap} />
            ) : (
              <DecisionRailButton
                decisions={decisions}
                answers={decisionMap}
                open={railListOpen}
                onToggle={() => setRailListOpen((v) => !v)}
              />
            ))}
          <div className="toclist">
            <DecisionRailRows
              decisions={decisionsBySection.get(null) ?? []}
              answers={decisionMap}
              wide={wide}
              current={curDecision}
              onJump={jumpToDecision}
            />
            {headings.map((h) => {
              const count = quoteCountBySection.get(h.id) ?? 0
              return (
                <Fragment key={h.id}>
                  <button
                    className={`toc${h.level === 3 ? ' sub' : ''}${count > 0 ? ' has-c' : ''}${
                      markedSections.has(h.id) ? ' marked' : ''
                    }${currentSec === h.id ? ' cur' : ''}`}
                    title={h.title}
                    onClick={() => scrollToSec(h.id)}
                  >
                    <span className="bar" />
                    <span className="tlbl">{h.title}</span>
                    {count > 0 && <span className="tcnt">{count}</span>}
                    <span className="tflag">
                      <Flag strokeWidth={2} />
                    </span>
                  </button>
                  <DecisionRailRows
                    decisions={decisionsBySection.get(h.id) ?? []}
                    answers={decisionMap}
                    wide={wide}
                    current={curDecision}
                    onJump={jumpToDecision}
                  />
                </Fragment>
              )
            })}
          </div>
          {wide && (
            <div className="dispodock">
              <div className="deye">Disposition</div>
              {dispositionChip}
              {dispOpen && dispositionRows}
            </div>
          )}
        </nav>

        {!wide && railListOpen && decisions.length > 0 && (
          <DecisionPopover
            decisions={decisions}
            answers={decisionMap}
            headings={headings}
            current={curDecision}
            onJump={jumpToDecision}
            onClose={() => setRailListOpen(false)}
          />
        )}

        <div className="scroll" ref={setScrollEl}>
          <div className="flow" ref={setFlowEl}>
            <div className="doccol">
              <div
                className="doc readdoc quotable"
                ref={setDocEl}
                data-find-scope
                // Any picture in the document opens large. Delegated, so
                // every image the document renders gets it.
                onClick={(event) => {
                  const target = event.target as HTMLElement
                  if (target instanceof HTMLImageElement && target.classList.contains('docimg'))
                    setZoom({ url: target.currentSrc || target.src, name: target.alt || 'image' })
                }}
              >
                <div className="deyebrow">
                  {request.labels.commit
                    ? `Snapshot · frozen at ${request.labels.commit}`
                    : 'Snapshot'}
                </div>
                <DocBody
                  requestPath={path}
                  imageSourceCacheRef={documentImageSourceCacheRef}
                  blocks={blocks}
                  spotsByPath={spotsByPath}
                  fallbackBySection={fallbackBySection}
                  markedSections={markedSections}
                  decisions={decisionMap}
                  active={active}
                  wide={marginPlane}
                  readOnly={readOnly}
                  decisionsInteractive
                  onAnchorClick={goToCard}
                  onMarkToggle={(sec) => mutate((r) => toggleSectionMark(r, sec))}
                  onMarkOpen={(sec) => goToCard(`sm-${sec}`)}
                  onDecision={onDecision}
                  onDecisionComment={onDecisionComment}
                  decisionUi={{
                    info: decisionInfo,
                    current: curDecision,
                    images: { cacheRef: documentImageSourceCacheRef, requestPath: path },
                    onCompare: setCompareId,
                    onEditMarks: (id, markup) => {
                      const info = decisionInfo.get(id)
                      if (!info) return
                      const at = (o: number): number =>
                        info.pictures[o]?.findIndex((p) => pictureKey(p.src) === markup.picture) ??
                        -1
                      // The option label may have been reworded since: fall back to the picture.
                      let option = info.options.indexOf(markup.option ?? '')
                      if (option < 0 || at(option) < 0) {
                        option = info.options.findIndex((_, o) => at(o) >= 0)
                      }
                      if (option >= 0) openDecisionMarkup(id, option, at(option))
                    },
                    onZoom: (url, name) => setZoom({ url, name }),
                    onEnlarge: (id, option, picture) => {
                      const info = decisionInfo.get(id)
                      if (!info) return
                      let index = picture
                      for (const o of info.pictured) {
                        if (o >= option) break
                        index += info.pictures[o].length
                      }
                      setLightbox({ id, index })
                    }
                  }}
                />
              </div>
            </div>
            {marginPlane && (
              <div className="margincol">
                <div className="mhead">
                  <span className="lbl">Comments</span>
                  <span className="counts">{countsText}</span>
                </div>
                {entries.length === 0 && !readOnly && (
                  <div className="minvite">
                    <div className="t">
                      <QuoteIcon strokeWidth={2} />
                      Nothing in the margin yet
                    </div>
                    <p>
                      Select a line and press <kbd>Q</kbd> — your comment lands here, anchored to
                      what it quotes.
                    </p>
                    <p>
                      Press <kbd>M</kbd> on a section to mark the whole section needs-work.
                    </p>
                  </div>
                )}
              </div>
            )}
            {marginPlane && entries.map(renderCard)}
            {marginPlane &&
              entries.map((e) => {
                const tone = e.kind === 'mark' ? ' amb' : ''
                const act = active === e.key ? ' act' : ''
                return (
                  <Fragment key={`conn-${e.key}`}>
                    <div className={`conn-h a1${tone}${act}`} data-conn={e.key} />
                    <div className={`conn-v${tone}${act}`} data-conn={e.key} />
                    <div className={`conn-h a2${tone}${act}`} data-conn={e.key} />
                  </Fragment>
                )
              })}
          </div>
        </div>

        {compact && (
          <>
            <div
              className={`scrim${effectivePanelOpen ? ' open' : ''}`}
              onClick={() => setPanelOpen(false)}
            />
            <aside
              className={`panel${effectivePanelOpen ? ' open' : ''}`}
              aria-label="Ledger"
              ref={setPanelEl}
            >
              <div className="phead">
                <span className="pt">Comments</span>
                <span className="count-pill">{entryCount}</span>
                <button className="iconbtn" aria-label="Close" onClick={() => setPanelOpen(false)}>
                  <X className="ic" strokeWidth={2} />
                </button>
              </div>
              <div className="plist">
                {entries.length > 0 ? (
                  entries.map(renderCard)
                ) : (
                  <div className="pempty">
                    Nothing here yet.
                    <br />
                    Select a line in the document and press <kbd>Q</kbd> — the comment lands in this
                    ledger, numbered at its anchor.
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>

      <div className="readfoot">
        <span className="status">{statusLine}</span>
        {!wide && dispositionChip}
        {readOnly ? (
          <span className="done-pill">
            <BadgeCheck className="ic s" strokeWidth={2} />
            Finished {finishedClock}
          </span>
        ) : (
          <button className="outbtn sm" onClick={requestFinish}>
            Finish review
          </button>
        )}
        {!wide && dispOpen && (
          <div className="dflyout" role="group" aria-label="Disposition">
            <div className="deye">Disposition</div>
            {dispositionRows}
          </div>
        )}
      </div>

      {confirmOpen && (
        <ReviewFinishConfirm
          dispositionLabel={dispDef?.label ?? null}
          current={item && item.status !== 'unanswered' ? item.status : null}
          comment={item?.comment ?? ''}
          comments={quotes.length}
          sectionMarks={marks.length}
          onPick={pickSheetDisposition}
          onCommentChange={(text) => mutate((r) => setDocumentComment(r, text))}
          onConfirm={() => void doFinish()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}

      {compareId && decisionInfo.get(compareId) && (
        <DecisionCompare
          info={decisionInfo.get(compareId) as DecisionInfo}
          answer={decisionMap.get(compareId)}
          readOnly={readOnly}
          images={{ cacheRef: documentImageSourceCacheRef, requestPath: path }}
          onChoice={(choice) =>
            onDecision(compareId, (decisionInfo.get(compareId) as DecisionInfo).question, choice)
          }
          onComment={(text) =>
            onDecisionComment(
              compareId,
              (decisionInfo.get(compareId) as DecisionInfo).question,
              text
            )
          }
          onClose={() => setCompareId(null)}
          onZoom={(url, name) => setZoom({ url, name })}
          onMarkUp={(option, picture) => openDecisionMarkup(compareId, option, picture)}
        />
      )}

      {lightbox && decisionInfo.get(lightbox.id) && (
        <DecisionLightbox
          info={decisionInfo.get(lightbox.id) as DecisionInfo}
          answer={decisionMap.get(lightbox.id)}
          readOnly={readOnly}
          images={{ cacheRef: documentImageSourceCacheRef, requestPath: path }}
          start={lightbox.index}
          onChoice={(choice) =>
            onDecision(
              lightbox.id,
              (decisionInfo.get(lightbox.id) as DecisionInfo).question,
              choice
            )
          }
          onStep={(index) => setLightbox({ id: lightbox.id, index })}
          onClose={() => setLightbox(null)}
          onMarkUp={(option, picture) => openDecisionMarkup(lightbox.id, option, picture)}
        />
      )}

      {zoom && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Image ${zoom.name}`}
          onClick={() => setZoom(null)}
        >
          <img className="zoomimg" src={zoom.url} alt={zoom.name} />
          {zoom.rel && !readOnly && (
            <ZoomMarkUpBar
              marked={!!item?.markups?.some((m) => m.picture === zoom.rel)}
              onMarkUp={() => zoom.rel && openShotMarkup(zoom.rel)}
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

/** One Ledger card: quote (numbered) or section mark (amber), plus comment. */
function MarginCard({
  entry,
  sectionTitle,
  active,
  readOnly,
  onOpenAnchor,
  onActivate,
  onRemove,
  onComment,
  onGrew
}: {
  entry: LedgerEntry
  sectionTitle: (section: string | null) => string
  active: boolean
  readOnly: boolean
  onOpenAnchor: () => void
  onActivate: () => void
  onRemove: () => void
  onComment: (text: string) => void
  onGrew: () => void
}): React.JSX.Element {
  const isMark = entry.kind === 'mark'
  const section = isMark ? entry.mark.section : (entry.quote.section ?? null)
  const comment = isMark ? entry.mark.comment : entry.quote.comment
  return (
    <div
      className={`mcard${isMark ? ' smk' : ''}${active ? ' act' : ''}`}
      data-key={entry.key}
      role="button"
      tabIndex={0}
      onClick={onOpenAnchor}
    >
      <div className="chead">
        <span className="cnum">
          {isMark ? <Flag strokeWidth={2} /> : (entry.quote.number ?? 0)}
        </span>
        <span className="csec">§ {sectionTitle(section)}</span>
        {!readOnly && (
          <button
            className="qx"
            aria-label={isMark ? 'Remove section mark' : `Remove comment ${entry.quote.number}`}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <X strokeWidth={2} />
          </button>
        )}
      </div>
      {isMark ? (
        <div className="csmlbl">Section mark · needs work</div>
      ) : (
        <div className="cquote">“{entry.quote.text}”</div>
      )}
      <textarea
        className="ctext"
        rows={1}
        data-ctext={isMark ? undefined : (entry.quote.number ?? 0)}
        data-smtext={isMark ? entry.mark.section : undefined}
        placeholder={isMark ? 'Why does this section need work?' : 'Add a comment…'}
        aria-label={isMark ? `Comment on section mark ${section}` : `Comment ${entry.quote.number}`}
        value={comment}
        readOnly={readOnly}
        onClick={(e) => {
          e.stopPropagation()
          onActivate()
        }}
        onChange={(e) => {
          onComment(e.target.value)
          autoGrow(e.target)
          onGrew()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Document rendering: parsed blocks → React, with Markers woven in at their
// resolved character ranges (T4). Pure of state beyond its props.

interface DocBodyProps {
  requestPath: string
  imageSourceCacheRef: React.RefObject<Map<string, Promise<string>>>
  blocks: DocBlock[]
  spotsByPath: Map<string, (AnchorSpot & { number: number })[]>
  fallbackBySection: Map<string | null, number[]>
  markedSections: Set<string>
  decisions: Map<string, DecisionAnswer>
  active: string | null
  wide: boolean
  readOnly: boolean
  decisionsInteractive: boolean
  onAnchorClick: (key: string) => void
  onMarkToggle: (section: string) => void
  onMarkOpen: (section: string) => void
  onDecision: (id: string, question: string, choice: string) => void
  onDecisionComment: (id: string, question: string, text: string) => void
  /** Present on the review surface; absent where decisions are read-only text. */
  decisionUi?: {
    info: Map<string, DecisionInfo>
    current: string | null
    images: DecisionImages
    onCompare: (id: string) => void
    onEnlarge: (id: string, option: number, picture: number) => void
    onEditMarks?: (id: string, markup: PictureMarkup) => void
    onZoom?: (url: string, name: string) => void
  }
}

function DocBody({
  requestPath,
  imageSourceCacheRef,
  blocks,
  spotsByPath,
  fallbackBySection,
  markedSections,
  decisions,
  active,
  wide,
  readOnly,
  decisionsInteractive,
  onAnchorClick,
  onMarkToggle,
  onMarkOpen,
  onDecision,
  onDecisionComment,
  decisionUi
}: DocBodyProps): React.JSX.Element {
  const anchored = (runs: InlineRun[], path: string): React.ReactNode[] =>
    renderAnchoredRuns(runs, spotsByPath.get(path) ?? [], active, wide, onAnchorClick)

  return (
    <>
      {blocks.map((b, i) => {
        const path = String(i)
        if (b.kind === 'title') return <h1 key={i}>{anchored(b.runs, path)}</h1>
        if (b.kind === 'heading') {
          const HTag = b.level === 2 ? 'h2' : 'h3'
          const marked = markedSections.has(b.id)
          const fallbacks = fallbackBySection.get(b.id) ?? []
          return (
            <HTag key={i} data-sec={b.id} className={marked ? 'marked' : undefined}>
              <span>{anchored(b.runs, path)}</span>
              {wide && !readOnly && (
                <button
                  className={`markbtn${marked ? ' on' : ''}`}
                  title="Mark section needs-work (M)"
                  aria-label={`Mark section ${b.id} needs-work`}
                  aria-pressed={marked}
                  onClick={() => onMarkToggle(b.id)}
                >
                  <Flag strokeWidth={2} />
                </button>
              )}
              {!wide && marked && (
                <button
                  className="mkchip sm"
                  aria-label="Open section mark"
                  onClick={() => onMarkOpen(b.id)}
                >
                  <Flag strokeWidth={2} />
                </button>
              )}
              {!wide &&
                fallbacks.map((n) => (
                  <button
                    key={n}
                    className="mkchip"
                    aria-label={`Open comment ${n}`}
                    onClick={() => onAnchorClick(`c${n}`)}
                  >
                    {n}
                  </button>
                ))}
            </HTag>
          )
        }
        if (b.kind === 'para') return <p key={i}>{anchored(b.runs, path)}</p>
        if (b.kind === 'code') {
          return (
            <pre key={i}>
              {renderAnchoredRuns(
                [{ text: b.text, style: 'plain' }],
                spotsByPath.get(path) ?? [],
                active,
                wide,
                onAnchorClick
              )}
            </pre>
          )
        }
        if (b.kind === 'table') {
          return (
            <div className="doctable-wrap" key={i}>
              <table className="doctable">
                <thead>
                  <tr>
                    {b.header.map((cell, c) => (
                      <th key={c}>{renderRuns(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((rowCells, r) => (
                    <tr key={r}>
                      {rowCells.map((cell, c) => (
                        <td key={c}>{renderRuns(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (b.kind === 'image') {
          return (
            <DocumentImage
              key={i}
              cacheRef={imageSourceCacheRef}
              requestPath={requestPath}
              src={b.src}
              alt={b.alt}
            />
          )
        }
        if (b.kind === 'embed') {
          // Agent-authored HTML/SVG mockup in a sandboxed frame: scripts run
          // (interactive mockups) but the opaque origin blocks any access to the
          // app, its storage, or same-origin resources.
          return (
            <div className="docembed-wrap" key={i}>
              <iframe
                className="docembed"
                title={`${b.lang} mockup`}
                sandbox="allow-scripts"
                srcDoc={b.lang === 'svg' ? svgFrame(b.code) : b.code}
              />
            </div>
          )
        }
        if (b.kind === 'decision') {
          if (!decisionsInteractive) {
            return (
              <div className="decision static" key={i}>
                <div className="dq">{renderRuns(b.question)}</div>
                <ul>
                  {b.options.map((option) => (
                    <li key={option}>{option}</li>
                  ))}
                </ul>
              </div>
            )
          }
          return (
            <DecisionBlock
              key={i}
              block={b}
              info={decisionUi?.info.get(b.id)}
              answer={decisions.get(b.id)}
              readOnly={readOnly}
              current={decisionUi?.current === b.id}
              images={decisionUi?.images ?? { cacheRef: imageSourceCacheRef, requestPath }}
              onChoice={(choice) => onDecision(b.id, runsText(b.question), choice)}
              onComment={(text) => onDecisionComment(b.id, runsText(b.question), text)}
              onCompare={() => decisionUi?.onCompare(b.id)}
              onEnlarge={(option, picture) => decisionUi?.onEnlarge(b.id, option, picture)}
              onEditMarks={
                decisionUi?.onEditMarks
                  ? (markup) => decisionUi.onEditMarks?.(b.id, markup)
                  : undefined
              }
              onZoom={decisionUi?.onZoom}
            />
          )
        }
        const ListTag = b.ordered ? 'ol' : 'ul'
        return (
          <ListTag key={i}>
            {b.items.map((li, j) => {
              const SubTag = li.sub?.ordered ? 'ol' : 'ul'
              return (
                <li key={j}>
                  {anchored(li.runs, `${i}.${j}`)}
                  {li.sub && (
                    <SubTag>
                      {li.sub.items.map((runs, k) => (
                        <li key={k}>{anchored(runs, `${i}.${j}.${k}`)}</li>
                      ))}
                    </SubTag>
                  )}
                </li>
              )
            })}
          </ListTag>
        )
      })}
    </>
  )
}

/**
 * The Reading surface's Markdown renderer without review controls. Handoffs
 * reuse this so tables, images and code fences render identically, while
 * reading the document remains completely side-effect free.
 */
export function ReadOnlyMarkdown({
  path,
  markdown
}: {
  path: string
  markdown: string
}): React.JSX.Element {
  const { settings } = useApp()
  const blocks = useMemo(() => parseDocBlocks(markdown), [markdown])
  const imageSourceCacheRef = useRef<Map<string, Promise<string>>>(new Map())

  return (
    <div className={`doc readdoc ho-document ${readingTextSizeClass(settings?.readingTextSize)}`}>
      <DocBody
        requestPath={path}
        imageSourceCacheRef={imageSourceCacheRef}
        blocks={blocks}
        spotsByPath={EMPTY_SPOTS}
        fallbackBySection={EMPTY_FALLBACKS}
        markedSections={EMPTY_MARKS}
        decisions={EMPTY_DECISIONS}
        active={null}
        wide={false}
        readOnly
        decisionsInteractive={false}
        onAnchorClick={NOOP}
        onMarkToggle={NOOP}
        onMarkOpen={NOOP}
        onDecision={NOOP}
        onDecisionComment={NOOP}
      />
    </div>
  )
}

/**
 * Weave anchor spans through a run list: runs are split at spot boundaries,
 * segments inside a spot render inside one `.anch` span (its Marker chip
 * follows when narrow). Spots never overlap — resolveAnchors guarantees it.
 */
function renderAnchoredRuns(
  runs: InlineRun[],
  spots: (AnchorSpot & { number: number })[],
  active: string | null,
  wide: boolean,
  onAnchorClick: (key: string) => void
): React.ReactNode[] {
  if (spots.length === 0) return renderRuns(runs)

  // Split each run at every spot boundary, tagging segments with their spot.
  const bounds = [...new Set(spots.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b)
  interface Seg {
    run: InlineRun
    text: string
    spot: number | null
  }
  const segs: Seg[] = []
  let pos = 0
  for (const run of runs) {
    let local = 0
    while (local < run.text.length) {
      const globalPos = pos + local
      const nextBound = bounds.find((bd) => bd > globalPos)
      const end = Math.min(
        run.text.length,
        nextBound !== undefined ? nextBound - pos : run.text.length
      )
      const covering = spots.find((s) => s.start <= globalPos && globalPos < s.end)
      segs.push({ run, text: run.text.slice(local, end), spot: covering?.number ?? null })
      local = end
    }
    pos += run.text.length
  }

  // Group consecutive segments by spot; anchored groups become one span each.
  const nodes: React.ReactNode[] = []
  let key = 0
  const renderSeg = (seg: Seg): React.ReactNode => renderRuns([{ ...seg.run, text: seg.text }])[0]
  let i = 0
  while (i < segs.length) {
    const spot = segs[i].spot
    let j = i
    while (j < segs.length && segs[j].spot === spot) j++
    const group = segs.slice(i, j)
    if (spot === null) {
      for (const seg of group) {
        nodes.push(<span key={key++}>{renderSeg(seg)}</span>)
      }
    } else {
      nodes.push(
        <span
          key={key++}
          className={`anch${active === `c${spot}` ? ' act' : ''}`}
          data-cid={spot}
          role="button"
          tabIndex={0}
          aria-label={`Open comment ${spot}`}
          onClick={() => {
            // Selecting text across an anchor must not open its card.
            if (!window.getSelection()?.isCollapsed) return
            onAnchorClick(`c${spot}`)
          }}
        >
          {group.map((seg, gi) => (
            <span key={gi}>{renderSeg(seg)}</span>
          ))}
        </span>
      )
      if (!wide) {
        nodes.push(
          <button
            key={key++}
            className="mkchip"
            aria-label={`Open comment ${spot}`}
            onClick={() => onAnchorClick(`c${spot}`)}
          >
            {spot}
          </button>
        )
      }
    }
    i = j
  }
  return nodes
}
