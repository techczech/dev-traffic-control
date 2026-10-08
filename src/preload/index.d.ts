import { ElectronAPI } from '@electron-toolkit/preload'
import type { ExampleOpenResult, ExampleRemoveResult } from '../shared/example'
import type {
  DockMenuState,
  DockPlaceId,
  InboxState,
  ArchiveOldInput,
  ArchiveOldResult,
  ItemTicks,
  NoteDoc,
  OpenRunResult,
  QaSnapshot,
  PoolReorderInput,
  PoolReorderResult,
  PoolIdeaWriteInput,
  PoolIdeaWriteResult,
  PoolSeenInput,
  PoolTransitionInput,
  ReadingProgress,
  ReadingProgressState,
  ReleaseAnswerInput,
  ReleaseAnswerResult,
  VerdictShotInput,
  VerdictShotReadInput,
  ReleaseShipInput,
  ReleaseShipResult,
  RecordFileContent,
  RecordSearchResult,
  ReportMutationResult,
  ReportTicks,
  SaveReportResult,
  Settings,
  SettingsChange,
  SettingsWriteFailure,
  ViewState
} from '../shared/ipc'
import type { WindowScope, WindowScopeState } from '../shared/windowScope'
import type { DeepLinkLanding, DeepLinkRetryResult } from '../shared/deepLink'
import type { QaReport } from '../main/qa/types'
import type { HandoffSidecar } from '../main/qa/handoffs'
import type { ProjectPool } from '../main/qa/pool'

export interface QaBridge {
  getSnapshot: () => Promise<QaSnapshot>
  onSnapshot: (cb: (s: QaSnapshot) => void) => () => void
  onRefreshStale: (cb: (message: string) => void) => () => void
  getVersion: () => Promise<string>
  getSettings: () => Promise<Settings>
  setSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => Promise<Settings>
  getSettingsLog: () => Promise<SettingsChange[]>
  onSettingsWriteFailed: (cb: (failure: SettingsWriteFailure) => void) => () => void
  getViewState: () => Promise<ViewState>
  setRightPanels: (rightPanels: ViewState['rightPanels']) => Promise<ViewState>
  getWindowScope: () => Promise<WindowScopeState>
  setWindowScope: (scope: WindowScope) => Promise<WindowScopeState>
  rememberProjectSurface: (surface: string) => Promise<WindowScopeState>
  takeDeepLink: () => Promise<DeepLinkLanding | null>
  retryDeepLink: (url: string) => Promise<DeepLinkRetryResult>
  firstRun: () => Promise<boolean>
  newWindow: () => Promise<void>
  setPinned: (v: boolean) => Promise<Settings>
  onWindowSettings: (cb: (settings: Settings) => void) => () => void
  resetWindowPosition: () => Promise<Settings>
  setWidthPreset: (p: Settings['widthPreset']) => Promise<Settings>
  setWindowMode: (m: Settings['windowMode']) => Promise<Settings>
  dock: (place: DockPlaceId | 'last') => Promise<Settings>
  dockMenu: () => Promise<DockMenuState | null>
  pickFolder: () => Promise<string | null>
  bootstrapRepo: (root: string) => Promise<Settings | null>
  searchRecord: (query: string) => Promise<RecordSearchResult>
  readRecordFiles: (files: string[]) => Promise<RecordFileContent[]>
  answerRelease: (input: ReleaseAnswerInput) => Promise<ReleaseAnswerResult>
  addVerdictShot: (input: VerdictShotInput) => Promise<string | null>
  readVerdictShot: (input: VerdictShotReadInput) => Promise<string | null>
  shipRelease: (input: ReleaseShipInput) => Promise<ReleaseShipResult>
  reorderPool: (input: PoolReorderInput) => Promise<PoolReorderResult>
  writePoolIdea: (input: PoolIdeaWriteInput) => Promise<PoolIdeaWriteResult>
  transitionPool: (input: PoolTransitionInput) => Promise<ProjectPool>
  markPoolSeen: (input: PoolSeenInput) => Promise<ProjectPool>
  openRun: (requestPath: string) => Promise<OpenRunResult>
  saveReport: (requestPath: string, report: QaReport) => Promise<SaveReportResult>
  finishRun: (requestPath: string, report: QaReport) => Promise<ReportMutationResult>
  reopenRun: (requestPath: string) => Promise<ReportMutationResult>
  setAsideCorruptReport: (requestPath: string, report?: QaReport) => Promise<OpenRunResult>
  addShot: (requestPath: string, itemId: string, pngBase64: string) => Promise<string>
  readShot: (requestPath: string, relPath: string) => Promise<string>
  getTicks: (reportBasename: string) => Promise<ReportTicks>
  setItemTicks: (reportBasename: string, itemId: string, item: ItemTicks) => Promise<void>
  getInboxState: () => Promise<InboxState>
  onInboxState: (cb: (state: InboxState) => void) => () => void
  markSeen: (basename: string) => Promise<InboxState>
  archiveRequest: (basename: string) => Promise<InboxState>
  unarchiveRequest: (basename: string) => Promise<InboxState>
  archiveOld: (input: ArchiveOldInput) => Promise<ArchiveOldResult>
  unarchiveThread: (id: string) => Promise<InboxState>
  unarchiveHandoff: (handoffPath: string) => Promise<HandoffSidecar | null>
  getReadingProgress: () => Promise<ReadingProgressState>
  setReadingProgress: (
    requestPath: string,
    progress: Omit<ReadingProgress, 'updatedAt'>
  ) => Promise<ReadingProgress>
  copyHandoffPrompt: (handoffPath: string) => Promise<HandoffSidecar | null>
  copyCollectPrompt: (requestPath: string, title: string) => Promise<void>
  archiveHandoff: (handoffPath: string) => Promise<HandoffSidecar | null>
  revealHandoff: (handoffPath: string) => Promise<boolean>
  revealPath: (filePath: string) => Promise<boolean>
  openExample: () => Promise<ExampleOpenResult>
  removeExample: () => Promise<ExampleRemoveResult>
  examplePresent: () => Promise<boolean>
  createNote: (dir: string, title: string) => Promise<NoteDoc | null>
  openNote: (notePath: string) => Promise<NoteDoc | null>
  saveNote: (doc: NoteDoc) => Promise<{ savedAt: string } | null>
  handOverNote: (notePath: string) => Promise<NoteDoc | null>
  reopenNote: (notePath: string) => Promise<NoteDoc | null>
  addNoteShot: (notePath: string, pngBase64: string) => Promise<string | null>
  linkNoteToReport: (requestPath: string, noteBasename: string) => Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    qa: QaBridge
  }
}
