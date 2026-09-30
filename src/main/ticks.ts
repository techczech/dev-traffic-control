import { readFileSync } from 'node:fs'
import { atomicWrite } from './qa/atomicWrite'
import type { ItemTicks, ReportTicks } from '../shared/ipc'
import {
  legacyRequestIdentity,
  legacyOwners,
  requestIdentityIsLive,
  unambiguousLegacyMigrations
} from '../shared/requestIdentity'

type TicksFile = Record<string, ReportTicks> // by repository-relative request path
const AMBIGUOUS_META = '__dtc_ambiguous_legacy__'

/**
 * The only home of tick state (ADR-0004 Amendment 5): personal progress marks
 * on Steps/Expected bullets, keyed by report basename, stored app-locally in
 * `userData/ticks.json`, keyed by repository-relative request path — never in report.json, so an agent can never mistake
 * a tick for a verdict. Same shape of store as {@link SettingsStore}: sync
 * load at construct, atomic flush on every change.
 */
export class TicksStore {
  private readonly filePath: string
  private ticks: TicksFile
  private ambiguousLegacy: Set<string>
  private liveRequestIdentities = new Set<string>()
  /** Resolves once the most recent change has hit disk. */
  pendingWrite: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
    const loaded = load(filePath)
    this.ticks = loaded.ticks
    this.ambiguousLegacy = loaded.ambiguousLegacy
  }

  /** Wait until every tick change accepted so far has finished writing. */
  flush(): Promise<void> {
    return this.pendingWrite
  }

  get(reportBasename: string): ReportTicks {
    const exact = this.ticks[reportBasename]
    if (exact) return structuredClone(exact)
    const legacy = legacyRequestIdentity(reportBasename)
    const owners = legacyOwners([...this.liveRequestIdentities]).get(legacy) ?? []
    return structuredClone(
      owners.length === 1 && owners[0] === reportBasename ? (this.ticks[legacy] ?? {}) : {}
    )
  }

  /** Saved request basenames, used to judge whether a prune is proportionate. */
  keys(): string[] {
    return Object.keys(this.ticks)
  }

  setItem(reportBasename: string, itemId: string, item: ItemTicks): void {
    const forReport = {
      ...(this.ticks[reportBasename] ?? {})
    }
    if (item.steps.length === 0 && item.expected.length === 0) delete forReport[itemId]
    else forReport[itemId] = { steps: [...item.steps], expected: [...item.expected] }

    const next = { ...this.ticks }
    if (Object.keys(forReport).length === 0) delete next[reportBasename]
    else next[reportBasename] = forReport
    this.commit(next)
  }

  /** Reopening a run starts a fresh walk — its ticks go with the stamp. */
  clear(reportBasename: string): void {
    if (!(reportBasename in this.ticks)) return
    const next = { ...this.ticks }
    delete next[reportBasename]
    this.commit(next)
  }

  /** Drop entries whose request has vanished from the snapshot. */
  prune(keep: ReadonlySet<string>): void {
    const gone = Object.keys(this.ticks).filter(
      (key) => !requestIdentityIsLive(key, keep, this.ambiguousLegacy)
    )
    if (gone.length === 0) return
    const next = { ...this.ticks }
    for (const base of gone) delete next[base]
    this.commit(next)
  }

  protectedLegacyKeys(): ReadonlySet<string> {
    return this.ambiguousLegacy
  }

  /** Move legacy basename keys only when one scanned request owns the name. */
  migrateRequestKeys(requestIdentities: readonly string[]): void {
    this.liveRequestIdentities = new Set(requestIdentities)
    const owners = legacyOwners(requestIdentities)
    const next = { ...this.ticks }
    let changed = false
    for (const [legacy, identities] of owners) {
      if (identities.length > 1 && next[legacy] && !this.ambiguousLegacy.has(legacy)) {
        this.ambiguousLegacy.add(legacy)
        changed = true
      }
    }
    for (const [legacy, relative] of unambiguousLegacyMigrations(requestIdentities)) {
      if (this.ambiguousLegacy.has(legacy)) continue
      const legacyTicks = next[legacy]
      if (!legacyTicks) continue
      next[relative] = { ...legacyTicks, ...(next[relative] ?? {}) }
      delete next[legacy]
      changed = true
    }
    if (changed) this.commit(next)
  }

  private commit(next: TicksFile): void {
    this.ticks = next
    const disk = this.ambiguousLegacy.size
      ? { ...next, [AMBIGUOUS_META]: [...this.ambiguousLegacy] }
      : next
    const payload = JSON.stringify(disk, null, 2) + '\n'
    // Writes are serialised on the previous one: atomicWrite reuses one tmp
    // filename per pid, so two in-flight writes (two quick tick clicks) would
    // race on the rename and drop one on the floor.
    this.pendingWrite = this.pendingWrite
      .catch(() => {})
      .then(() => atomicWrite(this.filePath, payload))
  }
}

function load(filePath: string): { ticks: TicksFile; ambiguousLegacy: Set<string> } {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ticks: {}, ambiguousLegacy: new Set() }
    }
    const disk = parsed as Record<string, unknown>
    const ambiguous = Array.isArray(disk[AMBIGUOUS_META])
      ? disk[AMBIGUOUS_META].filter((value): value is string => typeof value === 'string')
      : []
    const ticks = Object.fromEntries(
      Object.entries(disk).filter(([key]) => key !== AMBIGUOUS_META)
    ) as TicksFile
    return { ticks, ambiguousLegacy: new Set(ambiguous) }
  } catch {
    return { ticks: {}, ambiguousLegacy: new Set() }
  }
}
