/** What a key in the /dtc pane does once the hooks module gets it. Effects are injected; nothing here touches `$`. */

import { plain, safeRef } from './guard'
import { dtcUrl } from './paths'
import { entryTitle, rowId } from './pane'
import type { PaneAction } from './pane'
import type { ScanEntry } from './scan'
import { collectPrompt } from './text'

export type ActionDeps = {
  /** A fresh scan's entries; the action's id is looked up here, never trusted. */
  entries: readonly ScanEntry[]
  /** Runs a process, without a shell: only ever `OPEN` with one `dtc://open/...` argument whose parts pass `safeRef`. */
  run: (argv: string[]) => Promise<{ exitCode: number; stderr?: string }>
  /** Fills the prompt box; false when it could not. */
  fill: (text: string) => Promise<boolean>
  toast: (text: string) => void
  close: () => Promise<void>
}

/** macOS's own `open`, by its full path: a program named `open` earlier on PATH is never run. */
export const OPEN = '/usr/bin/open'

export function parseAction(data: unknown): PaneAction | null {
  if (data === null || typeof data !== 'object') return null
  const { kind, id } = data as { kind?: unknown; id?: unknown }
  if (kind === 'close') return { kind: 'close' }
  if ((kind !== 'open' && kind !== 'collect') || typeof id !== 'string') return null
  return { kind, id }
}

/** Never throws: every failure becomes a toast. */
export async function handleAction(action: PaneAction, raw: ActionDeps): Promise<void> {
  const deps: ActionDeps = { ...raw, toast: text => raw.toast(plain(text)) }
  try {
    if (action.kind === 'close') return await deps.close()
    const entry = deps.entries.find(e => rowId(e) === action.id)
    if (entry === undefined) return deps.toast('That record is no longer listed; reopen /dtc.')
    const title = entryTitle(entry)
    const ref = safeRef({ project: entry.project, rel: entry.rel })
    if (ref === null) return deps.toast('This record\'s file name has characters DTC links do not allow; open it from the DTC app.')
    if (action.kind === 'open') {
      const res = await deps.run([OPEN, dtcUrl(ref)])
      const why = res.stderr ? ` (${String(res.stderr).trim().slice(0, 120)})` : ''
      return deps.toast(res.exitCode === 0 ? `Opened ${title} in Dev Traffic Control` : `Could not open ${title}: open exited ${res.exitCode}${why}`)
    }
    if (entry.state === 'collected') return deps.toast('Already collected')
    if (entry.state === 'malformed') return deps.toast('This answer could not be read (not a regular file, too large, or not in the expected shape), so it is not collected from here; open it in the DTC app.')
    if (entry.state !== 'waiting') return deps.toast('Nothing to collect yet — not finished')
    const prompt = collectPrompt(ref)
    if (prompt === null) return deps.toast('This record cannot be collected from here; open it from the DTC app.')
    if (await deps.fill(prompt)) await deps.close()
    else deps.toast('The prompt box could not take the collect prompt here; use /dtc collect instead.')
  } catch (err) {
    try {
      deps.toast(`DTC: ${err instanceof Error ? err.message : String(err)}`)
    } catch {
      // nothing left to report to
    }
  }
}
