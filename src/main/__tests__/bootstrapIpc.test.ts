import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRootChoiceHandlers } from '../bootstrapIpc'
import { ensureQaRepo } from '../qa/bootstrap'

type FakeEvent = { sender: { id: number } }
const WINDOW_A: FakeEvent = { sender: { id: 1 } }
const WINDOW_B: FakeEvent = { sender: { id: 2 } }

let parent: string
let current: string
let previous: string[]
let dialogAnswer: string | null

beforeEach(async () => {
  parent = await mkdtemp(path.join(tmpdir(), 'dtc-bootstrap-ipc-'))
  current = path.join(parent, '_REC')
  previous = []
  dialogAnswer = null
})

function handlers(): {
  h: ReturnType<typeof createRootChoiceHandlers<FakeEvent, { qaRepoPath: string }>>
  bootstrap: ReturnType<typeof vi.fn>
  setRoot: ReturnType<typeof vi.fn>
} {
  const bootstrap = vi.fn(async (root: string) => {
    await ensureQaRepo(root)
    return { qaRepoPath: root }
  })
  const setRoot = vi.fn(async (_event: FakeEvent, root: string) => {
    current = root
    return { qaRepoPath: root }
  })
  const h = createRootChoiceHandlers<FakeEvent, { qaRepoPath: string }>({
    currentRoot: () => current,
    previousRoots: () => previous,
    senderId: (event) => event.sender.id,
    showFolderDialog: async () => dialogAnswer,
    bootstrap,
    setRoot
  })
  return { h, bootstrap, setRoot }
}

describe('the record root re-points only to a folder the user picked or main already holds', () => {
  test('the current root bootstraps (Onboarding default)', async () => {
    const { h } = handlers()
    expect(await h.bootstrapRepo(WINDOW_A, current)).toEqual({ qaRepoPath: current })
    expect(await readdir(current)).toContain('AGENTS.md')
  })

  test('the folder the dialog just returned bootstraps, and sets the root (Settings path row)', async () => {
    const { h, setRoot } = handlers()
    dialogAnswer = path.join(parent, 'picked')
    expect(await h.pickFolder(WINDOW_A)).toBe(dialogAnswer)
    expect(await h.bootstrapRepo(WINDOW_A, dialogAnswer)).toEqual({ qaRepoPath: dialogAnswer })
    expect(await h.setRoot(WINDOW_A, dialogAnswer)).toEqual({ qaRepoPath: dialogAnswer })
    expect(setRoot).toHaveBeenCalledTimes(1)
  })

  test("a root from main's own settings log is allowed (the changelog Reset)", async () => {
    const { h } = handlers()
    previous = [path.join(parent, 'earlier')]
    expect(await h.setRoot(WINDOW_A, previous[0])).toEqual({ qaRepoPath: previous[0] })
  })

  test('any other folder is refused by both calls, and nothing is created, written or re-pointed', async () => {
    const { h, bootstrap, setRoot } = handlers()
    dialogAnswer = path.join(parent, 'picked')
    await h.pickFolder(WINDOW_A)
    for (const root of [path.join(parent, 'unpicked'), `${current}/..`, '', 42, null]) {
      expect(await h.bootstrapRepo(WINDOW_A, root)).toBeNull()
      expect(await h.setRoot(WINDOW_A, root)).toBeNull()
    }
    expect(bootstrap).not.toHaveBeenCalled()
    expect(setRoot).not.toHaveBeenCalled()
    expect(current).toBe(path.join(parent, '_REC'))
    expect(await readdir(parent)).toEqual([])
  })

  test("one window's pick does not authorise another window", async () => {
    const { h, bootstrap, setRoot } = handlers()
    dialogAnswer = path.join(parent, 'picked')
    await h.pickFolder(WINDOW_A)
    expect(await h.bootstrapRepo(WINDOW_B, dialogAnswer)).toBeNull()
    expect(await h.setRoot(WINDOW_B, dialogAnswer)).toBeNull()
    expect(bootstrap).not.toHaveBeenCalled()
    expect(setRoot).not.toHaveBeenCalled()
  })

  test('a later dialog replaces the earlier choice, and a cancelled one withdraws it', async () => {
    const { h, bootstrap } = handlers()
    const first = path.join(parent, 'first')
    dialogAnswer = first
    await h.pickFolder(WINDOW_A)
    dialogAnswer = path.join(parent, 'second')
    await h.pickFolder(WINDOW_A)
    expect(await h.bootstrapRepo(WINDOW_A, first)).toBeNull()

    dialogAnswer = null
    await h.pickFolder(WINDOW_A)
    expect(await h.bootstrapRepo(WINDOW_A, path.join(parent, 'second'))).toBeNull()
    expect(bootstrap).not.toHaveBeenCalled()
    expect(await readdir(parent)).toEqual([])
  })
})
