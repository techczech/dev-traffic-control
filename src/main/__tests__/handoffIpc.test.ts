import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { createHandoffHandlers } from '../handoffIpc'
import { handoffSidecarPathFor, readHandoffSidecar } from '../qa/handoffs'
import type { QaSnapshot } from '../../shared/ipc'

const NOW = '2026-09-27T10:00:00.000Z'

let dir: string
let scanned: string
let outside: string
let refreshAfterWrite: Mock<() => void>
let writeClipboard: Mock<(text: string) => void>

function handlers(
  snapshot: Pick<QaSnapshot, 'handoffs'> | null
): ReturnType<typeof createHandoffHandlers> {
  return createHandoffHandlers({
    snapshot: () => snapshot,
    refreshAfterWrite,
    writeClipboard,
    now: () => NOW
  })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dtc-handoff-ipc-'))
  // A handoff sits at <records folder>/<project>/handoffs/<file>.
  scanned = path.join(dir, 'record', 'demo', 'handoffs', '2026-09-27-scanned-handoff.md')
  outside = path.join(dir, 'elsewhere', 'victim.md')
  await mkdir(path.dirname(scanned), { recursive: true })
  await mkdir(path.dirname(outside), { recursive: true })
  await writeFile(scanned, '---\ntitle: Scanned\nproject: demo\n---\n\n# Scanned\n')
  await writeFile(outside, '---\ntitle: Victim\n---\n\n# Victim\n')
  refreshAfterWrite = vi.fn<() => void>()
  writeClipboard = vi.fn<(text: string) => void>()
})

const snapshotOf = (...paths: string[]): Pick<QaSnapshot, 'handoffs'> =>
  ({ handoffs: paths.map((p) => ({ path: p })) }) as unknown as Pick<QaSnapshot, 'handoffs'>

describe('handoff IPC handlers write only beside scanned handoffs', () => {
  test('archive and copy prompt still work for a handoff in the snapshot', async () => {
    const h = handlers(snapshotOf(scanned))

    expect(await h.copyPrompt(scanned)).toEqual({ pickedUpAt: NOW, archivedAt: null })
    expect(writeClipboard).toHaveBeenCalledWith(expect.stringContaining('Continue the Scanned'))

    expect(await h.archive(scanned)).toEqual({ pickedUpAt: NOW, archivedAt: NOW })
    expect(refreshAfterWrite).toHaveBeenCalledTimes(1)
    expect((await readHandoffSidecar(scanned)).archivedAt).toBe(NOW)

    expect(await h.unarchive(scanned)).toEqual({ pickedUpAt: NOW, archivedAt: null })
    expect(refreshAfterWrite).toHaveBeenCalledTimes(2)
  })

  test('a refused path returns null and writes no sidecar, reads nothing, copies nothing', async () => {
    const h = handlers(snapshotOf(scanned))
    const refused: unknown[] = [
      outside,
      path.join(dir, 'record', '..', 'elsewhere', 'victim.md'),
      42,
      null
    ]
    for (const candidate of refused) {
      expect(await h.copyPrompt(candidate)).toBeNull()
      expect(await h.archive(candidate)).toBeNull()
      expect(await h.unarchive(candidate)).toBeNull()
    }
    expect(await readdir(path.join(dir, 'elsewhere'))).toEqual(['victim.md'])
    expect(await readdir(path.dirname(scanned))).toEqual(['2026-09-27-scanned-handoff.md'])
    expect(writeClipboard).not.toHaveBeenCalled()
    expect(refreshAfterWrite).not.toHaveBeenCalled()
  })

  test('with no snapshot nothing is written even for a real handoff path', async () => {
    const h = handlers(null)
    expect(await h.archive(scanned)).toBeNull()
    expect(await h.copyPrompt(scanned)).toBeNull()
    await expect(readdir(path.dirname(handoffSidecarPathFor(scanned)))).resolves.toEqual([
      '2026-09-27-scanned-handoff.md'
    ])
    expect(writeClipboard).not.toHaveBeenCalled()
  })
})
