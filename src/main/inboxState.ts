import { readFileSync } from 'node:fs'
import { atomicWrite } from './qa/atomicWrite'
import type { InboxState } from '../shared/ipc'
import {
  legacyOwners,
  requestIdentityIsLive,
  unambiguousLegacyMigrations
} from '../shared/requestIdentity'

/**
 * App-local inbox state: which requests the reviewer has already
 * opened (so the Inbox can mark the rest NEW) and which the reviewer has archived (so
 * they leave the default view). Keyed by request basename, stored in
 * `userData/inbox-state.json` — NEVER in the record repo. The app may not edit or
 * delete agent-written request files, so "archive" is app-side
 * hiding, recoverable, not deletion. Keys are repository-relative request paths;
 * legacy basenames remain readable when two requests make migration ambiguous.
 * Same store shape as {@link TicksStore}:
 * sync load at construct, atomic flush per change.
 */
export class InboxStateStore {
  private readonly filePath: string
  private seen: Set<string>
  private archived: Set<string>
  private archivedThreads: Set<string>
  private ambiguousLegacy: Set<string>
  /** Resolves once the most recent change has hit disk. */
  pendingWrite: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
    const loaded = load(filePath)
    this.seen = new Set(loaded.seen)
    this.archived = new Set(loaded.archived)
    this.archivedThreads = new Set(loaded.archivedThreads ?? [])
    this.ambiguousLegacy = new Set(loaded.ambiguousLegacy)
  }

  /** Wait until every inbox-state change accepted so far has finished writing. */
  flush(): Promise<void> {
    return this.pendingWrite
  }

  get(): InboxState {
    return {
      seen: [...this.seen],
      archived: [...this.archived],
      ...(this.archivedThreads.size ? { archivedThreads: [...this.archivedThreads] } : {})
    }
  }

  /** Record that a request has been opened, so it stops reading as NEW. */
  markSeen(basename: string): void {
    if (this.seen.has(basename)) return
    this.seen = new Set(this.seen).add(basename)
    this.commit()
  }

  archive(basename: string): void {
    if (this.archived.has(basename)) return
    this.archived = new Set(this.archived).add(basename)
    this.commit()
  }

  /**
   * Archive old: many requests and decisions in one write, so a
   * bulk clear is one atomic change rather than dozens of racing ones.
   */
  archiveMany(requests: readonly string[], threads: readonly string[]): void {
    const nextRequests = new Set(this.archived)
    const nextThreads = new Set(this.archivedThreads)
    for (const key of requests) nextRequests.add(key)
    for (const id of threads) nextThreads.add(id)
    if (nextRequests.size === this.archived.size && nextThreads.size === this.archivedThreads.size)
      return
    this.archived = nextRequests
    this.archivedThreads = nextThreads
    this.commit()
  }

  unarchiveThread(id: string): void {
    if (!this.archivedThreads.has(id)) return
    const next = new Set(this.archivedThreads)
    next.delete(id)
    this.archivedThreads = next
    this.commit()
  }

  unarchive(basename: string): void {
    if (!this.archived.has(basename)) return
    const next = new Set(this.archived)
    next.delete(basename)
    this.archived = next
    this.commit()
  }

  /** Drop entries whose request has vanished from the snapshot. */
  prune(keep: ReadonlySet<string>): void {
    const seenGone = [...this.seen].filter(
      (key) => !requestIdentityIsLive(key, keep, this.ambiguousLegacy)
    )
    const archGone = [...this.archived].filter(
      (key) => !requestIdentityIsLive(key, keep, this.ambiguousLegacy)
    )
    if (seenGone.length === 0 && archGone.length === 0) return
    this.seen = new Set(
      [...this.seen].filter((key) => requestIdentityIsLive(key, keep, this.ambiguousLegacy))
    )
    this.archived = new Set(
      [...this.archived].filter((key) => requestIdentityIsLive(key, keep, this.ambiguousLegacy))
    )
    this.commit()
  }

  protectedLegacyKeys(): ReadonlySet<string> {
    return this.ambiguousLegacy
  }

  /** Move legacy basename keys only when one scanned request owns the name. */
  migrateRequestKeys(requestIdentities: readonly string[]): void {
    let changed = false
    const owners = legacyOwners(requestIdentities)
    for (const [legacy, identities] of owners) {
      if (
        identities.length > 1 &&
        (this.seen.has(legacy) || this.archived.has(legacy)) &&
        !this.ambiguousLegacy.has(legacy)
      ) {
        this.ambiguousLegacy.add(legacy)
        changed = true
      }
    }
    for (const [legacy, relative] of unambiguousLegacyMigrations(requestIdentities)) {
      if (this.ambiguousLegacy.has(legacy)) continue
      if (this.seen.delete(legacy)) {
        this.seen.add(relative)
        changed = true
      }
      if (this.archived.delete(legacy)) {
        this.archived.add(relative)
        changed = true
      }
    }
    if (changed) this.commit()
  }

  private commit(): void {
    const payload =
      JSON.stringify(
        {
          seen: [...this.seen],
          archived: [...this.archived],
          ...(this.archivedThreads.size ? { archivedThreads: [...this.archivedThreads] } : {}),
          ...(this.ambiguousLegacy.size ? { ambiguousLegacy: [...this.ambiguousLegacy] } : {})
        },
        null,
        2
      ) + '\n'
    // Serialised on the previous write — atomicWrite reuses one tmp name per
    // pid, so two quick actions (open + archive) must not race the rename.
    this.pendingWrite = this.pendingWrite
      .catch(() => {})
      .then(() => atomicWrite(this.filePath, payload))
  }
}

function load(
  filePath: string
): InboxState & { archivedThreads: string[]; ambiguousLegacy: string[] } {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null)
      return { seen: [], archived: [], archivedThreads: [], ambiguousLegacy: [] }
    const rec = parsed as Record<string, unknown>
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    return {
      seen: arr(rec.seen),
      archived: arr(rec.archived),
      archivedThreads: arr(rec.archivedThreads),
      ambiguousLegacy: arr(rec.ambiguousLegacy)
    }
  } catch {
    return { seen: [], archived: [], archivedThreads: [], ambiguousLegacy: [] }
  }
}
