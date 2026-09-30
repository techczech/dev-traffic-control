import chokidar from 'chokidar'
import { readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface QaRepoWatcher {
  ready: Promise<void>
  stop: () => Promise<void>
}

export async function writeProbeToleratingEnoent(
  probePath: string,
  contents: string,
  writer: typeof writeFile = writeFile
): Promise<boolean> {
  try {
    await writer(probePath, contents)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function watchQaRepo(root: string, onChange: () => void): QaRepoWatcher {
  return watchRoot(
    root,
    (candidate) =>
      /\.(?:md|report\.json|answers\.json|state\.json|watch\.json|collected\.json)$/.test(
        candidate
      ),
    onChange
  )
}

function watchRoot(
  root: string,
  accepts: (path: string) => boolean,
  onChange: () => void
): QaRepoWatcher {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let fallingBack = false
  let watcherReady = false
  let changeBeforeReady = false
  let readySettled = false
  let probeCancelled = false
  let probeLoop: Promise<void> | null = null
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const probePath = path.join(
    root,
    `.dtc-watch-ready-${process.pid}-${Math.random().toString(36).slice(2)}.state.json`
  )
  let resolveArmed!: () => void
  let armed = false
  const armedSignal = new Promise<void>((resolve) => {
    resolveArmed = resolve
  })

  const scheduleChange = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 250)
  }

  const settleReady = (): void => {
    if (readySettled) return
    readySettled = true
    resolveReady()
  }

  const reportDegradedWatcher = (message: string, error?: unknown): void => {
    if (error === undefined) console.error(message)
    else console.error(message, error)
  }

  const start = (usePolling: boolean): ReturnType<typeof chokidar.watch> => {
    watcherReady = false
    const next = chokidar.watch(root, {
      depth: 2,
      ignored: (p) =>
        p !== probePath && (/(^|[\\/])\./.test(p.slice(root.length)) || /\.tmp-[0-9a-f]+$/.test(p)),
      ignoreInitial: true,
      usePolling
    })
    next.on('all', (_event, p) => {
      if (p === probePath) {
        armed = true
        resolveArmed()
        return
      }
      if (!accepts(p)) return
      if (!watcherReady) {
        changeBeforeReady = true
        return
      }
      scheduleChange()
    })
    next.on('ready', () => {
      watcherReady = true
      if (usePolling) settleReady()
      else {
        probeCancelled = false
        probeLoop = proveArmed()
        void probeLoop
          .then(async () => {
            if (!armed || stopped) return
            await unlink(probePath).catch((error) => {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            })
            settleReady()
          })
          .catch((error) => fallBackToPolling(error))
          .catch((error) => {
            reportDegradedWatcher('Polling fallback could not start', error)
            settleReady()
          })
      }
      if (changeBeforeReady || usePolling) {
        changeBeforeReady = false
        scheduleChange()
      }
    })
    next.on('error', (error) => {
      if (stopped) return
      if (!usePolling) {
        void fallBackToPolling(error).catch((fallbackError) => {
          reportDegradedWatcher('Polling fallback could not start', fallbackError)
          settleReady()
        })
      } else {
        reportDegradedWatcher('Polling record watcher failed; live updates are unavailable', error)
        settleReady()
      }
    })
    return next
  }

  let watcher: ReturnType<typeof chokidar.watch> | null = null

  async function fallBackToPolling(error: unknown): Promise<void> {
    if (stopped || fallingBack) return
    fallingBack = true
    watcherReady = false
    probeCancelled = true
    resolveArmed()
    reportDegradedWatcher('Record watcher arming failed; falling back to polling', error)
    await probeLoop?.catch(() => undefined)
    const previous = watcher
    watcher = null
    await previous
      ?.close()
      .catch((closeError) =>
        reportDegradedWatcher('Could not close the degraded record watcher', closeError)
      )
    await unlink(probePath).catch((unlinkError) => {
      if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
        reportDegradedWatcher('Could not remove the watcher arming sentinel', unlinkError)
      }
    })
    if (stopped) {
      settleReady()
      return
    }
    changeBeforeReady = true
    try {
      watcher = start(true)
    } catch (pollingError) {
      reportDegradedWatcher('Polling record watcher could not start', pollingError)
      settleReady()
    }
  }

  async function sweepStaleSentinels(): Promise<boolean> {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch (error) {
      reportDegradedWatcher('Could not inspect the record root for stale watcher sentinels', error)
      return false
    }
    let clean = true
    await Promise.all(
      entries
        .filter((entry) => /^\.dtc-watch-ready-.*\.state\.json$/.test(entry))
        .map(async (entry) => {
          try {
            await unlink(path.join(root, entry))
          } catch (error) {
            clean = false
            reportDegradedWatcher(`Could not remove stale watcher sentinel ${entry}`, error)
          }
        })
    )
    return clean
  }

  const initialising = sweepStaleSentinels()
    .then((clean) => {
      if (stopped) {
        settleReady()
        return
      }
      try {
        watcher = start(!clean)
      } catch (error) {
        reportDegradedWatcher('Record watcher could not start; live updates are unavailable', error)
        settleReady()
      }
    })
    .catch((error) => {
      reportDegradedWatcher(
        'Record watcher initialisation failed; live updates are unavailable',
        error
      )
      settleReady()
    })

  async function proveArmed(): Promise<void> {
    for (let attempt = 0; attempt < 20 && !stopped && !armed && !probeCancelled; attempt += 1) {
      await writeProbeToleratingEnoent(probePath, `${attempt}\n`)
      await Promise.race([armedSignal, new Promise<void>((resolve) => setTimeout(resolve, 50))])
    }
    if (!armed && !stopped && !readySettled) {
      throw new Error(`Record watcher did not report its armed probe: ${probePath}`)
    }
  }

  return {
    ready,
    stop: async () => {
      stopped = true
      probeCancelled = true
      resolveArmed()
      if (timer) clearTimeout(timer)
      await initialising
      await probeLoop?.catch(() => undefined)
      await watcher?.close()
      await unlink(probePath).catch(() => {})
      settleReady()
    }
  }
}
