import type { NoteRef, RunRef } from '../main/qa/scan'
import type { Handoff } from '../main/qa/handoffs'
import type { ProjectRelease, ReleaseAnswers, ReleaseVerdict } from '../main/qa/releaseRecords'
import type { ShipReleaseResult } from '../main/qa/releaseShipping'
import type {
  PoolMoveDirection,
  PoolReorderResult as PoolWriterResult,
  PoolTier,
  ProjectPool
} from '../main/qa/pool'
import type { RequestFate } from '../main/qa/featureRequest'
import type { QaReport, QaRequest, Thread, ThreadEntry } from '../main/qa/types'

export const REPORT_RECOVERY_MARKER = 'The damaged report was set aside to '

export interface QaSnapshot {
  root: string
  localMachine?: string
  rootMissing: boolean // path does not resolve → renderer shows repo-missing state
  runs: SerializableRun[]
  notes: NoteRef[]
  // Thread record (roadmap graft, ADR-0009): the raw entries and the threads
  // derived from them, computed in main beside the derived run statuses.
  entries: ThreadEntry[]
  threads: Thread[]
  handoffs: Handoff[]
  releases: ProjectRelease[]
  pools: ProjectPool[]
  projects: string[]
  scannedAt: string // ISO
  receiptsStartAt?: string
}
// RunRef is plain serialisable data, including the request-file mtime ISO used
// by renderer row ages; the report is kept whole because it is plain JSON too.
export type SerializableRun = RunRef

export interface ReleaseAnswerInput {
  project: string
  version: string
  id: string
  verdict: ReleaseVerdict
  comment: string
  /**
   * Pictures for this verdict (ticket 25), paths relative to the project
   * folder as `addVerdictShot` returned them. Omitted keeps the pictures the
   * answer already has; a list replaces them.
   */
  screenshots?: string[]
}

export type ReleaseAnswerResult = ReleaseAnswers

/** One picture pasted or dropped onto a verdict, before the verdict is given. */
export interface VerdictShotInput {
  project: string
  version: string
  /** The feature id the verdict is for. */
  id: string
  pngBase64: string
}

/** A verdict picture to read back, by its project-relative path. */
export interface VerdictShotReadInput {
  project: string
  version: string
  rel: string
}

export interface ReleaseShipInput {
  project: string
  version: string
  notes: string
  fixesTo?: string
}

export type ReleaseShipResult = ShipReleaseResult

export type PoolReorderInput =
  | {
      project: string
      id: string
      direction: PoolMoveDirection
      beforeId?: never
    }
  | {
      project: string
      id: string
      beforeId: string
      direction?: never
    }

export type PoolReorderResult = PoolWriterResult

export type PoolIdeaWriteInput =
  | {
      project: string
      action: 'add'
      title: string
      bodyMarkdown: string
      tier: PoolTier
    }
  | {
      project: string
      action: 'edit'
      id: string
      title?: string
      bodyMarkdown?: string
      /** A reviewer entry main appends to the body as it is on disk now (max 8 KB, no `---` line). */
      appendEntry?: string
      /** Ticket 42: approval sets `planned`; taking it off the roadmap sets `waiting`. */
      fate?: RequestFate
      /** Ticket 42: the release a feature is aimed at; `null` clears it (Unscheduled). */
      candidate?: string | null
    }

export interface PoolIdeaWriteResult {
  pool: ProjectPool
  id: string
}

export interface PoolSeenInput {
  project: string
}

export type PoolTransitionInput =
  | {
      project: string
      id: string
      action: 'promote'
      release: string
      specWanted: boolean
    }
  | { project: string; id: string; action: 'setaside'; reason: string }
  | { project: string; id: string; action: 'restore' }

export type ReadingTextSize = 'normal' | 'large' | 'extra-large'
export const READING_TEXT_SIZES: readonly ReadingTextSize[] = ['normal', 'large', 'extra-large']

export function stepReadingTextSize(current: ReadingTextSize, direction: -1 | 1): ReadingTextSize {
  const index = READING_TEXT_SIZES.indexOf(current)
  const safeIndex = index < 0 ? 0 : index
  const nextIndex = Math.min(READING_TEXT_SIZES.length - 1, Math.max(0, safeIndex + direction))
  return READING_TEXT_SIZES[nextIndex]
}

export function readingTextSizeClass(size: ReadingTextSize | undefined): string {
  return `reading-text-${size ?? 'normal'}`
}

