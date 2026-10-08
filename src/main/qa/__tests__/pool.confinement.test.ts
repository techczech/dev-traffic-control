import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  addProjectPoolIdea,
  editProjectPoolIdea,
  markProjectPoolSeen,
  promoteProjectPoolIdea,
  readProjectPool,
  reorderProjectPool,
  writePoolOrder
} from '../pool'
import { patchPoolIdeaFile } from '../poolIdeaFile'

// Roadmap reads and writes stay inside the records folder: a linked roadmap
// folder, project folder or idea file is refused, and what it points to is
// neither shown nor changed.

const PROJECT = 'example-app'
const AT = '2026-10-08T09:00:00.000Z'
const IDEA = '---\nid: quiet-mode\ntitle: Quiet mode\ntier: functionality\n---\n\nOutside body.\n'
const ORDER = `${JSON.stringify({ positions: { 'quiet-mode': 1 }, states: {} }, null, 2)}\n`

let parent: string
let root: string
/** A roadmap folder outside the records folder, holding one idea and an order file. */
let outsideRoadmap: string
let outsideIdea: string
let outsideOrder: string

beforeEach(async () => {
  parent = realpathSync(await mkdtemp(path.join(tmpdir(), 'dtc-pool-confinement-')))
  root = path.join(parent, 'records')
  outsideRoadmap = path.join(parent, 'elsewhere', PROJECT, 'roadmap')
  outsideIdea = path.join(outsideRoadmap, 'quiet-mode.md')
  outsideOrder = path.join(outsideRoadmap, 'order.json')
  await mkdir(root)
  await mkdir(outsideRoadmap, { recursive: true })
  await writeFile(outsideIdea, IDEA)
  await writeFile(outsideOrder, ORDER)
})

afterEach(async () => {
  await rm(parent, { recursive: true, force: true })
})

async function expectOutsideUntouched(): Promise<void> {
  expect(await readFile(outsideIdea, 'utf8')).toBe(IDEA)
  expect(await readFile(outsideOrder, 'utf8')).toBe(ORDER)
  expect((await readdir(outsideRoadmap)).sort()).toEqual(['order.json', 'quiet-mode.md'])
}

/** Every roadmap write the app can make, against a place the rule refuses. */
async function expectEveryWriteRefused(): Promise<void> {
  await expect(
    editProjectPoolIdea(root, PROJECT, 'quiet-mode', {
      title: 'Changed',
      bodyMarkdown: 'Changed body.',
      fate: 'planned',
      candidate: '1.2.0'
    })
  ).rejects.toThrow()
  await expect(
    editProjectPoolIdea(root, PROJECT, 'quiet-mode', { appendEntry: 'A reviewer entry.' })
  ).rejects.toThrow()
  await expect(reorderProjectPool(root, PROJECT, 'quiet-mode', 'right')).rejects.toThrow()
  await expect(
    promoteProjectPoolIdea(root, PROJECT, 'quiet-mode', '1.2.0', false, AT)
  ).rejects.toThrow()
  await expect(
    addProjectPoolIdea(root, PROJECT, {
      title: 'A new idea',
      bodyMarkdown: 'Body.',
      tier: 'delight',
      addedAt: AT
    })
  ).rejects.toThrow()
  await expect(markProjectPoolSeen(root, PROJECT, AT)).rejects.toThrow()
  await expect(writePoolOrder(root, PROJECT, { positions: {}, states: {} })).rejects.toThrow()
}

