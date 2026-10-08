/**
 * Recording a filed request: this session's own note of it (`$.state`), the turn's written paths
 * and the shared registry (`$.store`). Each is read–modify–written under this load's lock, so
 * parallel Write hooks never lose a filing. I/O is injected.
 */

import { recordFiling, recordLocalFiling } from './inbox'
import type { LocalFilings, Registry, RegistryEntry } from './inbox'
import type { WithLock } from './lock'

export type FilingIo = {
  readLocal: () => Promise<LocalFilings>
  writeLocal: (v: LocalFilings) => Promise<void>
  /** The shared registry. Must reject when it cannot be read: an unread registry is never written back as an empty one. */
  readRegistry: () => Promise<Registry>
  writeRegistry: (v: Registry) => Promise<void>
  readWrites: () => Promise<string[]>
  writeWrites: (v: string[]) => Promise<void>
}

/**
 * Records one filing. The session-local note and the turn's written paths go first; then the
 * registry entry is replaced. When the registry cannot be read or written this rejects, with the
 * local note and the turn's paths kept: the record then shows no asking session in the pane.
 */
export async function recordRequestFiling(io: FilingIo, withLock: WithLock, entry: RegistryEntry): Promise<void> {
  await withLock(async () => io.writeLocal(recordLocalFiling(await io.readLocal(), entry.path, { project: entry.project, filedAt: entry.filedAt, lastAt: entry.filedAt })))
  await withLock(async () => {
    const held = await io.readWrites()
    await io.writeWrites([...held.filter(p => p !== entry.path), entry.path])
  })
  await withLock(async () => io.writeRegistry(recordFiling(await io.readRegistry(), entry)))
}