export interface Settings {
  qaRepoPath: string
  appearance: 'light' | 'dark' | 'system'
  readingTextSize: ReadingTextSize
  pinBehaviour: 'remember' | 'always'
  pinned: boolean // last pin state (used when pinBehaviour = remember)
  dockBadge: boolean
  runnerMode: 'focus' | 'list' // Runner layout: one card at a time, or all stacked
  // Window feel (relief pass R1): a narrow strip beside the app under test, or a
  // wide frame for reading. 'wide' clears the review WIDE_BREAKPOINT so the doc
  // surface flips to its wide layout with no drag-resize.
  widthPreset: 'narrow' | 'wide'
  // 'docked' keeps the window flush with the edge it was last docked at, full
  // height; 'free' floats anywhere. Persisted so a relaunch restores the habitat.
  windowMode: 'free' | 'docked'
  // The verdict sheet (ticket 27): one feature at a time, or every waiting
  // feature as a list of cards. Remembers which way he last used.
  verdictLayout: VerdictLayout
  // Review margin (relief pass R2): the wide-mode comments ledger. 'auto'
  // collapses it only while empty; 'open'/'collapsed' force it. Collapsed in
  // wide mode falls back to inline markers + slide-over, so the document
  // reclaims the space with no loss of access.
  reviewMargin: 'auto' | 'open' | 'collapsed'
  // Command registry overrides only. Missing ids inherit the current release's
  // defaults; an empty string intentionally leaves a command unbound.
  keymap: Record<string, string>
  // Ticket 36: the title-bar Get started / Remove example button is retired once
  // the example is removed or Get started is hidden. Settings can bring it back.
  getStartedRetired: boolean
}

export type VerdictLayout = 'one' | 'all'

/** Ticket 27: the Dock button's four places, seen from the window's own screen. */
export type DockEdge = 'left' | 'right'
export type DockPlaceId = 'right-this' | 'left-this' | 'right-other' | 'left-other'

export interface DockMenuState {
  /** The last-used place, as it reads from this window's screen. */
  last: DockPlaceId
  places: Array<{ id: DockPlaceId; label: string; enabled: boolean; current: boolean }>
}

export interface ViewState {
  rightPanels: Record<string, 'closed' | 'inspector' | 'ledger'>
}

export interface SettingsChange {
  // Historical entries outlive settings, so retired keys remain valid history.
  key: string
  from: unknown
  to: unknown
  at: string // ISO
}

export interface SettingsWriteFailure {
  key: keyof Settings
  message: string
}

/** Result of opening a run: the parsed request plus its report (fresh or reconciled). */
export interface OpenRunResult {
  request: QaRequest
  report: QaReport
  exists: boolean // true → a report file already existed on disk
  corruptReport?: { path: string; message: string }
}

export interface ReportWriteRefusal {
  kind: 'invalid-on-disk'
  path: string
  message: string
}

export type SaveReportResult =
  { ok: true; savedAt: string } | { ok: false; refusal: ReportWriteRefusal }

export type ReportMutationResult =
  { ok: true; report: QaReport } | { ok: false; refusal: ReportWriteRefusal }

// A note as the renderer holds it: M1 NoteContent plus the file path. `path` is
// '' until the first save of a NEW (lazily created) note.
export interface NoteDoc {
  path: string // absolute; '' until first save of a NEW note
  title: string
  body: string
  linkedRun?: string // request basename incl. .md
  handedOverAt?: string
  shots: string[] // relative paths
}

// Ticks (M8, ADR-0004 Amendment 5): personal progress marks on Steps/Expected
// bullets. App-local (userData/ticks.json), keyed by repository-relative request path — NEVER in
// report.json, so an agent can never mistake a tick for a verdict.
export interface ItemTicks {
  steps: number[] // bullet indexes, in the order they were ticked
  expected: number[]
}
export type ReportTicks = Record<string, ItemTicks> // by item id

// Inbox state (relief pass R4): app-local, keyed by repository-relative request path. `seen` =
// requests already opened (the rest read as NEW); `archived` = requests hidden
// from the default Inbox but recoverable. NEVER in the record repo — the app may
// not touch agent-owned request files (ADR-0001), so archive hides, not deletes.
export interface InboxState {
  seen: string[]
  archived: string[]
  /**
   * Thread ids of decisions he has archived as stale (ticket 22, archive old).
   * App-local like `archived`: threads are agent-owned, so the record is never
   * touched. Absent in state written before ticket 22.
   */
  archivedThreads?: string[]
}

/** Archive old (ticket 22): what one bulk clear archives. Main confines every entry. */
export interface ArchiveOldInput {
  /** Request identities, as the Inbox keys them. */
  requests: string[]
  /** Thread ids of decisions. */
  threads: string[]
  /** Absolute handoff document paths. */
  handoffs: string[]
}

export interface ArchiveOldResult {
  inbox: InboxState
  archived: { requests: number; threads: number; handoffs: number }
}

export interface ReadingProgress {
  sectionSlug: string
  sectionIndex: number
  sectionCount: number
  updatedAt: string
}

export type ReadingProgressState = Record<string, ReadingProgress>

