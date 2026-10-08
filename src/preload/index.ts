import { contextBridge, ipcRenderer } from 'electron'
import type { ExampleOpenResult, ExampleRemoveResult } from '../shared/example'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
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

// Typed bridge over the contract library. The renderer never touches fs or git.
const qa = {
  getSnapshot: (): Promise<QaSnapshot> => ipcRenderer.invoke(IPC.getSnapshot),
  onSnapshot: (cb: (s: QaSnapshot) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: QaSnapshot): void => cb(s)
    ipcRenderer.on(IPC.snapshotChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC.snapshotChanged, listener)
    }
  },
  onRefreshStale: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, value: { message: string }): void =>
      cb(value.message)
    ipcRenderer.on(IPC.refreshStale, listener)
    return () => ipcRenderer.removeListener(IPC.refreshStale, listener)
  },
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getVersion),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  setSetting: <K extends keyof Settings>(k: K, v: Settings[K]): Promise<Settings> =>
    ipcRenderer.invoke(IPC.setSetting, k, v),
  getSettingsLog: (): Promise<SettingsChange[]> => ipcRenderer.invoke(IPC.getSettingsLog),
  onSettingsWriteFailed: (cb: (failure: SettingsWriteFailure) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, failure: SettingsWriteFailure): void =>
      cb(failure)
    ipcRenderer.on(IPC.settingsWriteFailed, listener)
    return () => ipcRenderer.removeListener(IPC.settingsWriteFailed, listener)
  },
  getViewState: (): Promise<ViewState> => ipcRenderer.invoke(IPC.getViewState),
  setRightPanels: (rightPanels: ViewState['rightPanels']): Promise<ViewState> =>
    ipcRenderer.invoke(IPC.setRightPanels, rightPanels),
  getWindowScope: (): Promise<WindowScopeState> => ipcRenderer.invoke(IPC.getWindowScope),
  setWindowScope: (scope: WindowScope): Promise<WindowScopeState> =>
    ipcRenderer.invoke(IPC.setWindowScope, scope),
  rememberProjectSurface: (surface: string): Promise<WindowScopeState> =>
    ipcRenderer.invoke(IPC.rememberProjectSurface, surface),
  // The renderer asks for the link its window was born for; main never pushes.
  takeDeepLink: (): Promise<DeepLinkLanding | null> => ipcRenderer.invoke(IPC.takeDeepLink),
  retryDeepLink: (url: string): Promise<DeepLinkRetryResult> =>
    ipcRenderer.invoke(IPC.retryDeepLink, url),
  firstRun: (): Promise<boolean> => ipcRenderer.invoke(IPC.firstRun),
  newWindow: (): Promise<void> => ipcRenderer.invoke(IPC.newWindow),
  setPinned: (v: boolean): Promise<Settings> => ipcRenderer.invoke(IPC.setPinned, v),
  onWindowSettings: (cb: (settings: Settings) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, settings: Settings): void => cb(settings)
    ipcRenderer.on(IPC.windowSettingsChanged, listener)
    return () => ipcRenderer.removeListener(IPC.windowSettingsChanged, listener)
  },
  resetWindowPosition: (): Promise<Settings> => ipcRenderer.invoke(IPC.resetWindowPosition),
  setWidthPreset: (p: Settings['widthPreset']): Promise<Settings> =>
    ipcRenderer.invoke(IPC.setWidthPreset, p),
  setWindowMode: (m: Settings['windowMode']): Promise<Settings> =>
    ipcRenderer.invoke(IPC.setWindowMode, m),
  dock: (place: DockPlaceId | 'last'): Promise<Settings> => ipcRenderer.invoke(IPC.dock, place),
  dockMenu: (): Promise<DockMenuState | null> => ipcRenderer.invoke(IPC.dockMenu),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickFolder),
  bootstrapRepo: (root: string): Promise<Settings | null> =>
    ipcRenderer.invoke(IPC.bootstrapRepo, root),
  searchRecord: (query: string): Promise<RecordSearchResult> =>
    ipcRenderer.invoke(IPC.searchRecord, query),
  readRecordFiles: (files: string[]): Promise<RecordFileContent[]> =>
    ipcRenderer.invoke(IPC.readRecordFiles, files),
  answerRelease: (input: ReleaseAnswerInput): Promise<ReleaseAnswerResult> =>
    ipcRenderer.invoke(IPC.answerRelease, input),
  addVerdictShot: (input: VerdictShotInput): Promise<string | null> =>
    ipcRenderer.invoke(IPC.addVerdictShot, input),
  readVerdictShot: (input: VerdictShotReadInput): Promise<string | null> =>
    ipcRenderer.invoke(IPC.readVerdictShot, input),
  shipRelease: (input: ReleaseShipInput): Promise<ReleaseShipResult> =>
    ipcRenderer.invoke(IPC.shipRelease, input),
  reorderPool: (input: PoolReorderInput): Promise<PoolReorderResult> =>
    ipcRenderer.invoke(IPC.reorderPool, input),
  writePoolIdea: (input: PoolIdeaWriteInput): Promise<PoolIdeaWriteResult> =>
    ipcRenderer.invoke(IPC.writePoolIdea, input),
  transitionPool: (input: PoolTransitionInput): Promise<ProjectPool> =>
    ipcRenderer.invoke(IPC.transitionPool, input),
  markPoolSeen: (input: PoolSeenInput): Promise<ProjectPool> =>
    ipcRenderer.invoke(IPC.markPoolSeen, input),
  openRun: (requestPath: string): Promise<OpenRunResult> =>
    ipcRenderer.invoke(IPC.openRun, requestPath),
  saveReport: (requestPath: string, report: QaReport): Promise<SaveReportResult> =>
    ipcRenderer.invoke(IPC.saveReport, requestPath, report),
  finishRun: (requestPath: string, report: QaReport): Promise<ReportMutationResult> =>
    ipcRenderer.invoke(IPC.finishRun, requestPath, report),
  reopenRun: (requestPath: string): Promise<ReportMutationResult> =>
    ipcRenderer.invoke(IPC.reopenRun, requestPath),
  setAsideCorruptReport: (requestPath: string, report?: QaReport): Promise<OpenRunResult> =>
    ipcRenderer.invoke(IPC.setAsideCorruptReport, requestPath, report),
  addShot: (requestPath: string, itemId: string, pngBase64: string): Promise<string> =>
    ipcRenderer.invoke(IPC.addShot, requestPath, itemId, pngBase64),
  readShot: (requestPath: string, relPath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.readShot, requestPath, relPath),
  getTicks: (reportBasename: string): Promise<ReportTicks> =>
    ipcRenderer.invoke(IPC.getTicks, reportBasename),
  setItemTicks: (reportBasename: string, itemId: string, item: ItemTicks): Promise<void> =>
    ipcRenderer.invoke(IPC.setItemTicks, reportBasename, itemId, item),
  getInboxState: (): Promise<InboxState> => ipcRenderer.invoke(IPC.getInboxState),
  onInboxState: (cb: (state: InboxState) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: InboxState): void => cb(state)
    ipcRenderer.on(IPC.inboxStateChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC.inboxStateChanged, listener)
    }
  },
  markSeen: (basename: string): Promise<InboxState> => ipcRenderer.invoke(IPC.markSeen, basename),
  archiveRequest: (basename: string): Promise<InboxState> =>
    ipcRenderer.invoke(IPC.archiveRequest, basename),
  unarchiveRequest: (basename: string): Promise<InboxState> =>
    ipcRenderer.invoke(IPC.unarchiveRequest, basename),
  archiveOld: (input: ArchiveOldInput): Promise<ArchiveOldResult> =>
    ipcRenderer.invoke(IPC.archiveOld, input),
  unarchiveThread: (id: string): Promise<InboxState> => ipcRenderer.invoke(IPC.unarchiveThread, id),
  unarchiveHandoff: (handoffPath: string): Promise<HandoffSidecar | null> =>
    ipcRenderer.invoke(IPC.unarchiveHandoff, handoffPath),
  getReadingProgress: (): Promise<ReadingProgressState> =>
    ipcRenderer.invoke(IPC.getReadingProgress),
  setReadingProgress: (
    requestPath: string,
    progress: Omit<ReadingProgress, 'updatedAt'>
  ): Promise<ReadingProgress> => ipcRenderer.invoke(IPC.setReadingProgress, requestPath, progress),
  copyHandoffPrompt: (handoffPath: string): Promise<HandoffSidecar | null> =>
    ipcRenderer.invoke(IPC.copyHandoffPrompt, handoffPath),
  copyCollectPrompt: (requestPath: string, title: string): Promise<void> =>
    ipcRenderer.invoke(IPC.copyCollectPrompt, requestPath, title),
  archiveHandoff: (handoffPath: string): Promise<HandoffSidecar | null> =>
    ipcRenderer.invoke(IPC.archiveHandoff, handoffPath),
  revealHandoff: (handoffPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.revealHandoff, handoffPath),
  revealPath: (filePath: string): Promise<boolean> => ipcRenderer.invoke(IPC.revealPath, filePath),
  openExample: (): Promise<ExampleOpenResult> => ipcRenderer.invoke(IPC.openExample),
  removeExample: (): Promise<ExampleRemoveResult> => ipcRenderer.invoke(IPC.removeExample),
  examplePresent: (): Promise<boolean> => ipcRenderer.invoke(IPC.examplePresent),
  createNote: (dir: string, title: string): Promise<NoteDoc | null> =>
    ipcRenderer.invoke(IPC.createNote, dir, title),
  openNote: (notePath: string): Promise<NoteDoc | null> =>
    ipcRenderer.invoke(IPC.openNote, notePath),
  saveNote: (doc: NoteDoc): Promise<{ savedAt: string } | null> =>
    ipcRenderer.invoke(IPC.saveNote, doc),
  handOverNote: (notePath: string): Promise<NoteDoc | null> =>
    ipcRenderer.invoke(IPC.handOverNote, notePath),
  reopenNote: (notePath: string): Promise<NoteDoc | null> =>
    ipcRenderer.invoke(IPC.reopenNote, notePath),
  addNoteShot: (notePath: string, pngBase64: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.addNoteShot, notePath, pngBase64),
  linkNoteToReport: (requestPath: string, noteBasename: string): Promise<void> =>
    ipcRenderer.invoke(IPC.linkNoteToReport, requestPath, noteBasename)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('qa', qa)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.qa = qa
}
