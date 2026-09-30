import { stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { scanQaRepo } from './qa/scan'
import { scanHandoffs } from './qa/handoffs'
import { deriveThreads } from './qa/threads'
import { readProjectRelease } from './qa/releaseRecords'
import { readProjectPool } from './qa/pool'
import { watchQaRepo } from './qa/watch'
import type { QaSnapshot } from '../shared/ipc'

/**
 * Owns the live view of the record repo: starts the watcher to readiness,
 * performs the first authoritative scan, then re-scans on every watcher ping.
 * Composes the M1 contract library ({@link scanQaRepo} +
 * {@link watchQaRepo}); adds no fs logic of its own.
 */
export class QaService {
  private readonly root: string
  private current: QaSnapshot | null = null
  private stopWatch: (() => Promise<void>) | null = null
  private watchReady: Promise<void> | null = null
  private onSnapshot: ((snapshot: QaSnapshot) => void) | null = null
  private refreshPromise: Promise<void> | null = null
  private refreshRequested = false
  private stopped = false

  constructor(
    root: string,
    private readonly receiptsStartAt?: string
  ) {
    this.root = root
  }

  async start(onSnapshot: (s: QaSnapshot) => void): Promise<void> {
    if (this.stopped) return
    this.onSnapshot = onSnapshot
    try {
      await this.ensureWatcher()
    } catch (error) {
      console.error('Record watcher could not start; continuing with an authoritative scan', error)
    }
    await this.refresh()
  }

  /**
   * Publish one authoritative snapshot. Refresh requests made while a scan is
   * running are coalesced into one follow-up scan; the superseded result is
   * discarded rather than being allowed to publish stale state.
   */
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.refreshPromise) {
      this.refreshRequested = true
      return this.refreshPromise
    }

    this.refreshPromise = this.runRefreshLoop().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.onSnapshot = null
    const stopWatch = this.stopWatch
    this.stopWatch = null
    this.watchReady = null
    await stopWatch?.()
    await this.refreshPromise?.catch(() => {})
  }

  snapshot(): QaSnapshot | null {
    return this.current
  }

  badgeCount(s: QaSnapshot): number {
    return s.runs.filter((r) => r.status === 'waiting' && !r.resolvedAt && !r.reportError).length
  }

  private async runRefreshLoop(): Promise<void> {
    do {
      if (this.stopped) return
      this.refreshRequested = false
      const snapshot = await this.scan()
      if (!this.stopped && !this.refreshRequested) {
        this.current = snapshot
        this.onSnapshot?.(snapshot)
      }
    } while (!this.stopped && this.refreshRequested)
  }

  private async ensureWatcher(): Promise<void> {
    if (this.stopWatch) {
      await this.watchReady
      return
    }
    if (!(await isDirectory(this.root))) return
    // A concurrent start may have installed the watcher while stat was in flight.
    if (this.stopWatch) {
      await this.watchReady
      return
    }
    const watcher = watchQaRepo(this.root, () => {
      void this.refresh().catch((error) => console.error('Record refresh failed', error))
    })
    this.stopWatch = watcher.stop
    this.watchReady = watcher.ready
    await watcher.ready
  }

  private async scan(): Promise<QaSnapshot> {
    const scannedAt = new Date().toISOString()
    if (!(await isDirectory(this.root))) {
      return {
        root: this.root,
        localMachine: hostname(),
        rootMissing: true,
        runs: [],
        notes: [],
        entries: [],
        threads: [],
        handoffs: [],
        releases: [],
        pools: [],
        projects: [],
        scannedAt,
        receiptsStartAt: this.receiptsStartAt
      }
    }
    const [{ runs, notes, entries, projects }, handoffResult] = await Promise.all([
      scanQaRepo(this.root),
      scanHandoffs(this.root, new Date(scannedAt))
    ])
    const [releases, pools] = await Promise.all([
      Promise.all(projects.map((project) => readProjectRelease(this.root, project))),
      Promise.all(projects.map((project) => readProjectPool(this.root, project)))
    ])
    // Threads derive here, beside the run statuses — same "derived, never stored"
    // law; age uses scannedAt so it moves with the scan, not the render.
    const threads = deriveThreads(entries, scannedAt)
    return {
      root: this.root,
      localMachine: hostname(),
      rootMissing: false,
      runs,
      notes,
      entries,
      threads,
      handoffs: handoffResult.handoffs,
      releases,
      pools,
      projects,
      scannedAt,
      receiptsStartAt: this.receiptsStartAt
    }
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
