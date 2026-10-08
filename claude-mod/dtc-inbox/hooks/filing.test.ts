import { describe, expect, test } from 'claude-code/testing'

import { recordRequestFiling } from './filing'
import type { FilingIo } from './filing'
import type { LocalFilings, Registry } from './inbox'
import { createLock } from './lock'

/** Lets the other hook run between a read and its write, as two awaited host calls would. */
const yieldTurns = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** One session's filing I/O: its own local record and turn writes, and the registry in the store every session shares. */
function memoryIo(shared: { registry: Registry } = { registry: {} }) {
  const held = { local: {} as LocalFilings, writes: [] as string[], shared }
  const io: FilingIo = {
    readLocal: async () => (await yieldTurns(), held.local),
    writeLocal: async v => void (await yieldTurns(), (held.local = v)),
    readRegistry: async () => (await yieldTurns(), shared.registry),
    writeRegistry: async v => void (await yieldTurns(), (shared.registry = v)),
    readWrites: async () => (await yieldTurns(), held.writes),
    writeWrites: async v => void (await yieldTurns(), (held.writes = v)),
  }
  return { held, io }
}

const A = '/r/records/appx/2026-01-01-a.md'
const B = '/r/records/appx/2026-01-02-b.md'
const entry = (path: string, sessionId = 's1') => ({ path, sessionId, project: 'appx', filedAt: 5 })

describe('filings recorded under the lock', () => {
  test('two parallel Write hooks: both filings recorded locally, in the registry and in the turn writes', async () => {
    const { held, io } = memoryIo()
    const withLock = createLock()
    await Promise.all([recordRequestFiling(io, withLock, entry(A)), recordRequestFiling(io, withLock, entry(B))])
    expect(Object.keys(held.local).sort()).toEqual([A, B])
    expect(Object.keys(held.shared.registry).sort()).toEqual([A, B])
    expect([...held.writes].sort()).toEqual([A, B])
  })

  test('a failing step rejects its own caller and does not stall the lock', async () => {
    const { held, io } = memoryIo()
    const withLock = createLock()
    const failing: FilingIo = { ...io, writeLocal: async () => Promise.reject(new Error('state write failed')) }
    await expect(recordRequestFiling(failing, withLock, entry(A))).rejects.toThrow('state write failed')
    await recordRequestFiling(io, withLock, entry(B))
    expect(Object.keys(held.local)).toEqual([B])
  })

  test('the same record filed again by another session: the registry names the latest, each keeps its own note', async () => {
    const shared = { registry: {} as Registry }
    const a = memoryIo(shared)
    const b = memoryIo(shared)
    await recordRequestFiling(a.io, createLock(), entry(A, 'A'))
    await recordRequestFiling(b.io, createLock(), { ...entry(A, 'B'), filedAt: 9 })
    expect(shared.registry[A]).toEqual({ ...entry(A, 'B'), filedAt: 9 })
    expect(a.held.local[A]).toEqual({ project: 'appx', filedAt: 5, lastAt: 5 })
    expect(b.held.local[A]).toEqual({ project: 'appx', filedAt: 9, lastAt: 9 })
  })

  test('a registry that cannot be read is never written back as an empty one; the local note is kept', async () => {
    const shared = { registry: { [B]: entry(B, 'other') } as Registry }
    const { held, io } = memoryIo(shared)
    let writes = 0
    const unreadable: FilingIo = { ...io, readRegistry: async () => Promise.reject(new Error('the store failed')), writeRegistry: async () => void writes++ }
    await expect(recordRequestFiling(unreadable, createLock(), entry(A))).rejects.toThrow('the store failed')
    expect(writes).toBe(0)
    expect(shared.registry).toEqual({ [B]: entry(B, 'other') })
    expect(Object.keys(held.local)).toEqual([A])
    expect(held.writes).toEqual([A])
  })
})