export type RecordSearchKind = 'request' | 'note' | 'entry'
export interface RecordSearchHit {
  file: string
  line: number
  column: number
  snippet: string
  kind: RecordSearchKind
  title: string
  project: string
  thread?: string
}
export interface RecordSearchResult {
  hits: RecordSearchHit[]
  total: number
  files: number
  cap: number
  capped: boolean
}
export interface RecordFileContent {
  file: string
  content: string | null
}

export const IPC = {
  getSnapshot: 'qa:get-snapshot',
  snapshotChanged: 'qa:snapshot-changed',
  refreshStale: 'qa:refresh-stale',
  getVersion: 'app:get-version',
  getSettings: 'settings:get',
  setSetting: 'settings:set',
  getSettingsLog: 'settings:log',
  settingsWriteFailed: 'settings:write-failed',
  getViewState: 'view-state:get',
  setRightPanels: 'view-state:set-right-panels',
  // The window scope (ADR-0016 § 1) — per window slot, outside the view history.
  getWindowScope: 'window-scope:get',
  setWindowScope: 'window-scope:set',
  rememberProjectSurface: 'window-scope:remember-surface',
  // Deep links (ADR-0016 § 5). A renderer PULLS the link its window was born
  // for; main never pushes one, because a send to a renderer that has not
  // mounted is dropped silently and cold launch is exactly that case.
  takeDeepLink: 'deep-link:take',
  retryDeepLink: 'deep-link:retry',
  firstRun: 'settings:first-run',
  newWindow: 'window:new',
  setPinned: 'window:set-pinned',
  // Main changed this window's layout on its own (an enlargement unpinned it).
  windowSettingsChanged: 'window:settings-changed',
  resetWindowPosition: 'window:reset-position',
  // Window feel (relief pass R1) — main owns the resize/dock side effect.
  setWidthPreset: 'window:set-width',
  setWindowMode: 'window:set-mode',
  // Ticket 27: dock as the sidebar at a place (or the last one), and the ▾ menu.
  dock: 'window:dock',
  dockMenu: 'window:dock-menu',
  // M5: native folder picker + first-run bootstrap through the app's own contract.
  pickFolder: 'dialog:pick-folder',
  bootstrapRepo: 'qa:bootstrap',
  searchRecord: 'record:search',
  readRecordFiles: 'record:read-files',
  answerRelease: 'release:answer',
  shipRelease: 'release:ship',
  addVerdictShot: 'release:add-shot',
  readVerdictShot: 'release:read-shot',
  reorderPool: 'roadmap:reorder',
  writePoolIdea: 'roadmap:write-idea',
  transitionPool: 'roadmap:transition',
  markPoolSeen: 'roadmap:mark-seen',
  openRun: 'runner:open',
  saveReport: 'runner:save',
  finishRun: 'runner:finish',
  reopenRun: 'runner:reopen',
  setAsideCorruptReport: 'runner:set-aside-corrupt-report',
  addShot: 'runner:add-shot',
  readShot: 'runner:read-shot',
  // Ticks (M8, ADR-0004 Amendment 5) — app-local progress, never report.json.
  getTicks: 'ticks:get',
  setItemTicks: 'ticks:set-item',
  // Inbox state (relief pass R4) — app-local NEW markers + archive, never the repo.
  getInboxState: 'inbox:get-state',
  inboxStateChanged: 'inbox:state-changed',
  markSeen: 'inbox:mark-seen',
  archiveRequest: 'inbox:archive',
  archiveOld: 'inbox:archive-old',
  unarchiveThread: 'inbox:unarchive-thread',
  unarchiveHandoff: 'handoff:unarchive',
  unarchiveRequest: 'inbox:unarchive',
  getReadingProgress: 'reading-progress:get',
  setReadingProgress: 'reading-progress:set',
  // Handoffs: agent-written document, app-written picked-up/archive sidecar.
  copyHandoffPrompt: 'handoff:copy-prompt',
  copyCollectPrompt: 'runner:copy-collect-prompt',
  archiveHandoff: 'handoff:archive',
  revealHandoff: 'handoff:reveal',
  revealPath: 'file:reveal',
  // Ticket 34: the bundled example project, opened and removed by main.
  openExample: 'example:open',
  removeExample: 'example:remove',
  examplePresent: 'example:present',
  // Notes (M4) — IPC keys: note:create, note:open, note:save, note:hand-over,
  // note:reopen, note:add-shot (+ note:link-report for the report cross-link).
  createNote: 'note:create',
  openNote: 'note:open',
  saveNote: 'note:save',
  handOverNote: 'note:hand-over',
  reopenNote: 'note:reopen',
  addNoteShot: 'note:add-shot',
  linkNoteToReport: 'note:link-report'
} as const
