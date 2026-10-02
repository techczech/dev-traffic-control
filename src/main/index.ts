import {
  app,
  clipboard,
  dialog,
  screen,
  shell,
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent
} from 'electron'
import { basename, join } from 'path'
import { isNoteFileName } from './qa/scan'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  bootstrapUserData,
  resolveUserDataOverride,
  type UserDataStores
} from './bootstrapUserData'
import { createInboxStateHandlers } from './inboxIpc'
import { createReadingProgressHandlers } from './readingProgressIpc'
import { pruneUserDataForSnapshot, ticksKeyFor } from './snapshotState'
import {
  configureWindowVisibility,
  bringWindowForward,
  isHiddenWindowTestMode,
  showWindowForSecondInstance
} from './windowVisibility'
import { QaService } from './qaService'
import { createAllWindowsSender } from './currentWindow'
import { confineRequestPath } from './requestPath'
import {
  landingForArrival,
  landingRecords,
  resolveDeepLinkArrival,
  scopeForArrival,
  type DeepLinkArrival
} from './deepLinkResolve'
import { deepLinkRoute, PendingDeepLinks, type HeldDeepLink } from './pendingDeepLinks'
import { protocolClientRegistration } from './deepLinkRegistration'
import { pullRecordRepo, recordRepoLastPulledAt } from './recordRepoSync'
import {
  deepLinkFromArgv,
  type DeepLinkLanding,
  type DeepLinkRetryResult
} from '../shared/deepLink'
import { readRecordFiles, searchRecordBodies } from './recordSearch'
import { ensureQaRepo, refreshContract } from './qa/bootstrap'
import { bootstrapRecordRoot } from './bootstrapFlow'
import { createRootChoiceHandlers } from './bootstrapIpc'
import { createWillQuitHandler, createWindowAllClosedHandler } from './quitFlow'
import { armingFor, writeArming } from './qa/arming'
import { confineArchiveOld } from './archiveOld'
import { createHandoffHandlers } from './handoffIpc'
import {
  bigLinkBounds,
  linkWindowShape,
  modeFromFrontmatter,
  sidebarLinkState,
  slotForLinkShape,
  type LinkWindowShape
} from './linkWindow'
import { closeSync, openSync, readSync } from 'node:fs'
import type { RequestMode } from './qa/types'
import { hostname } from 'node:os'
import {
  openRun,
  ReportRecoveryError,
  recoverCorruptReport,
  save,
  finish,
  reopen,
  setAsideCorruptReport,
  storeShot,
  readShotDataUrl
} from './runnerIo'
import { linkNoteToReport } from './noteIo'
import { createNoteHandlers } from './noteIpc'
import { createReleaseShotHandlers } from './releaseShotIpc'
import { createRevealHandlers } from './revealIpc'
import { createExampleHandlers } from './exampleIpc'
import { IPC, type DockMenuState, type DockPlaceId } from '../shared/ipc'
import {
  freeBoundsForPreset,
  NARROW_WIDTH,
  pinnedForPreset,
  settingsForDock,
  validBounds,
  type WindowBounds
} from './windowLayout'
import { watchEnlargementUnpins, type EnlargementWatch } from './enlargeUnpins'
import { guardPinInvariant, LinkLift, mayBePinned, TemporaryPin } from './pinInvariant'
import {
  dockBounds,
  dockClickStep,
  type DockCycle,
  type RememberedDockPlace,
  dockMenuState,
  isDockPlaceId,
  resolveDockPlace,
  type DockDisplay
} from './dockPlaces'
import { WindowManager } from './windowManager'
import {
  createEnsureWindowAndRaiseHandler,
  finaliseNewWindowState,
  reconcileWindowToWorkArea,
  resetWindowPosition,
  reviseWindowMinimums,
  windowGeometryForCreation
} from './windowLifecycle'
import type { PersistedWindowState, WindowLayoutPreferences } from './viewState'
import { isWindowScope, type WindowScopeState } from '../shared/windowScope'
import { collectPrompt } from './collectPrompt'
import { archiveHandoff, type HandoffSidecar } from './qa/handoffs'
import type {
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
  ReleaseShipInput,
  ReleaseShipResult,
  ReportMutationResult,
  ReportTicks,
  SaveReportResult,
  Settings,
  SettingsWriteFailure,
  ViewState
} from '../shared/ipc'
import type { QaReport } from './qa/types'
import { writeReleaseAnswer } from './qa/releaseRecords'
import { shipRelease } from './qa/releaseShipping'
import {
  addProjectPoolIdea,
  editProjectPoolIdea,
  markProjectPoolSeen,
  placeProjectPoolIdea,
  promoteProjectPoolIdea,
  reorderProjectPool,
  restoreProjectPoolIdea,
  setAsideProjectPoolIdea,
  type ProjectPool
} from './qa/pool'

const nowIso = (): string => new Date().toISOString()

// Verification hook: dev and installed builds share the same userData dir
// (single-instance lock included), so agent-driven checks need their own —
// otherwise a smoke test fights, or worse mutates, the live app. Keep the old
// variable as a compatibility fallback for harnesses outside this repository.
const userDataOverride = resolveUserDataOverride()
if (userDataOverride) app.setPath('userData', userDataOverride)

let store: UserDataStores['store']
let ticksStore: UserDataStores['ticksStore']
let inboxStore: UserDataStores['inboxStore']
let readingProgressStore: UserDataStores['readingProgressStore']
let viewStateStore: UserDataStores['viewStateStore']
let inboxStateHandlers: ReturnType<typeof createInboxStateHandlers>
let readingProgressHandlers: ReturnType<typeof createReadingProgressHandlers>
let service: QaService
let serviceRestartGeneration = 0
let windowManager: WindowManager<BrowserWindow>
// Where a `dtc://` link waits between arriving and a renderer claiming it.
const deepLinks = new PendingDeepLinks()

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled main-process promise rejection', reason)
})

function defaultWindowLayout(): WindowLayoutPreferences {
  const settings = store.get()
  return {
    pinned: settings.pinBehaviour === 'always' ? true : settings.pinned,
    widthPreset: settings.widthPreset,
    windowMode: settings.windowMode
  }
}

// Each window's temporary pin: a pin made on a wide window (pinInvariant.ts).
// Never persisted; the layout keeps recording it as unpinned.
const temporaryPins = new WeakMap<BrowserWindow, TemporaryPin>()

function settingsForWindow(win: BrowserWindow | null): Settings {
  const layout = windowManager?.stateFor(win)?.layout
  const settings = layout ? { ...store.get(), ...layout } : store.get()
  // The pin control shows a temporary pin as pinned.
  return win && temporaryPins.get(win)?.active ? { ...settings, pinned: true } : settings
}

// Each window's enlargement watcher, so main can mark its own moves (ticket 27).
const enlargementWatches = new WeakMap<BrowserWindow, EnlargementWatch>()

/**
 * Bounds main sets itself — docking and the docked re-snap. The enlargement
 * watcher is told first, so the move never counts as his enlargement and
 * never changes the pin (ticket 26's rule stays for the reviewer's own resizes).
 */
function setBoundsByMain(win: BrowserWindow, bounds: WindowBounds): void {
  enlargementWatches.get(win)?.expectProgrammaticResize(bounds.width)
  win.setBounds(bounds)
}

