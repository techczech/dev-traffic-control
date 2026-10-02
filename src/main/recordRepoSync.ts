import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * The record folder's sync state, for the one link state that is a sync
 * question rather than a safety one (mockup state 21).
 *
 * Nothing here runs because a link arrived. The pull happens only when the reviewer
 * presses the button the sync-lag state offers — a link itself never writes,
 * never fetches and never starts a process (ADR-0016 § 5).
 */

/**
 * When the record folder last heard from its remote, read from git's own
 * `FETCH_HEAD` stamp. Absent when the folder is not a git repository or has
 * never fetched — the state then says the record has not arrived without
 * claiming a staleness it cannot measure.
 */
export async function recordRepoLastPulledAt(root: string): Promise<string | undefined> {
  try {
    const stats = await stat(path.join(root, '.git', 'FETCH_HEAD'))
    return new Date(stats.mtimeMs).toISOString()
  } catch {
    return undefined
  }
}

export interface RecordRepoPullResult {
  ok: boolean
  /** Said in human words; shown to the reviewer when the pull could not happen. */
  message: string
}

export type RunGit = (args: readonly string[]) => Promise<{ ok: boolean; message: string }>

const runGit: RunGit = (args) =>
  new Promise((resolve) => {
    execFile('git', [...args], { timeout: 90_000 }, (error, _stdout, stderr) => {
      if (!error) return resolve({ ok: true, message: '' })
      resolve({ ok: false, message: (stderr || error.message).trim().split('\n')[0] ?? '' })
    })
  })

/**
 * Fast-forward the record folder.
 *
 * `--ff-only` on purpose: this may run while the reviewer has local record work in
 * flight, and a pull that merged, rebased or rewrote anything would be the app
 * touching records it does not own. A diverged folder is left exactly as it is
 * and says so.
 */
export async function pullRecordRepo(
  root: string,
  run: RunGit = runGit
): Promise<RecordRepoPullResult> {
  try {
    await stat(path.join(root, '.git'))
  } catch {
    return {
      ok: false,
      message: 'Your record folder is not a git repository, so there is nothing to pull.'
    }
  }
  const result = await run(['-C', root, 'pull', '--ff-only'])
  return result.ok
    ? { ok: true, message: '' }
    : { ok: false, message: `The record folder could not be pulled: ${result.message}` }
}
