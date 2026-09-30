import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { createRevealHandlers } from '../revealIpc'
import type { QaSnapshot } from '../../shared/ipc'

let root: string
let handoff: string
let report: string
let outside: string
let showItemInFolder: Mock<(fullPath: string) => void>

beforeEach(async () => {
  const parent = realpathSync(await mkdtemp(path.join(tmpdir(), 'dtc-reveal-')))
  root = path.join(parent, '_REC')
  handoff = path.join(root, 'demo', 'handoffs', '2026-09-28-demo-handoff.md')
  report = path.join(root, 'demo', 'round-1', 'request.report.json')
  outside = path.join(parent, 'elsewhere', 'secret.txt')
  for (const file of [handoff, report, outside]) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, 'x')
  }
  showItemInFolder = vi.fn<(fullPath: string) => void>()
})

function handlers(handoffs: string[]): ReturnType<typeof createRevealHandlers> {
  return createRevealHandlers({
    recordRoot: () => root,
    snapshot: () =>
      ({ handoffs: handoffs.map((p) => ({ path: p })) }) as unknown as Pick<QaSnapshot, 'handoffs'>,
    showItemInFolder
  })
}

describe('reveal handlers show only what lives in the record root', () => {
  test('a scanned handoff and an in-root record file are revealed', async () => {
    const h = handlers([handoff])
    expect(h.revealHandoff(handoff)).toBe(true)
    expect(await h.revealPath(report)).toBe(true)
    expect(showItemInFolder.mock.calls).toEqual([[handoff], [report]])
  })

  test('an unscanned handoff path is refused', () => {
    const h = handlers([handoff])
    expect(h.revealHandoff(outside)).toBe(false)
    expect(h.revealHandoff(42)).toBe(false)
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  test('an outside path, traversal, relative path or symlink out of the root is refused', async () => {
    const link = path.join(root, 'demo', 'link.txt')
    await symlink(outside, link)
    const h = handlers([handoff])
    for (const candidate of [
      outside,
      path.join(root, '..', 'elsewhere', 'secret.txt'),
      'demo/round-1/request.report.json',
      link,
      root,
      null
    ]) {
      expect(await h.revealPath(candidate)).toBe(false)
    }
    expect(showItemInFolder).not.toHaveBeenCalled()
  })
})