// Each window's run of repeated Dock clicks; any other window action ends it.
const dockCycles = new WeakMap<BrowserWindow, DockCycle>()

/** The edge the Dock button last used; the right edge before he has ever docked. */
function lastDockEdge(): 'left' | 'right' {
  return viewStateStore.getDockPlace()?.edge ?? 'right'
}

/**
 * A docked window's re-snap (relaunch, width change, display change): flush
 * with the last-used edge of the nearest display's work area, full height.
 */
function snapDocked(win: BrowserWindow, preset: Settings['widthPreset']): void {
  const wa = screen.getDisplayNearestPoint(win.getBounds()).workArea
  const bounds = windowManager
    .layoutFor(win)
    ?.resizeDocked(win.getBounds(), wa, preset, lastDockEdge())
  if (bounds) setBoundsByMain(win, bounds)
}

function dockDisplays(): DockDisplay[] {
  return screen.getAllDisplays().map((display) => ({ id: display.id, workArea: display.workArea }))
}

/**
 * The Dock button (ticket 27): the sidebar at `place`, or at the last-used
 * place. Sidebar width, full height, flush with that edge of that screen's
 * work area. The place is remembered for next time and across launches. The
 * pin is left exactly as it was.
 */
function dockWindow(win: BrowserWindow, place: DockPlaceId | 'last'): void {
  const displays = dockDisplays()
  const currentId = screen.getDisplayMatching(win.getBounds()).id
  let target: RememberedDockPlace
  if (place === 'last') {
    // The main part of the button: repeated clicks within about 4 seconds step
    // through the four places (ticket 41); otherwise the last-used place.
    const step = dockClickStep(
      dockCycles.get(win) ?? null,
      Date.now(),
      viewStateStore.getDockPlace(),
      displays,
      currentId
    )
    target = step.target
    dockCycles.set(win, step.cycle)
  } else {
    // A place picked from the menu is a fresh start for the next plain click.
    target = resolveDockPlace(place, displays, currentId)
    dockCycles.delete(win)
  }
  const { bounds, displayId } = dockBounds(target, displays, currentId, NARROW_WIDTH)
  viewStateStore.setDockPlace({ edge: target.edge, displayId })
  const current = windowManager.stateFor(win)?.layout ?? defaultWindowLayout()
  if (current.widthPreset !== 'narrow') {
    windowManager.setLayout(win, { ...current, widthPreset: 'narrow' })
  }
  setBoundsByMain(win, bounds)
}

function dockMenuFor(win: BrowserWindow): DockMenuState {
  const currentId = screen.getDisplayMatching(win.getBounds()).id
  return dockMenuState(viewStateStore.getDockPlace(), dockDisplays(), currentId)
}

/** Change only the width, keeping position and height, never off screen (free mode). */
function applyWidth(win: BrowserWindow, preset: Settings['widthPreset']): void {
  const wa = screen.getDisplayNearestPoint(win.getBounds()).workArea
  win.setBounds(freeBoundsForPreset(win.getBounds(), wa, preset))
}

/** Restore the docked/wide habitat once the first frame is up (relaunch). */
function applyInitialLayout(win: BrowserWindow): void {
  const s = settingsForWindow(win)
  if (s.windowMode === 'docked') snapDocked(win, s.widthPreset)
  else if (s.widthPreset === 'wide') applyWidth(win, s.widthPreset)
}

const sendSnapshotToAllWindows = createAllWindowsSender(
  () => windowManager?.liveWindows() ?? [],
  (win: BrowserWindow, snapshot: QaSnapshot): void => {
    win.webContents.send(IPC.snapshotChanged, snapshot)
    inboxStateHandlers.pushState(win.webContents)
  }
)

const sendRefreshStaleToAllWindows = createAllWindowsSender(
  () => windowManager?.liveWindows() ?? [],
  (win: BrowserWindow, message: string): void => {
    win.webContents.send(IPC.refreshStale, { message })
  }
)

const sendSettingsWriteFailedToAllWindows = createAllWindowsSender(
  () => windowManager?.liveWindows() ?? [],
  (win: BrowserWindow, failure: SettingsWriteFailure): void => {
    win.webContents.send(IPC.settingsWriteFailed, failure)
  }
)

function pushSnapshot(snapshot: QaSnapshot): void {
  sendSnapshotToAllWindows(snapshot)
  const badge = store.get().dockBadge ? service.badgeCount(snapshot) : 0
  app.setBadgeCount(badge)
  pruneUserDataForSnapshot(snapshot, ticksStore, inboxStore)
}

// Re-point the live watcher at a new root: stop the old one, stand a fresh
// QaService on the new path, restart the push loop. This is the M5 live re-watch
// (Settings "Change…" and onboarding) and also closes the M2 gap where a root
// that appeared after launch was never watched.
async function restartService(root: string): Promise<void> {
  const generation = ++serviceRestartGeneration
  const previous = service
  const next = new QaService(root, viewStateStore.getReceiptsStartAt())
  service = next
  await previous.stop()
  if (generation !== serviceRestartGeneration) {
    await next.stop()
    return
  }
  await next.start(pushSnapshot)
}

function refreshAfterWrite(): void {
  void service.refresh().catch((error) => {
    console.error('Report saved, but the record view could not refresh', error)
    sendRefreshStaleToAllWindows(
      'Saved, but the record view may be out of date until the next file change.'
    )
  })
}

async function authoritativeRequestPath(suppliedPath: string): Promise<string> {
  const snapshot = service.snapshot()
  return confineRequestPath(
    store.get().qaRepoPath,
    snapshot?.runs.map((run) => run.request.path) ?? [],
    suppliedPath
  )
}

/**
 * The one way a window's pin changes: the pin button, the pin command and every
 * enlargement all end here, so the level, the persisted layout and the pin
 * control in that window's renderer never disagree.
 */
function applyPinned(win: BrowserWindow, requested: boolean): void {
  // A pin on a wide window is temporary (pinInvariant.ts): on top and shown
  // pinned, but the saved layout says unpinned, and crossing the sidebar width
  // clears it.
  const temporary = requested && !mayBePinned(win.getBounds().width, NARROW_WIDTH)
  const pin = temporaryPins.get(win)
  if (pin) pin.active = temporary
  win.setAlwaysOnTop(requested, 'floating')
  const current = windowManager.stateFor(win)?.layout ?? defaultWindowLayout()
  windowManager.setLayout(win, { ...current, pinned: requested && !temporary })
  if (!win.webContents.isDestroyed()) {
    win.webContents.send(IPC.windowSettingsChanged, settingsForWindow(win))
  }
}

function isWindowPinned(win: BrowserWindow): boolean {
  return (
    windowManager.stateFor(win)?.layout.pinned === true || temporaryPins.get(win)?.active === true
  )
}

/**
 * @param bringForward a window a link asked for: shown, focused and raised
 *   above any pinned Dev Traffic Control window (ticket 26).
 */