describe('roadmap confinement', () => {
  test('a symlinked roadmap folder is not read and no write reaches what it points to', async () => {
    await mkdir(path.join(root, PROJECT))
    await symlink(outsideRoadmap, path.join(root, PROJECT, 'roadmap'))

    const pool = await readProjectPool(root, PROJECT)

    expect(pool.ideas).toEqual([])
    expect(pool.degradedOrder).toBe(true)
    await expectEveryWriteRefused()
    await expectOutsideUntouched()
  })

  test('a symlinked project folder is not read and no write reaches what it points to', async () => {
    await symlink(path.dirname(outsideRoadmap), path.join(root, PROJECT))

    expect((await readProjectPool(root, PROJECT)).ideas).toEqual([])
    await expectEveryWriteRefused()
    await expectOutsideUntouched()
  })

  test('a roadmap folder linked to another folder inside the records is refused too', async () => {
    const inside = path.join(root, 'other-app', 'roadmap')
    await mkdir(inside, { recursive: true })
    await writeFile(path.join(inside, 'quiet-mode.md'), IDEA)
    await mkdir(path.join(root, PROJECT))
    await symlink(inside, path.join(root, PROJECT, 'roadmap'))

    expect((await readProjectPool(root, PROJECT)).ideas).toEqual([])
    await expectEveryWriteRefused()
    expect(await readFile(path.join(inside, 'quiet-mode.md'), 'utf8')).toBe(IDEA)
    expect(await readdir(inside)).toEqual(['quiet-mode.md'])
  })

  test('a symlinked idea file is not an idea and is never patched', async () => {
    const roadmap = path.join(root, PROJECT, 'roadmap')
    await mkdir(roadmap, { recursive: true })
    const link = path.join(roadmap, 'quiet-mode.md')
    await symlink(outsideIdea, link)

    expect((await readProjectPool(root, PROJECT)).ideas).toEqual([])
    await expect(
      editProjectPoolIdea(root, PROJECT, 'quiet-mode', { title: 'Changed' })
    ).rejects.toThrow('Roadmap idea not found.')
    // The patch itself refuses, by plain names and by absolute path alike.
    for (const file of [`${PROJECT}/roadmap/quiet-mode.md`, link]) {
      await expect(
        patchPoolIdeaFile(root, file, { title: 'Changed', appendEntry: 'An entry.' })
      ).rejects.toMatchObject({ code: 'ECONFINED', reason: 'symlink' })
    }
    await expectOutsideUntouched()
    // The link is still a link: nothing was written over it either.
    expect(await readdir(roadmap)).toEqual(['quiet-mode.md'])
    expect(await readFile(link, 'utf8')).toBe(IDEA)
  })

  test('a symlinked order file is not read, and a write does not rebuild it from nothing', async () => {
    const roadmap = path.join(root, PROJECT, 'roadmap')
    await mkdir(roadmap, { recursive: true })
    await writeFile(path.join(roadmap, 'quiet-mode.md'), IDEA)
    await symlink(outsideOrder, path.join(roadmap, 'order.json'))

    const pool = await readProjectPool(root, PROJECT)

    expect(pool.ideas.map((idea) => idea.id)).toEqual(['quiet-mode'])
    expect(pool.degradedOrder).toBe(true)
    await expect(markProjectPoolSeen(root, PROJECT, AT)).rejects.toMatchObject({
      code: 'ECONFINED'
    })
    await expectOutsideUntouched()
  })

  test('a project name that is not one plain folder name is refused', async () => {
    await mkdir(path.join(root, PROJECT, 'roadmap'), { recursive: true })

    for (const project of ['../elsewhere/example-app', `${PROJECT}/..`, '.', '..', '']) {
      expect((await readProjectPool(root, project)).ideas).toEqual([])
      await expect(markProjectPoolSeen(root, project, AT)).rejects.toMatchObject({
        code: 'ECONFINED'
      })
    }
    await expectOutsideUntouched()
  })

  test('a real roadmap folder still takes every write', async () => {
    const roadmap = path.join(root, PROJECT, 'roadmap')
    await mkdir(roadmap, { recursive: true })
    await writeFile(path.join(roadmap, 'quiet-mode.md'), IDEA)

    await editProjectPoolIdea(root, PROJECT, 'quiet-mode', { title: 'Changed', fate: 'planned' })
    const added = await addProjectPoolIdea(root, PROJECT, {
      title: 'A new idea',
      bodyMarkdown: 'Body.',
      tier: 'delight',
      addedAt: AT
    })

    expect(added.pool.ideas.map((idea) => idea.title).sort()).toEqual(['A new idea', 'Changed'])
    expect(await readFile(path.join(roadmap, 'quiet-mode.md'), 'utf8')).toContain('fate: planned')
    expect((await readdir(roadmap)).sort()).toEqual([
      'a-new-idea.md',
      'order.json',
      'quiet-mode.md'
    ])
  })
})
