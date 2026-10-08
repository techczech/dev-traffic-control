import { confineHandoffPath } from './confinement'
import { requestIdentity } from '../shared/requestIdentity'
import type { ArchiveOldInput, QaSnapshot } from '../shared/ipc'

/**
 * Archive old. The renderer proposes what to archive; main keeps
 * only what the current snapshot actually holds. A request key must be the
 * identity of a scanned request, a thread id a scanned thread, a handoff path
 * a scanned handoff. Anything else is dropped, never written: the handoff
 * archive writes a sidecar into the record, so a path must never come from
 * the renderer unchecked.
 */
export function confineArchiveOld(
  input: ArchiveOldInput,
  snapshot: Pick<QaSnapshot, 'root' | 'runs' | 'threads' | 'handoffs'> | null
): ArchiveOldInput {
  if (!snapshot) return { requests: [], threads: [], handoffs: [] }
  const requests = new Set(
    snapshot.runs.map((run) => requestIdentity(snapshot.root, run.request.path))
  )
  const threads = new Set(snapshot.threads.map((thread) => thread.id))
  const keep = (values: unknown, allowed: ReadonlySet<string>): string[] =>
    Array.isArray(values)
      ? [...new Set(values.filter((v): v is string => typeof v === 'string' && allowed.has(v)))]
      : []
  return {
    requests: keep(input?.requests, requests),
    threads: keep(input?.threads, threads),
    handoffs: Array.isArray(input?.handoffs)
      ? [
          ...new Set(
            input.handoffs
              .map((handoffPath) => confineHandoffPath(handoffPath, snapshot))
              .filter((handoffPath): handoffPath is string => handoffPath !== null)
          )
        ]
      : []
  }
}