function createWindow(
  slot: PersistedWindowState,
  preventPinnedOverlap = false,
  bringForward = false
): void {
  // Narrow-first habitat: a pinned strip beside the app under test (ADR-0004).
  // Sidebar = pinned (ticket 41): a sidebar-width window starts pinned and a
  // wide one does not, whatever pin the slot saved. The one exception is the
  // overlap guard for a new window exactly over its source.
  const wantsPin = preventPinnedOverlap ? false : true
  const targetWorkArea =
    slot.bounds && validBounds(slot.bounds)
      ? screen.getDisplayNearestPoint({ x: slot.bounds.x, y: slot.bounds.y }).workArea
      : screen.getPrimaryDisplay().workArea
  const geometry = windowGeometryForCreation(slot.bounds, targetWorkArea)
  // A saved pin never carries a wide window on top (pinInvariant.ts).
  const startPinned = wantsPin && mayBePinned(geometry.bounds.width, NARROW_WIDTH)
  if ('x' in geometry.bounds) viewStateStore.setWindowBounds(slot.slot, geometry.bounds)
  const win = new BrowserWindow({
    ...geometry.bounds,
    ...geometry.minimumSize,
    show: false,
    title: 'Dev Traffic Control',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    alwaysOnTop: startPinned,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  windowManager.register(win, slot.slot)
  // His own move or resize, like any other window action, ends a Dock click run.
  win.on('will-move', () => dockCycles.delete(win))
  win.on('will-resize', () => dockCycles.delete(win))
  win.on('move', () =>
    reviseWindowMinimums(win, (bounds) => screen.getDisplayNearestPoint(bounds).workArea)
  )
  if (startPinned !== slot.layout.pinned) {
    windowManager.setLayout(win, { ...slot.layout, pinned: startPinned })
  }
  if (startPinned) win.setAlwaysOnTop(true, 'floating')
  // Every enlargement unpins; narrowing never pins back (ticket 26).
  enlargementWatches.set(
    win,
    watchEnlargementUnpins(win, {
      sidebarWidth: NARROW_WIDTH,
      isPinned: () => isWindowPinned(win),
      unpin: () => applyPinned(win, false)
    })
  )

  // The invariant, whatever route made the window wide: restored bounds,
  // un-docking, a saved pin, a lift that outlived its welcome.
  const lift = new LinkLift()
  const temporary = new TemporaryPin()
  temporaryPins.set(win, temporary)
  const pinGuard = guardPinInvariant(win, {
    sidebarWidth: NARROW_WIDTH,
    lift,
    temporary,
    isPinned: () => isWindowPinned(win),
    unpin: () => applyPinned(win, false),
    pin: () => applyPinned(win, true)
  })

  // A window closed before its renderer ever asked takes its link with it;
  // nothing must be able to reappear in a later window that reuses the slot.
  win.on('closed', () => deepLinks.forget(slot.slot))

  const hiddenTestMode = isHiddenWindowTestMode()
  configureWindowVisibility(
    win,
    hiddenTestMode,
    () => {
      applyInitialLayout(win)
      pinGuard.settle()
    },
    bringForward
      ? () =>
          bringWindowForward(win, {
            hiddenTestMode,
            isPinned: () => isWindowPinned(win),
            pinnedPeerExists: () =>
              windowManager.liveWindows().some((peer) => peer !== win && isWindowPinned(peer)),
            lift,
            watchInteraction: (listener) => watchFirstTouch(win, listener),
            focusApp: process.platform === 'darwin' ? () => app.focus({ steal: true }) : undefined
          })
      : undefined
  )

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Input that counts as touching a window: a click, a key, a scroll, a tap, a drag. */
const TOUCH_INPUT = new Set(['mouseDown', 'mouseWheel', 'touchStart', 'gestureTap', 'keyDown'])

/**
 * Calls `listener` the first time he touches the window — a click, a key, or
 * moving or resizing it by hand (`will-move` and `will-resize` fire for the reviewer's own
 * moves, never for main's). Returns the function that stops listening.
 */
function watchFirstTouch(win: BrowserWindow, listener: () => void): () => void {
  const contents = win.webContents
  const onInput = (_event: unknown, input: { type: string }): void => {
    if (TOUCH_INPUT.has(input.type)) listener()
  }
  contents.on('before-input-event', onInput)
  contents.on('input-event', onInput)
  win.on('will-move', listener)
  win.on('will-resize', listener)
  return () => {
    if (win.isDestroyed()) return
    contents.off('before-input-event', onInput)
    contents.off('input-event', onInput)
    win.off('will-move', listener)
    win.off('will-resize', listener)
  }
}

function reconcileWindowsWithDisplays(): void {
  for (const win of windowManager.liveWindows()) {
    const workArea = screen.getDisplayNearestPoint(win.getBounds()).workArea
    reconcileWindowToWorkArea(win, workArea)
    const layout = windowManager.stateFor(win)?.layout
    if (layout?.windowMode === 'docked') snapDocked(win, layout.widthPreset)
  }
}

// ---------------------------------------------------------------------------
// Deep links — three verbs, two gates, one window rule (ADR-0016 § 5).
// ---------------------------------------------------------------------------

/** Parse and confine, in main, before any renderer sees a path. */
async function deepLinkArrival(url: string): Promise<DeepLinkArrival> {
  const recordRoot = store.get().qaRepoPath
  return resolveDeepLinkArrival(url, {
    recordRoot,
    lastPulledAt: () => recordRepoLastPulledAt(recordRoot)
  })
}

function deepLinkLanding(held: HeldDeepLink): DeepLinkLanding {
  return landingForArrival(
    held.arrival,
    held.url,
    held.coldLaunch,
    landingRecords(service.snapshot())
  )
}

/**
 * Give the link a window of its own, born with its scope.
 *
 * The scope is persisted against the slot BEFORE the window is constructed, so
 * the renderer restores it through the same path a relaunch uses and the window
 * is never created empty and then navigated. No live window is read from, sent
 * to, moved or focused: `createAllWindowsSender` fans to every window by design
 * and would yank the whole fleet onto one record, so it is deliberately not
 * used here.
 */
/** The shape the link's window takes: a request is the sidebar, anything read is big. */
function shapeForLink(held: HeldDeepLink): LinkWindowShape {
  return linkWindowShape(
    held.arrival,
    service.snapshot()?.runs ?? [],
    store.get().qaRepoPath,
    fallbackModeFor(held.arrival)
  )
}

/**
 * A saved slot (the reopened window, the cold-launch window) given the shape
 * its link asks for, saved before the window is built. Without it the link
 * opened in whatever the last window was, wide or narrow (ticket 41).
 */
function slotShapedForLink(slot: PersistedWindowState, held: HeldDeepLink): PersistedWindowState {
  const workArea =
    slot.bounds && validBounds(slot.bounds)
      ? screen.getDisplayNearestPoint({ x: slot.bounds.x, y: slot.bounds.y }).workArea
      : screen.getPrimaryDisplay().workArea
  const shaped = slotForLinkShape(slot, shapeForLink(held), workArea)
  viewStateStore.setWindowLayout(slot.slot, shaped.layout)
  if (shaped.bounds) viewStateStore.setWindowBounds(slot.slot, shaped.bounds)
  return viewStateStore.getWindow(slot.slot) ?? slot
}

function openWindowForDeepLink(held: HeldDeepLink): void {
  const scope = scopeForArrival(held.arrival)
  if (deepLinkRoute(windowManager.liveWindows().length) === 'reopened-window') {
    const reopened = slotShapedForLink(windowManager.reopenSlot(defaultWindowLayout()), held)
    viewStateStore.setWindowScope(reopened.slot, scope)
    deepLinks.holdForSlot(reopened.slot, held)
    createWindow(reopened, false, true)
    return
  }
  const sourceWindow = windowManager.focusTarget()
  const targetWorkArea = sourceWindow
    ? screen.getDisplayNearestPoint(sourceWindow.getBounds()).workArea
    : screen.getPrimaryDisplay().workArea
  // Design, roadmap and anything read opens big and unpinned; a test request
  // opens as the usual pinned sidebar.
  if (shapeForLink(held) === 'big') {
    const layout = {
      ...defaultWindowLayout(),
      widthPreset: 'wide' as const,
      windowMode: 'free' as const,
      pinned: false
    }
    const created = windowManager.createSlot(layout, bigLinkBounds(targetWorkArea))
    viewStateStore.setWindowScope(created.slot, scope)
    deepLinks.holdForSlot(created.slot, held)
    createWindow(created, true, true)
    return
  }
  // The sidebar is imposed, not copied from the focused window, which may be
  // a big one (alpha.24: big AND pinned).
  const next = sidebarLinkState(
    finaliseNewWindowState(
      windowManager.newWindowState(defaultWindowLayout(), targetWorkArea),
      targetWorkArea
    ),
    targetWorkArea
  )
  const created = windowManager.createSlot(next.layout, next.bounds)
  viewStateStore.setWindowScope(created.slot, scope)
  deepLinks.holdForSlot(created.slot, held)
  createWindow(created, next.preventPinnedOverlap === true, true)
}

/**
 * The confined record's own header, for a request the scan has not reached
 * yet. Reads the first few kilobytes of a path the resolver already confined;
 * any failure means "unknown", which opens the sidebar.
 */
function fallbackModeFor(arrival: HeldDeepLink['arrival']): RequestMode | undefined {
  if (arrival.kind !== 'record') return undefined
  try {
    const fd = openSync(arrival.path, 'r')
    try {
      const buffer = Buffer.alloc(4096)
      const read = readSync(fd, buffer, 0, buffer.length, 0)
      return modeFromFrontmatter(buffer.subarray(0, read).toString('utf8'))
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

/** The one handler every arrival path ends in, so none of them can rot. */
async function handleDeepLinkUrl(url: string): Promise<void> {
  // Before ready there is no window, no slot and no settings to confine
  // against. The URL waits; `whenReady` lands it in the main window.
  if (!app.isReady()) {
    deepLinks.holdUntilReady(url)
    return
  }
  openWindowForDeepLink({ url, arrival: await deepLinkArrival(url), coldLaunch: false })
}

function acceptDeepLink(url: string): void {
  void handleDeepLinkUrl(url).catch((error) => console.error('A link could not be opened', error))
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSnapshot, async (): Promise<QaSnapshot> => {
    return (
      service.snapshot() ?? {
        root: store.get().qaRepoPath,
        rootMissing: true,
        runs: [],
        notes: [],
        entries: [],
        threads: [],
        handoffs: [],
        releases: [],
        pools: [],
        projects: [],
        scannedAt: new Date().toISOString()
      }
    )
  })
  ipcMain.handle(IPC.getVersion, (): string => app.getVersion())
  ipcMain.handle(IPC.getSettings, (event): Settings => {
    return settingsForWindow(BrowserWindow.fromWebContents(event.sender))
  })
  ipcMain.handle(IPC.getSettingsLog, () => store.log())
  ipcMain.handle(IPC.getViewState, (event): ViewState => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const slot = windowManager.slotFor(win)
    return slot ? viewStateStore.get(slot) : { rightPanels: {} }
  })
  ipcMain.handle(IPC.setRightPanels, (event, rightPanels: ViewState['rightPanels']): ViewState => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const slot = windowManager.slotFor(win)
    return slot ? viewStateStore.setRightPanels(rightPanels, slot) : { rightPanels: {} }
  })
  ipcMain.handle(IPC.getWindowScope, (event): WindowScopeState => {
    const slot = windowManager.slotFor(BrowserWindow.fromWebContents(event.sender))
    return slot ? viewStateStore.getWindowScope(slot) : { lastSurfaceByProject: {} }
  })
  ipcMain.handle(IPC.setWindowScope, (event, scope: unknown): WindowScopeState => {
    const slot = windowManager.slotFor(BrowserWindow.fromWebContents(event.sender))
    if (!slot) return { lastSurfaceByProject: {} }
    if (!isWindowScope(scope)) return viewStateStore.getWindowScope(slot)
    return viewStateStore.setWindowScope(slot, scope)
  })
  ipcMain.handle(IPC.rememberProjectSurface, (event, surface: unknown): WindowScopeState => {
    const slot = windowManager.slotFor(BrowserWindow.fromWebContents(event.sender))
    if (!slot) return { lastSurfaceByProject: {} }
    if (typeof surface !== 'string' || surface.length === 0) {
      return viewStateStore.getWindowScope(slot)
    }
    return viewStateStore.rememberSurfaceInScope(slot, surface)
  })
  // The renderer claims the link its window was born for. Pull, not push: a
  // send into a renderer that has not mounted is dropped silently.
  ipcMain.handle(IPC.takeDeepLink, async (event): Promise<DeepLinkLanding | null> => {
    const slot = windowManager.slotFor(BrowserWindow.fromWebContents(event.sender))
    if (!slot) return null
    const held = deepLinks.claim(slot)
    if (!held) return null
    // A cold launch claims before the first scan has published, and the view a
    // link opens on is decided from the scanned records. Waiting is the
    // difference between landing on the record and landing on its project.
    if (!service.snapshot()) await service.refresh()
    const landing = deepLinkLanding(held)
    // A record written moments before its link was clicked may not be in the
    // scan yet, and would land on its project instead of on itself. One fresh
    // scan settles it.
    if (
      held.arrival.kind === 'record' &&
      landing.kind === 'opened' &&
      landing.view.kind === 'project'
    ) {
      await service.refresh()
      return deepLinkLanding(held)
    }
    return landing
  })
  // Sync lag, not refusal: pull, rescan, then resolve the link again from
  // scratch. The URL is re-parsed and re-confined here — main never trusts the
  // renderer's copy of a decision it already made.
  ipcMain.handle(IPC.retryDeepLink, async (_event, url: unknown): Promise<DeepLinkRetryResult> => {
    if (typeof url !== 'string') return { landing: { kind: 'refused', coldLaunch: false } }
    const pull = await pullRecordRepo(store.get().qaRepoPath)
    await service.refresh()
    const arrival = await deepLinkArrival(url)
    return {
      landing: landingForArrival(arrival, url, false, landingRecords(service.snapshot())),
      ...(pull.ok ? {} : { pullFailed: pull.message })
    }
  })
  ipcMain.handle(IPC.firstRun, (): boolean => store.wasFreshlyCreated())
  // Native folder picker for the record-path row and onboarding, and the two
  // calls it feeds (bootstrapRepo, setSetting('qaRepoPath')): main remembers
  // each window's picked folder itself, and both accept only that, the current
  // root or a root from main's own settings log (bootstrapIpc).
  const rootChoice = createRootChoiceHandlers<IpcMainInvokeEvent, Settings>({
    currentRoot: () => store.get().qaRepoPath,
    previousRoots: () =>
      store
        .log()
        .filter((change) => change.key === 'qaRepoPath')
        .flatMap((change) => [change.from, change.to])
        .filter((root): root is string => typeof root === 'string'),
    senderId: (event) => event.sender.id,
    showFolderDialog: async (event) => {
      const options = {
        properties: ['openDirectory', 'createDirectory'] as Array<
          'openDirectory' | 'createDirectory'
        >
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
    bootstrap: (root) => {
      const previousRoot = store.get().qaRepoPath
      const restartNeeded =
        root !== previousRoot || !service.snapshot() || service.snapshot()?.rootMissing === true
      return bootstrapRecordRoot(root, previousRoot, restartNeeded, {
        ensureRoot: ensureQaRepo,
        restartService,
        persistRoot: (nextRoot) => store.setTransactional('qaRepoPath', nextRoot)
      })
    },
    setRoot: async (event, root) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const previousRoot = store.get().qaRepoPath
      const updated = await store.setTransactional('qaRepoPath', root)
      if (updated.qaRepoPath !== previousRoot) await restartService(updated.qaRepoPath)
      return { ...updated, ...windowManager.stateFor(win)?.layout }
    }
  })
  ipcMain.handle(
    IPC.setSetting,
    async (event, key: keyof Settings, value: Settings[keyof Settings]): Promise<Settings> => {
      if (key === 'qaRepoPath') {
        // Re-pointing the root is gated like bootstrapRepo; a refusal rejects
        // the call so the renderer shows the failure, and nothing is written.
        const updated = await rootChoice.setRoot(event, value)
        if (!updated) throw new Error('That folder was not chosen in the folder dialog')
        return updated
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      store.set(key as keyof Settings, value)
      return settingsForWindow(win)
    }
  )
  ipcMain.handle(IPC.pickFolder, (event): Promise<string | null> => rootChoice.pickFolder(event))
  ipcMain.handle(IPC.newWindow, (): void => {
    const sourceWindow = windowManager.focusTarget()
    const targetWorkArea = sourceWindow
      ? screen.getDisplayNearestPoint(sourceWindow.getBounds()).workArea
      : screen.getPrimaryDisplay().workArea
    const next = finaliseNewWindowState(
      windowManager.newWindowState(defaultWindowLayout(), targetWorkArea),
      targetWorkArea
    )
    createWindow(
      windowManager.createSlot(next.layout, next.bounds),
      next.preventPinnedOverlap === true
    )
  })
  // First-run bootstrap: persist the chosen root, materialise the contract via
  // the app's own M1 bootstrap (never hand-crafted), then re-point the watcher.
  ipcMain.handle(IPC.bootstrapRepo, (event, root: unknown): Promise<Settings | null> =>
    rootChoice.bootstrapRepo(event, root)
  )
  ipcMain.handle(IPC.setPinned, (e, value: boolean): Settings => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) {
      dockCycles.delete(win)
      applyPinned(win, value)
    }
    return settingsForWindow(win)
  })
  ipcMain.handle(IPC.resetWindowPosition, (event): Settings => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const workArea = screen.getDisplayNearestPoint(win.getBounds()).workArea
      resetWindowPosition(win, workArea, windowManager, defaultWindowLayout())
    }
    return settingsForWindow(win)
  })
  // Window feel (relief pass R1): width and dock. Main owns the resize so the
  // renderer only reflects the returned settings; a docked window re-snaps.
  ipcMain.handle(IPC.setWidthPreset, (e, preset: Settings['widthPreset']): Settings => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) {
      dockCycles.delete(win)
      const current = windowManager.stateFor(win)?.layout ?? defaultWindowLayout()
      // Resize first, then pin: a resize event on the way must not see the new
      // pin on a still-wide window (pinInvariant.ts would unpin it).
      if (current.windowMode === 'docked') snapDocked(win, preset)
      else applyWidth(win, preset)
      const pinned = pinnedForPreset(preset)
      // The preset sets the pin outright; a temporary pin does not outlive it.
      const temporary = temporaryPins.get(win)
      if (temporary) temporary.active = false
      windowManager.setLayout(win, { ...current, widthPreset: preset, pinned })
      win.setAlwaysOnTop(pinned, 'floating')
    }
    return settingsForWindow(win)
  })
  ipcMain.handle(IPC.setWindowMode, (e, mode: Settings['windowMode']): Settings => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const current = win
      ? (windowManager.stateFor(win)?.layout ?? defaultWindowLayout())
      : defaultWindowLayout()
    if (win) dockCycles.delete(win)
    if (mode === 'docked') {
      // Docking never changes the pin (ticket 27).
      const docked = settingsForDock(current)
      if (win) {
        windowManager.setLayout(win, docked)
        const wa = screen.getDisplayNearestPoint(win.getBounds()).workArea
        const bounds = windowManager.layoutFor(win)?.dock(win.getBounds(), wa, lastDockEdge())
        if (bounds) setBoundsByMain(win, bounds)
      }
    } else {
      if (win) {
        windowManager.setLayout(win, { ...current, windowMode: mode })
        if (current.windowMode === 'docked') {
          // Undocking restores the bounds from before the dock, often wider.
          // That is main's move, not his enlargement: it keeps the pin.
          const bounds = windowManager.layoutFor(win)?.undock(win.getBounds(), current.widthPreset)
          if (bounds) setBoundsByMain(win, bounds)
        } else {
          applyWidth(win, current.widthPreset)
        }
      }
    }
    return settingsForWindow(win)
  })

  // Ticket 27: the Dock split button. The main part docks at the last-used
  // place; the ▾ menu reads the four places and docks at the one he picks.
  ipcMain.handle(IPC.dock, (e, place: unknown): Settings => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win && (place === 'last' || isDockPlaceId(place))) dockWindow(win, place)
    return settingsForWindow(win)
  })
  ipcMain.handle(IPC.dockMenu, (e): DockMenuState | null => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win ? dockMenuFor(win) : null
  })

  // Read-only record surfaces. Both helpers resolve and confine paths against
  // the configured root; neither follows a symlink outside it or writes files.
  ipcMain.handle(IPC.searchRecord, (_e, query: string) => {
    return searchRecordBodies(store.get().qaRepoPath, query)
  })
  ipcMain.handle(IPC.readRecordFiles, (_e, files: string[]) => {
    return readRecordFiles(store.get().qaRepoPath, files)
  })
  ipcMain.handle(
    IPC.answerRelease,
    async (_event, input: ReleaseAnswerInput): Promise<ReleaseAnswerResult> => {
      const release = service
        .snapshot()
        ?.releases?.find(
          (candidate) =>
            candidate.kind === 'recorded' &&
            candidate.project === input.project &&
            candidate.record.version === input.version
        )
      if (!release || release.kind !== 'recorded') throw new Error('Release record not found.')
      const result = await writeReleaseAnswer(
        release.record,
        input.id,
        input.verdict,
        input.comment,
        nowIso(),
        Array.isArray(input.screenshots) ? input.screenshots : undefined
      )
      refreshAfterWrite()
      return result
    }
  )
  // Verdict pictures (ticket 25): confined to a feature of a release in the
  // snapshot and to `<project>/releases/<version>.shots/` (releaseShotIpc).
  // A refused call returns null and touches nothing.
  const releaseShotHandlers = createReleaseShotHandlers({
    recordRoot: () => store.get().qaRepoPath,
    snapshot: () => service.snapshot()
  })
  ipcMain.handle(IPC.addVerdictShot, (_e, input: unknown): Promise<string | null> =>
    releaseShotHandlers.add(input)
  )
  ipcMain.handle(IPC.readVerdictShot, (_e, input: unknown): Promise<string | null> =>
    releaseShotHandlers.read(input)
  )
  ipcMain.handle(
    IPC.shipRelease,
    async (_event, input: ReleaseShipInput): Promise<ReleaseShipResult> => {
      const release = service
        .snapshot()
        ?.releases?.find(
          (candidate) => candidate.kind === 'recorded' && candidate.project === input.project
        )
      if (!release || release.kind !== 'recorded' || release.inFlightVersion !== input.version) {
        throw new Error('The release in flight was not found.')
      }
      const version = release.versions.find((candidate) => candidate.version === input.version)
      if (!version || version.shipment) throw new Error('The release in flight was not found.')
      const result = await shipRelease({
        root: store.get().qaRepoPath,
        project: input.project,
        record: version.record,
        notes: input.notes,
        shippedAt: nowIso(),
        ...(input.fixesTo ? { fixesTo: input.fixesTo } : {})
      })
      refreshAfterWrite()
      return result
    }
  )
  ipcMain.handle(
    IPC.reorderPool,
    async (_event, input: PoolReorderInput): Promise<PoolReorderResult> => {
      if (!service.snapshot()?.projects.includes(input.project)) {
        throw new Error('Roadmap app not found.')
      }
      const result =
        input.beforeId !== undefined
          ? await placeProjectPoolIdea(
              store.get().qaRepoPath,
              input.project,
              input.id,
              input.beforeId
            )
          : await reorderProjectPool(
              store.get().qaRepoPath,
              input.project,
              input.id,
              input.direction
            )
      refreshAfterWrite()
      return result
    }
  )
  ipcMain.handle(
    IPC.writePoolIdea,
    async (_event, input: PoolIdeaWriteInput): Promise<PoolIdeaWriteResult> => {
      if (!service.snapshot()?.projects.includes(input.project)) {
        throw new Error('Roadmap app not found.')
      }
      const root = store.get().qaRepoPath
      const result =
        input.action === 'add'
          ? await addProjectPoolIdea(root, input.project, {
              title: input.title,
              bodyMarkdown: input.bodyMarkdown,
              tier: input.tier,
              addedAt: nowIso()
            })
          : {
              pool: await editProjectPoolIdea(root, input.project, input.id, {
                ...(input.title !== undefined ? { title: input.title } : {}),
                ...(input.bodyMarkdown !== undefined ? { bodyMarkdown: input.bodyMarkdown } : {}),
                ...(input.appendEntry !== undefined ? { appendEntry: input.appendEntry } : {}),
                ...(input.fate !== undefined ? { fate: input.fate } : {}),
                ...(input.candidate !== undefined ? { candidate: input.candidate } : {})
              }),
              id: input.id
            }
      refreshAfterWrite()
      return result
    }
  )
  ipcMain.handle(IPC.markPoolSeen, async (_event, input: PoolSeenInput): Promise<ProjectPool> => {
    if (!service.snapshot()?.projects.includes(input.project)) {
      throw new Error('Roadmap app not found.')
    }
    const result = await markProjectPoolSeen(store.get().qaRepoPath, input.project, nowIso())
    refreshAfterWrite()
    return result
  })
  ipcMain.handle(
    IPC.transitionPool,
    async (_event, input: PoolTransitionInput): Promise<ProjectPool> => {
      if (!service.snapshot()?.projects.includes(input.project)) {
        throw new Error('Roadmap app not found.')
      }
      const root = store.get().qaRepoPath
      const result =
        input.action === 'promote'
          ? await promoteProjectPoolIdea(
              root,
              input.project,
              input.id,
              input.release,
              input.specWanted,
              nowIso()
            )
          : input.action === 'setaside'
            ? await setAsideProjectPoolIdea(root, input.project, input.id, input.reason, nowIso())
            : await restoreProjectPoolIdea(root, input.project, input.id)
      refreshAfterWrite()
      return result
    }
  )

  // Runner IO — main stamps every timestamp (ADR-0003); no write on open.
  ipcMain.handle(IPC.openRun, async (event, requestPath: string): Promise<OpenRunResult> => {
    const authoritativePath = await authoritativeRequestPath(requestPath)
    const opened = await inboxStateHandlers.openRun(
      event.sender,
      authoritativePath,
      ticksKeyFor(store.get().qaRepoPath, authoritativePath)
    )
    // Ticket 16: tell a waiting agent he has arrived. Only a path confined to
    // a request in the snapshot gets here; never awaited, never fatal.
    void writeArming(
      armingFor(authoritativePath, opened.exists ? opened.report : null, hostname(), nowIso())
    )
    return opened
  })
  ipcMain.handle(
    IPC.saveReport,
    async (_e, requestPath: string, report: QaReport): Promise<SaveReportResult> => {
      const authoritativePath = await authoritativeRequestPath(requestPath)
      try {
        const result = await save(authoritativePath, report)
        refreshAfterWrite()
        return { ok: true, ...result }
      } catch (error) {
        if (error instanceof ReportRecoveryError) {
          return {
            ok: false,
            refusal: { kind: 'invalid-on-disk', path: error.reportPath, message: error.message }
          }
        }
        throw error
      }
    }
  )
  ipcMain.handle(
    IPC.finishRun,
    async (_e, requestPath: string, report: QaReport): Promise<ReportMutationResult> => {
      const authoritativePath = await authoritativeRequestPath(requestPath)
      try {
        const stamped = await finish(authoritativePath, report, nowIso)
        refreshAfterWrite()
        return { ok: true, report: stamped }
      } catch (error) {
        if (error instanceof ReportRecoveryError) {
          return {
            ok: false,
            refusal: { kind: 'invalid-on-disk', path: error.reportPath, message: error.message }
          }
        }
        throw error
      }
    }
  )
  ipcMain.handle(IPC.reopenRun, async (_e, requestPath: string): Promise<ReportMutationResult> => {
    const authoritativePath = await authoritativeRequestPath(requestPath)
    try {
      const cleared = await reopen(authoritativePath)
      // Fresh walk on re-test (ADR-0004 Amendment 5): the ticks go with the stamp.
      ticksStore.clear(ticksKeyFor(store.get().qaRepoPath, authoritativePath))
      refreshAfterWrite()
      return { ok: true, report: cleared }
    } catch (error) {
      if (error instanceof ReportRecoveryError) {
        return {
          ok: false,
          refusal: { kind: 'invalid-on-disk', path: error.reportPath, message: error.message }
        }
      }
      throw error
    }
  })
  ipcMain.handle(
    IPC.setAsideCorruptReport,
    async (_e, requestPath: string, report?: QaReport): Promise<OpenRunResult> => {
      const authoritativePath = await authoritativeRequestPath(requestPath)
      if (report) await recoverCorruptReport(authoritativePath, report, nowIso)
      else await setAsideCorruptReport(authoritativePath, nowIso)
      const opened = await openRun(authoritativePath, nowIso)
      refreshAfterWrite()
      return opened
    }
  )
  ipcMain.handle(
    IPC.addShot,
    async (_e, requestPath: string, itemId: unknown, pngBase64: string): Promise<string> => {
      const authoritativePath = await authoritativeRequestPath(requestPath)
      return storeShot(
        store.get().qaRepoPath,
        authoritativePath,
        itemId,
        Buffer.from(pngBase64, 'base64')
      )
    }
  )
  ipcMain.handle(
    IPC.readShot,
    async (_e, requestPath: string, relPath: string): Promise<string> => {
      // A note's thumbnails ask with the note's path, which is not a scanned
      // request: noteIpc confines that read to the note's own shots folder.
      if (isNoteFileName(basename(requestPath))) {
        const url = await noteHandlers.readShot(requestPath, relPath)
        if (!url) throw new Error('screenshot is not readable')
        return url
      }
      const authoritativePath = await authoritativeRequestPath(requestPath)
      return readShotDataUrl(authoritativePath, relPath)
    }
  )

  // Ticks (ADR-0004 Amendment 5) — app-local progress, never report.json.
  ipcMain.handle(IPC.getTicks, (_e, reportBasename: string): ReportTicks => {
    return ticksStore.get(reportBasename)
  })
  ipcMain.handle(
    IPC.setItemTicks,
    (_e, reportBasename: string, itemId: string, item: ItemTicks): void => {
      ticksStore.setItem(reportBasename, itemId, item)
    }
  )

  // Inbox state (relief pass R4) — app-local NEW markers + archive.
  ipcMain.handle(IPC.getInboxState, (): InboxState => inboxStore.get())
  ipcMain.handle(IPC.markSeen, (event, basename: string): InboxState => {
    return inboxStateHandlers.markSeen(event.sender, basename)
  })
  ipcMain.handle(IPC.archiveRequest, (event, basename: string): InboxState => {
    return inboxStateHandlers.archive(event.sender, basename)
  })
  ipcMain.handle(IPC.unarchiveRequest, (event, basename: string): InboxState => {
    return inboxStateHandlers.unarchive(event.sender, basename)
  })
  // Every path is confined to the scanned snapshot first (handoffIpc):
  // archive, restore, copy prompt; archive old uses the same helper.
  const handoffHandlers = createHandoffHandlers({
    snapshot: () => service.snapshot(),
    refreshAfterWrite,
    writeClipboard: (text) => clipboard.writeText(text),
    now: nowIso
  })
  // Archive old (ticket 22). Every entry is confined to the snapshot before
  // anything is written; handoff sidecars are the only record writes.
  ipcMain.handle(
    IPC.archiveOld,
    async (event, input: ArchiveOldInput): Promise<ArchiveOldResult> => {
      const confined = confineArchiveOld(input, service.snapshot())
      const inbox = inboxStateHandlers.archiveMany(
        event.sender,
        confined.requests,
        confined.threads
      )
      for (const handoffPath of confined.handoffs) await archiveHandoff(handoffPath, nowIso)
      if (confined.handoffs.length) refreshAfterWrite()
      return {
        inbox,
        archived: {
          requests: confined.requests.length,
          threads: confined.threads.length,
          handoffs: confined.handoffs.length
        }
      }
    }
  )
  ipcMain.handle(IPC.unarchiveThread, (event, id: string): InboxState => {
    return inboxStateHandlers.unarchiveThread(event.sender, id)
  })
  ipcMain.handle(IPC.unarchiveHandoff, (_e, handoffPath: unknown): Promise<HandoffSidecar | null> =>
    handoffHandlers.unarchive(handoffPath)
  )

  ipcMain.handle(IPC.getReadingProgress, (): ReadingProgressState => {
    return readingProgressHandlers.get()
  })
  ipcMain.handle(
    IPC.setReadingProgress,
    (_event, requestPath: string, progress: Omit<ReadingProgress, 'updatedAt'>): ReadingProgress =>
      readingProgressHandlers.set(requestPath, progress)
  )

  // Handoffs — the document stays agent-owned. Copy and Archive write only
  // the app-owned sidecar beside it, through the atomic writer.
  ipcMain.handle(
    IPC.copyHandoffPrompt,
    (_e, handoffPath: unknown): Promise<HandoffSidecar | null> =>
      handoffHandlers.copyPrompt(handoffPath)
  )
  ipcMain.handle(IPC.archiveHandoff, (_e, handoffPath: unknown): Promise<HandoffSidecar | null> =>
    handoffHandlers.archive(handoffPath)
  )
  // Show in Finder reveals only what the record holds (revealIpc): a scanned
  // handoff, or a path that resolves inside the record root.
  const revealHandlers = createRevealHandlers({
    recordRoot: () => store.get().qaRepoPath,
    snapshot: () => service.snapshot(),
    showItemInFolder: (fullPath) => shell.showItemInFolder(fullPath)
  })
  ipcMain.handle(IPC.revealHandoff, (_e, handoffPath: unknown): boolean =>
    revealHandlers.revealHandoff(handoffPath)
  )
  ipcMain.handle(IPC.revealPath, (_e, filePath: unknown): Promise<boolean> =>
    revealHandlers.revealPath(filePath)
  )
  // The example project (ticket 34): a fixed folder under the record root,
  // copied from the bundle only when absent and removed only while it carries
  // the app's marker (exampleProject). The renderer supplies no path.
  const exampleHandlers = createExampleHandlers({
    recordRoot: () => store.get().qaRepoPath,
    // Not a Vite ?asset import (unlike the icon): resolved from resources/ beside
    // out/, with the asar path swapped for app.asar.unpacked in a packaged app.
    sourceDir: () =>
      join(__dirname, '../../resources/example-app').replace('app.asar', 'app.asar.unpacked'),
    refresh: () => service.refresh()
  })
  ipcMain.handle(IPC.openExample, () => exampleHandlers.open())
  ipcMain.handle(IPC.removeExample, () => exampleHandlers.remove())
  ipcMain.handle(IPC.examplePresent, () => exampleHandlers.present())
  ipcMain.handle(
    IPC.copyCollectPrompt,
    async (_event, requestPath: string, title: string): Promise<void> => {
      const authoritativePath = await authoritativeRequestPath(requestPath)
      clipboard.writeText(collectPrompt(title, authoritativePath, store.get().qaRepoPath))
    }
  )

  // Note IO — main stamps every timestamp (ADR-0003); notes are created lazily,
  // so the file appears only when the editor has content to save.
  // Every note path and folder is confined to a note location inside the
  // record root (noteIpc); writes also need a note main itself found or made.
  // A refused call returns null and touches nothing.
  const noteHandlers = createNoteHandlers({
    recordRoot: () => store.get().qaRepoPath,
    snapshot: () => service.snapshot(),
    now: nowIso
  })
  ipcMain.handle(IPC.createNote, (_e, dir: unknown, title: unknown): Promise<NoteDoc | null> =>
    noteHandlers.create(dir, title)
  )
  ipcMain.handle(IPC.openNote, (_e, notePath: unknown): Promise<NoteDoc | null> =>
    noteHandlers.open(notePath)
  )
  ipcMain.handle(IPC.saveNote, (_e, doc: unknown): Promise<{ savedAt: string } | null> =>
    noteHandlers.save(doc)
  )
  ipcMain.handle(IPC.handOverNote, (_e, notePath: unknown): Promise<NoteDoc | null> =>
    noteHandlers.handOver(notePath)
  )
  ipcMain.handle(IPC.reopenNote, (_e, notePath: unknown): Promise<NoteDoc | null> =>
    noteHandlers.reopen(notePath)
  )
  ipcMain.handle(
    IPC.addNoteShot,
    (_e, notePath: unknown, pngBase64: unknown): Promise<string | null> =>
      noteHandlers.addShot(notePath, pngBase64)
  )
  ipcMain.handle(
    IPC.linkNoteToReport,
    async (_e, requestPath: string, noteBasename: string): Promise<void> => {
      const authoritativePath = await authoritativeRequestPath(requestPath)
      return linkNoteToReport(authoritativePath, noteBasename)
    }
  )
}

