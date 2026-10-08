import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'

async function indexSource(): Promise<string> {
  return readFile(new URL('../index.ts', import.meta.url), 'utf8')
}

async function builderConfig(): Promise<{
  mac?: { extendInfo?: Record<string, unknown> }
}> {
  return parse(await readFile(new URL('../../../electron-builder.yml', import.meta.url), 'utf8'))
}

function snapshotSenderSource(source: string): string {
  const start = source.indexOf('const sendSnapshotToAllWindows')
  const end = source.indexOf('function pushSnapshot', start)
  if (start < 0 || end < 0) throw new Error('snapshot sender source block not found')
  return source.slice(start, end)
}

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  if (start < 0 || end < 0) throw new Error(`source block not found: ${startMarker}`)
  return source.slice(start, end)
}

describe('main/index.ts inbox-state wiring', () => {
  test('acquires the single-instance lock before bootstrapping user data', async () => {
    const source = await indexSource()
    const lock = source.indexOf('if (!app.requestSingleInstanceLock())')
    const bootstrap = source.indexOf('bootstrapUserData(', lock)

    expect(lock).toBeGreaterThan(-1)
    expect(bootstrap).toBeGreaterThan(lock)
  })

  test('resolves all live windows for every snapshot push', async () => {
    const block = snapshotSenderSource(await indexSource())

    expect(block).toContain('createAllWindowsSender(')
    expect(block).toContain('() => windowManager?.liveWindows() ?? []')
    expect(block).toContain('win.webContents.send(IPC.snapshotChanged, snapshot)')
    expect(block).toContain('inboxStateHandlers.pushState(win.webContents)')
  })

  test('routes the refresh-stale push through an all-windows sender', async () => {
    const source = await indexSource()
    const block = blockBetween(
      source,
      'const sendRefreshStaleToAllWindows',
      'function pushSnapshot'
    )
    const refresh = blockBetween(
      source,
      'function refreshAfterWrite',
      'async function authoritativeRequestPath'
    )

    expect(block).toContain('createAllWindowsSender(')
    expect(block).toContain('() => windowManager?.liveWindows() ?? []')
    expect(refresh).toContain('sendRefreshStaleToAllWindows(')
    expect(refresh).not.toContain('mainWindow?.webContents.send')
  })

  test('routes settings write failures through an all-windows sender', async () => {
    const source = await indexSource()
    const block = blockBetween(
      source,
      'const sendSettingsWriteFailedToAllWindows',
      'function pushSnapshot'
    )

    expect(block).toContain('createAllWindowsSender(')
    expect(block).toContain('() => windowManager?.liveWindows() ?? []')
    expect(block).toContain('win.webContents.send(IPC.settingsWriteFailed, failure)')
    expect(source).toContain('sendSettingsWriteFailedToAllWindows')
  })

  test('logs unhandled rejections', async () => {
    const source = await indexSource()
    expect(source).toContain("process.on('unhandledRejection'")
  })

  test('declares the dtc scheme as top-level macOS bundle metadata', async () => {
    const extendInfo = (await builderConfig()).mac?.extendInfo

    expect(Array.isArray(extendInfo)).toBe(false)
    expect(extendInfo).toMatchObject({
      NSDocumentsFolderUsageDescription: expect.any(String),
      CFBundleURLTypes: [
        {
          CFBundleURLName: 'Dev Traffic Control record link',
          CFBundleTypeRole: 'Viewer',
          CFBundleURLSchemes: ['dtc']
        }
      ]
    })
  })

  test('routes the actual watcher and IPC call sites through createInboxStateHandlers', async () => {
    const source = await indexSource()

    expect(source).toContain('createInboxStateHandlers(inboxStore')
    expect(source).toContain('inboxStateHandlers.pushState(win.webContents)')
    expect(source).toContain('const opened = await inboxStateHandlers.openRun(')
    // Opening a request arms a waiting agent.
    expect(source).toContain('void writeArming(')
    expect(source).toContain('ticksKeyFor(store.get().qaRepoPath, authoritativePath)')
    expect(source).toContain('return inboxStateHandlers.markSeen(event.sender, basename)')
    expect(source).toContain('return inboxStateHandlers.archive(event.sender, basename)')
    expect(source).toContain('return inboxStateHandlers.unarchive(event.sender, basename)')
    expect(source).not.toContain('event.sender.send(IPC.inboxStateChanged')
    expect(source).not.toContain('inboxStore.markSeen(ticksKeyFor(requestPath))')
  })

  test('report mutations resolve after the write and refresh failures are non-fatal', async () => {
    const source = await indexSource()
    const save = blockBetween(source, 'IPC.saveReport,', 'IPC.finishRun,')
    const finish = blockBetween(source, 'IPC.finishRun,', 'ipcMain.handle(IPC.reopenRun')
    const reopen = blockBetween(source, 'ipcMain.handle(IPC.reopenRun', 'IPC.addShot')

    for (const handler of [save, finish, reopen]) {
      expect(handler).not.toContain('await service.refresh()')
      expect(handler).toContain('refreshAfterWrite()')
    }
  })

  test('finish and reopen return the same structured invalid-report refusal as autosave', async () => {
    const source = await indexSource()
    const finish = blockBetween(source, 'IPC.finishRun,', 'ipcMain.handle(IPC.reopenRun')
    const reopen = blockBetween(source, 'ipcMain.handle(IPC.reopenRun', 'IPC.addShot')

    for (const handler of [finish, reopen]) {
      expect(handler).toContain('error instanceof ReportRecoveryError')
      expect(handler).toContain("kind: 'invalid-on-disk'")
      expect(handler).toContain('ok: false')
    }
  })

  test('record search and inspector reads are rooted in the configured record folder', async () => {
    const source = await indexSource()
    const block = blockBetween(source, '// Read-only record surfaces', '// Runner IO')

    expect(block).toContain('searchRecordBodies(store.get().qaRepoPath, query')
    expect(block).toContain('readRecordFiles(store.get().qaRepoPath, files)')
    expect(block).not.toContain('writeFile')
  })

  test('a normal record-folder change restarts the watcher only after the path commits', async () => {
    const source = await indexSource()
    // The record-folder change runs through the root-choice gate; its commit
    // then restart lives in the gate's setRoot dependency.
    expect(blockBetween(source, 'IPC.setSetting,', 'IPC.pickFolder')).toContain(
      'await rootChoice.setRoot(event, value)'
    )
    const setting = blockBetween(source, 'setRoot: async', 'IPC.setSetting,')
    const commit = setting.indexOf("await store.setTransactional('qaRepoPath'")
    const restart = setting.indexOf('await restartService(updated.qaRepoPath)')

    expect(commit).toBeGreaterThan(-1)
    expect(restart).toBeGreaterThan(commit)
    expect(setting).not.toContain('void restartService(updated.qaRepoPath)')
  })

  // The pin is whether it stays on top, the dock is where it goes.
  test('docking never touches the pin, and the pin never moves or resizes the window', async () => {
    const source = await indexSource()
    const pin = blockBetween(
      source,
      'ipcMain.handle(IPC.setPinned',
      'ipcMain.handle(IPC.resetWindowPosition'
    )
    const applyPin = blockBetween(source, 'function applyPinned(', 'function isWindowPinned(')
    const mode = blockBetween(
      source,
      'ipcMain.handle(IPC.setWindowMode',
      'ipcMain.handle(IPC.dock,'
    )
    const dock = blockBetween(source, 'function dockWindow(', 'function dockMenuFor(')
    const dockIpc = blockBetween(source, 'ipcMain.handle(IPC.dock,', '// Read-only record surfaces')

    expect(mode).toContain('const docked = settingsForDock(current)')
    expect(mode).toContain('?.undock(win.getBounds(), current.widthPreset)')
    expect(mode).not.toContain('setAlwaysOnTop')
    expect(mode).not.toContain("store.set('pinned'")
    expect(dock).toContain('dockBounds(target, displays, currentId, NARROW_WIDTH)')
    expect(dock).toContain('viewStateStore.setDockPlace(')
    expect(dock).toContain('setBoundsByMain(win, bounds)')
    for (const block of [dock, dockIpc]) {
      expect(block).not.toContain('setAlwaysOnTop')
      expect(block).not.toContain('applyPinned')
      expect(block).not.toContain('pinned:')
    }

    for (const block of [pin, applyPin]) {
      expect(block).not.toContain('setWidthPreset')
      expect(block).not.toContain('setWindowMode')
      expect(block).not.toContain('setBounds')
    }
  })

  test('every bounds change main makes for docking is marked, so it never counts as an enlargement', async () => {
    const source = await indexSource()
    const byMain = blockBetween(source, 'function setBoundsByMain(', 'function lastDockEdge(')
    const snap = blockBetween(source, 'function snapDocked(', 'function dockDisplays(')
    const mode = blockBetween(
      source,
      'ipcMain.handle(IPC.setWindowMode',
      'ipcMain.handle(IPC.dock,'
    )

    expect(byMain.indexOf('expectProgrammaticResize(bounds.width)')).toBeGreaterThan(-1)
    expect(byMain.indexOf('expectProgrammaticResize')).toBeLessThan(byMain.indexOf('win.setBounds'))
    expect(snap).toContain('setBoundsByMain(win, bounds)')
    expect(snap).not.toContain('win.setBounds(')
    // Docking and undocking (Settings "Free" restoring the wider pre-dock
    // bounds) both go through the marked path; no raw setBounds is left there.
    expect(mode.match(/if \(bounds\) setBoundsByMain\(win, bounds\)/g)).toHaveLength(2)
    expect(mode).toContain('?.undock(win.getBounds(), current.widthPreset)')
    expect(mode).not.toContain('win.setBounds(')
    expect(source).toContain('enlargementWatches.set(')
    expect(source).not.toContain('dockRight(')
  })

  // Every enlargement unpins through the pin button's own path, and
  // every window a link asked for is brought forward.
  test('enlargement unpins through the same path as the pin button', async () => {
    const source = await indexSource()
    const pin = blockBetween(
      source,
      'ipcMain.handle(IPC.setPinned',
      'ipcMain.handle(IPC.resetWindowPosition'
    )
    const create = blockBetween(
      source,
      'function createWindow(',
      'function reconcileWindowsWithDisplays'
    )
    const apply = blockBetween(source, 'function applyPinned(', 'function isWindowPinned(')

    expect(pin).toContain('applyPinned(win, value)')
    expect(create).toContain('watchEnlargementUnpins(win, {')
    expect(create).toContain('sidebarWidth: NARROW_WIDTH')
    expect(create).toContain('unpin: () => applyPinned(win, false)')
    expect(apply).toContain("win.setAlwaysOnTop(requested, 'floating')")
    expect(apply).toContain(
      'windowManager.setLayout(win, { ...current, pinned: requested && !temporary })'
    )
    expect(apply).toContain(
      'win.webContents.send(IPC.windowSettingsChanged, settingsForWindow(win))'
    )
  })

  // No big window stays on top, whichever route made it big.
  test('the pin invariant is enforced on every route to a wide window', async () => {
    const source = await indexSource()
    const create = blockBetween(
      source,
      'function createWindow(',
      'function reconcileWindowsWithDisplays'
    )
    const apply = blockBetween(source, 'function applyPinned(', 'function isWindowPinned(')
    const preset = blockBetween(
      source,
      'ipcMain.handle(IPC.setWidthPreset',
      'ipcMain.handle(IPC.setWindowMode'
    )

    // A saved or inherited pin never starts a wide window on top.
    expect(create).toContain(
      'const startPinned = wantsPin && mayBePinned(geometry.bounds.width, NARROW_WIDTH)'
    )
    // Un-docking, restored bounds and a stuck lift are caught by the guard.
    expect(create).toContain('guardPinInvariant(win, {')
    // Narrowing pins through the pin button's own path.
    expect(create).toContain('pin: () => applyPinned(win, true)')
    expect(create).toContain('lift,')
    expect(create).toMatch(/applyInitialLayout\(win\)\s+pinGuard\.settle\(\)/)
    // Pressing the pin on a wide window pins it temporarily: on top and shown
    // pinned, but the saved layout records unpinned.
    expect(apply).toContain('requested && !mayBePinned(win.getBounds().width, NARROW_WIDTH)')
    expect(apply).toContain('pin.active = temporary')
    expect(apply).toContain('win.setAlwaysOnTop(requested, ')
    expect(apply).toContain('pinned: requested && !temporary')
    expect(source).toContain('pinned: true } : settings')
    expect(create).toContain('temporary,')
    // The link lift ends on the reviewer's first touch as well as on blur.
    expect(create).toContain('watchInteraction: (listener) => watchFirstTouch(win, listener)')
    expect(source).toContain("win.on('will-move', listener)")
    expect(source).toContain("contents.on('input-event', onInput)")
    // Narrow still pins: resize first, so no resize event sees the pin on a wide window.
    expect(preset.indexOf('applyWidth(win, preset)')).toBeLessThan(
      preset.indexOf("win.setAlwaysOnTop(pinned, 'floating')")
    )
  })

  test('every record read and write the renderer can ask for names the records folder', async () => {
    const source = await indexSource()
    const ipc = blockBetween(source, 'function registerIpc(): void {', '// Single instance:')

    // The confined file calls check the whole way down only when they are
    // given the records folder, so each of these calls must pass it.
    for (const call of [
      'save(authoritativePath, report, store.get().qaRepoPath)',
      'finish(authoritativePath, report, nowIso, store.get().qaRepoPath)',
      'reopen(authoritativePath, store.get().qaRepoPath)',
      'recoverCorruptReport(authoritativePath, report, nowIso, root)',
      'setAsideCorruptReport(authoritativePath, nowIso, root)',
      'openRun(authoritativePath, nowIso, root)',
      'readShotDataUrl(authoritativePath, relPath, store.get().qaRepoPath)',
      'linkNoteToReport(authoritativePath, noteBasename, store.get().qaRepoPath)',
      'storeShot(\n        store.get().qaRepoPath,'
    ]) {
      expect(ipc).toContain(call)
    }
    expect(ipc).toMatch(
      /writeReleaseAnswer\([\s\S]*?input\.screenshots : undefined,\s*store\.get\(\)\.qaRepoPath\s*\)/
    )
    expect(ipc).toMatch(/void writeArming\([\s\S]*?nowIso\(\)\),\s*store\.get\(\)\.qaRepoPath\s*\)/)
    expect(source).toContain('openRun(requestPath, nowIso, store.get().qaRepoPath)')
    // The deep-link header is read through the confined reader, never by path.
    expect(source).toContain('readConfined(root, await recordRelative(root, arrival.path), {')
    expect(source).not.toContain('openSync(')
  })

  test('every window a link opens or lands in is brought forward', async () => {
    const source = await indexSource()
    const open = blockBetween(source, 'function openWindowForDeepLink', 'function fallbackModeFor')
    const create = blockBetween(
      source,
      'function createWindow(',
      'function reconcileWindowsWithDisplays'
    )
    const creates = open.match(/createWindow\([^)]*\)/g) ?? []

    expect(creates.length).toBe(3)
    for (const call of creates) expect(call).toMatch(/, true\)$/)
    expect(create).toContain('bringWindowForward(win, {')
    expect(create).toContain('app.focus({ steal: true })')
    expect(source).toContain('createWindow(slot, false, slot.slot === coldLinkSlot)')
  })

  test('the bounded quit path flushes every app-local store', async () => {
    const source = await indexSource()
    const quit = blockBetween(source, 'createWillQuitHandler(app', 'app.whenReady()')

    expect(quit).toContain('store.flush()')
    expect(quit).toContain('ticksStore.flush()')
    expect(quit).toContain('viewStateStore.flush()')
    expect(quit).toContain('inboxStore.flush()')
  })

  test('restores every persisted window slot and starts the shared watcher once', async () => {
    const source = await indexSource()
    const create = blockBetween(source, 'function createWindow', 'function registerIpc')
    const ready = source.slice(source.indexOf('app.whenReady()'))

    expect(ready).toContain('windowManager.startupSlots(')
    expect(ready).toContain('for (const slot of startupSlots) createWindow(slot, ')
    expect(ready.match(/service\s*\.start\(pushSnapshot\)/g)).toHaveLength(1)
    expect(create).not.toMatch(/service\s*\.start\(pushSnapshot\)/)
  })

  test('derives construction minimums from the target display on every creation path', async () => {
    const source = await indexSource()
    const create = blockBetween(source, 'function createWindow', 'function registerIpc')

    expect(create).toContain('screen.getPrimaryDisplay().workArea')
    expect(create).toContain('screen.getDisplayNearestPoint')
    expect(create).toContain('windowGeometryForCreation(slot.bounds, targetWorkArea)')
    expect(create).not.toContain('minimumWindowSize(restoredBounds)')
    expect(create).toContain('const wantsPin = preventPinnedOverlap')
  })

  test('persists the final post-sanitise cascade bounds before constructing a new window', async () => {
    const source = await indexSource()
    const createNew = blockBetween(source, 'ipcMain.handle(IPC.newWindow', '// First-run bootstrap')
    const sanitise = createNew.indexOf('finaliseNewWindowState(')
    const createSlot = createNew.indexOf('windowManager.createSlot(')

    expect(sanitise).toBeGreaterThan(-1)
    expect(createSlot).toBeGreaterThan(sanitise)
    expect(createNew).toContain('windowManager.newWindowState(')
    expect(createNew).toContain('next.bounds')
    expect(createNew).toContain('next.preventPinnedOverlap === true')
    expect(createNew).toContain('targetWorkArea')
  })

  test('Dock activation and a payload-free relaunch share one route-back handler', async () => {
    const source = await indexSource()
    const ready = source.slice(source.indexOf('app.whenReady()'))
    const routeBack = blockBetween(
      source,
      'const ensureWindowAndRaise = createEnsureWindowAndRaiseHandler(',
      '// A second launch that carries a link'
    )
    const secondInstance = blockBetween(source, "app.on('second-instance'", "app.on('before-quit'")

    expect(routeBack.match(/reopenSlot\(defaultWindowLayout\(\)\)/g)).toHaveLength(1)
    expect(secondInstance).toContain('const url = deepLinkFromArgv(argv)')
    expect(secondInstance).toContain('acceptDeepLink(url)')
    expect(secondInstance).toContain('return')
    expect(secondInstance).toContain('ensureWindowAndRaise()')
    expect(ready).toContain("app.on('activate', ensureWindowAndRaise)")
    expect(ready).not.toContain("app.on('activate', function ()")
  })

  test('reset position clears dock memory before applying centred free bounds', async () => {
    const source = await indexSource()
    const reset = blockBetween(source, 'ipcMain.handle(IPC.resetWindowPosition', '// Window feel')

    expect(reset).toContain(
      'resetWindowPosition(win, workArea, windowManager, defaultWindowLayout())'
    )
    expect(reset).toContain('const win = BrowserWindow.fromWebContents(event.sender)')
    expect(reset).not.toContain('BrowserWindow.getFocusedWindow()')
  })

  test('revises minimums on the cross-platform move signal', async () => {
    const source = await indexSource()
    const create = blockBetween(source, 'function createWindow', 'function registerIpc')
    expect(create).toContain("win.on('move', () =>")
    expect(create).not.toContain("win.on('moved', () =>")
    expect(create).toContain('reviseWindowMinimums(win, (bounds) =>')
    expect(create).toContain('screen.getDisplayNearestPoint(bounds).workArea')
  })

  test('all display topology changes share one window reconciliation', async () => {
    const source = await indexSource()
    const ready = source.slice(source.indexOf('app.whenReady()'))

    expect(source).toContain('function reconcileWindowsWithDisplays()')
    expect(ready).toContain("screen.on('display-metrics-changed', reconcileWindowsWithDisplays)")
    expect(ready).toContain("screen.on('display-removed', reconcileWindowsWithDisplays)")
    expect(ready).toContain("screen.on('display-added', reconcileWindowsWithDisplays)")
    expect(source.match(/for \(const win of windowManager\.liveWindows\(\)\)/g)).toHaveLength(1)
  })

  test('registers platform-aware last-window handling alongside restore-slot preservation', async () => {
    const source = await indexSource()

    expect(source).toContain("app.on('before-quit', () => windowManager.beginQuit())")
    expect(source).toContain(
      "app.on('window-all-closed', createWindowAllClosedHandler(process.platform, app))"
    )
  })

  test('window and view-state IPC resolve the invoking window slot', async () => {
    const source = await indexSource()
    const state = blockBetween(source, 'IPC.getViewState', 'IPC.firstRun')
    const folder = blockBetween(source, 'const rootChoice', '// First-run bootstrap')

    expect(state).toContain('BrowserWindow.fromWebContents(event.sender)')
    expect(state).toContain('windowManager.slotFor(win)')
    expect(folder).toContain('BrowserWindow.fromWebContents(event.sender)')
  })

  test('the collect prompt is confined and copied without launching anything', async () => {
    const source = await indexSource()
    const copy = blockBetween(source, 'IPC.copyCollectPrompt', '// Note IO')

    expect(copy).toContain('authoritativeRequestPath(requestPath)')
    expect(copy).toContain('clipboard.writeText(collectPrompt(')
    expect(copy).not.toMatch(/spawn|exec|shell\.open/)
  })
})
