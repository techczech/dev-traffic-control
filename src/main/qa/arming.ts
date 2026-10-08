import type { QaReport } from './types'
import { recordTarget, writeConfinedAtomic } from '../confinedFs'

/**
 * Opening a request tells the record so: `<basename>.opened.json`
 * beside it. An agent that handed the reviewer the link waits on this file,
 * without spending tokens, and starts its heartbeat watch only once the reviewer has
 * arrived.
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
 * finished record is never armed: the signal means "the reviewer has started", and a
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
 * being unable to tell an agent that the reviewer has arrived is not a reason to stop them.
 */
export async function writeArming(arming: Arming | null, recordRoot?: string): Promise<void> {
  if (!arming) return
  try {
    // Confined to the records folder (confinedFs); a refusal is as silent as
    // any other failure here.
    const target = await recordTarget(arming.path, recordRoot)
    await writeConfinedAtomic(target.root, target.rel, JSON.stringify(arming.body, null, 2) + '\n')
  } catch {
    // Deliberately silent: see above.
  }
}
