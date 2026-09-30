import type { QaSnapshot } from '../shared/ipc'
import { requestIdentity, requestIdentityIsLive } from '../shared/requestIdentity'
import type { InboxStateStore } from './inboxState'
import type { TicksStore } from './ticks'

const NON_TRIVIAL_STORE_SIZE = 10
const MAX_REMOVAL_FRACTION = 0.5

/** The app-local state key for a request path: its record-root-relative path. */
export const ticksKeyFor = (recordRoot: string, requestPath: string): string =>
  requestIdentity(recordRoot, requestPath)

export function pruneUserDataForSnapshot(
  snapshot: QaSnapshot,
  ticksStore: TicksStore,
  inboxStore: InboxStateStore,
  logger: (message: string) => void = (message) => console.warn(message)
): void {
  // Zero runs is not evidence that saved state is stale: a wrong,
  // misconfigured, or half-synchronised record root produces the same scan.
  if (snapshot.rootMissing || snapshot.runs.length === 0) return
  const live = new Set(snapshot.runs.map((run) => ticksKeyFor(snapshot.root, run.request.path)))
  ticksStore.migrateRequestKeys([...live])
  inboxStore.migrateRequestKeys([...live])
  const inboxState = inboxStore.get()
  const saved = new Set([...ticksStore.keys(), ...inboxState.seen, ...inboxState.archived])
  const protectedLegacy = new Set([
    ...ticksStore.protectedLegacyKeys(),
    ...inboxStore.protectedLegacyKeys()
  ])
  const withheld = [...saved].filter((key) => !requestIdentityIsLive(key, live, protectedLegacy))

  // Ten saved requests are enough history to protect; losing more than half
  // in one scan is more likely to be a partial root than ordinary pruning.
  if (saved.size >= NON_TRIVIAL_STORE_SIZE && withheld.length / saved.size > MAX_REMOVAL_FRACTION) {
    logger(
      `Snapshot prune backstop withheld removal of ${withheld.length} of ${saved.size} saved request identities: ${withheld.join(', ')}`
    )
    return
  }

  ticksStore.prune(live)
  inboxStore.prune(live)
}
