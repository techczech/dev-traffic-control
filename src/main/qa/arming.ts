import type { QaReport } from './types'
import { atomicWrite } from './atomicWrite'

/**
 * Ticket 16. Opening a request tells the record so: `<basename>.opened.json`
 * beside it. An agent that handed the reviewer the link waits on this file,
 * without spending tokens, and starts its heartbeat watch only once he has
 * arrived (dev-traffic-control skill, report-lifecycle § Active watches: two phases).
 */
export interface Arming {
  path: string
  body: { machine: string; openedAt: string }
}

export function openedPathFor(requestPath: string): string {
  return requestPath.replace(/\.md$/, '.opened.json')
}

/**
 * Whether opening this request is an arming, and what the file says. A
 * finished record is never armed: the signal means "he has started", and a
 * finished one has nothing left to wait for. A re-visit re-arms with a fresh
 * `openedAt`, so an agent can tell a new visit from a stale one.
 */
export function armingFor(
  requestPath: string,
  report: Pick<QaReport, 'completedAt'> | null,
  machine: string,
  now: string
): Arming | null {
  if (!requestPath.endsWith('.md')) return null
  if (report?.completedAt) return null
  return { path: openedPathFor(requestPath), body: { machine, openedAt: now } }
}

/**
 * Write the arming. It never blocks the surface and a failure is swallowed:
 * being unable to tell an agent he has arrived is not a reason to stop him.
 */
export async function writeArming(arming: Arming | null): Promise<void> {
  if (!arming) return
  try {
    await atomicWrite(arming.path, JSON.stringify(arming.body, null, 2) + '\n')
  } catch {
    // Deliberately silent: see above.
  }
}