// Single instance: a second launch focuses the running window and quits itself,
// so two copies never watch the same repo or fight over the report files.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const userDataStores = bootstrapUserData(
    app.getPath('userData'),
    sendSettingsWriteFailedToAllWindows
  )
  store = userDataStores.store
  ticksStore = userDataStores.ticksStore
  inboxStore = userDataStores.inboxStore
  readingProgressStore = userDataStores.readingProgressStore
  viewStateStore = userDataStores.viewStateStore
  windowManager = new WindowManager(viewStateStore)

  // Deep-link registration (mechanism.md § 2). In development the scheme is
  // registered with `process.execPath` and the app path, or a link opens the
  // INSTALLED build instead of the one being worked on.
  // A hidden test run never registers: it would take dtc:// away from the
  // installed app and leave links opening a bare Electron (28 Sep 2026).
  const protocolClient = protocolClientRegistration(app.isPackaged, process.execPath, process.argv)
  if (isHiddenWindowTestMode()) {
    // leave the system's dtc:// handler alone
  } else if (protocolClient.execPath) {
    app.setAsDefaultProtocolClient(
      protocolClient.scheme,
      protocolClient.execPath,
      protocolClient.args
    )
  } else {
    app.setAsDefaultProtocolClient(protocolClient.scheme)
  }
  // Arrival path 1 and 2: running with a window, and running with none. Both
  // reach `open-url`; the second has nothing to deliver to until a window
  // exists, which is why the handler creates one rather than sending.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    acceptDeepLink(url)
  })
  // Arrival path 3: the app launched BECAUSE of the link. On macOS `open-url`
  // fires before `whenReady`; elsewhere the URL is argv. Both are held.
  const launchDeepLink = deepLinkFromArgv(process.argv)
  if (launchDeepLink) deepLinks.holdUntilReady(launchDeepLink)
  inboxStateHandlers = createInboxStateHandlers(inboxStore, (requestPath) =>
    openRun(requestPath, nowIso)
  )
  readingProgressHandlers = createReadingProgressHandlers(readingProgressStore)
  viewStateStore.ensureReceiptsStartAt()
  service = new QaService(store.get().qaRepoPath, viewStateStore.getReceiptsStartAt())

  const ensureWindowAndRaise = createEnsureWindowAndRaiseHandler({
    focusTarget: () => windowManager.focusTarget(),
    reopenSlot: () => windowManager.reopenSlot(defaultWindowLayout()),
    createWindow,
    raiseWindow: (target) => showWindowForSecondInstance(target, isHiddenWindowTestMode())
  })
  // A second launch that carries a link opens that link rather than raising
  // what is already there. Extending this handler is what breaks the
  // source-text assertion in `__tests__/index.wiring.test.ts` by design.
  app.on('second-instance', (_event, argv) => {
    const url = deepLinkFromArgv(argv)
    if (url) {
      acceptDeepLink(url)
      return
    }
    ensureWindowAndRaise()
  })

  app.on('before-quit', () => windowManager.beginQuit())
  app.on('window-all-closed', createWindowAllClosedHandler(process.platform, app))

  app.on(
    'will-quit',
    createWillQuitHandler(app, {
      stop: () => service.stop(),
      flush: async () => {
        const results = await Promise.allSettled([
          store.flush(),
          ticksStore.flush(),
          viewStateStore.flush(),
          inboxStore.flush(),
          readingProgressStore.flush()
        ])
        const failures = results.filter((result) => result.status === 'rejected')
        if (failures.length > 0) throw new Error(`${failures.length} app-state write(s) failed`)
      }
    })
  )

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.techczech.dev-traffic-control')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpc()
    // Contract handover (M8 T3): a build bundling a newer template refreshes
    // the records folder's live AGENTS.md at launch. Never creates a missing root.
    void refreshContract(store.get().qaRepoPath).catch((error) =>
      console.error('Record contract maintenance failed', error)
    )
    // Cold launch (mockup state 20): the app started BECAUSE of the link, so
    // there is nothing to leave alone and the link lands in the main window —
    // on the record, not on Overview with the record a click away.
    const heldUntilReady = deepLinks.takeHeldUntilReady()
    const startupSlots = windowManager.startupSlots(defaultWindowLayout())
    const [coldLaunchUrl, ...alsoHeld] = heldUntilReady
    if (coldLaunchUrl && startupSlots[0]) {
      const arrival = await deepLinkArrival(coldLaunchUrl)
      viewStateStore.setWindowScope(startupSlots[0].slot, scopeForArrival(arrival))
      const coldHeld: HeldDeepLink = { url: coldLaunchUrl, arrival, coldLaunch: true }
      deepLinks.holdForSlot(startupSlots[0].slot, coldHeld)
      // The window the link lands in takes the link's shape, not the last window's.
      startupSlots[0] = slotShapedForLink(startupSlots[0], coldHeld)
    }
    // The window a cold-launch link lands in comes forward like any link's.
    const coldLinkSlot = coldLaunchUrl ? startupSlots[0]?.slot : undefined
    for (const slot of startupSlots) createWindow(slot, false, slot.slot === coldLinkSlot)
    // Anything else that arrived in the same burst follows the running rule.
    for (const url of alsoHeld) acceptDeepLink(url)
    // The record watcher and settings stores are process-wide. New windows
    // subscribe to the same pushes and never start a second service.
    void service
      .start(pushSnapshot)
      .catch((error) => console.error('Record service could not complete startup', error))

    // Every display topology change confines windows, revises minimums and
    // restores docked placement against the surviving nearest display.
    screen.on('display-metrics-changed', reconcileWindowsWithDisplays)
    screen.on('display-removed', reconcileWindowsWithDisplays)
    screen.on('display-added', reconcileWindowsWithDisplays)

    app.on('activate', ensureWindowAndRaise)
  })
}
