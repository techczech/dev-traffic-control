import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const atomicWrites = vi.hoisted(() => [] as Array<{ path: string; data: string }>)

vi.mock('../atomicWrite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../atomicWrite')>()
  return {
    atomicWrite: async (filePath: string, data: string): Promise<void> => {
      atomicWrites.push({ path: filePath, data })
      await actual.atomicWrite(filePath, data)
    }
  }
})

import {
  markProjectPoolSeen,
  placeProjectPoolIdea,
  promoteProjectPoolIdea,
  readProjectPool,
  reorderProjectPool,
  restoreProjectPoolIdea,
  setAsideProjectPoolIdea,
  writePoolOrder,
  type PoolOrder
} from '../pool'
import type { PoolTier, ProjectPool } from '../pool'

type PoolWriterModule = typeof import('../pool') & {
  editProjectPoolIdea?: (
    root: string,
    project: string,
    id: string,
    changes: { title?: string; bodyMarkdown?: string }
  ) => Promise<ProjectPool>
  addProjectPoolIdea?: (
    root: string,
    project: string,
    idea: {
      title: string
      bodyMarkdown: string
      tier: PoolTier
      addedAt: string
    }
  ) => Promise<{ pool: ProjectPool; id: string }>
}

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'dtc-pool-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeIdea(
  root: string,
  project: string,
  id: string,
  fields: { title: string; tier: string; added?: string; candidate?: string }
): Promise<string> {
  const filePath = path.join(root, project, 'roadmap', `${id}.md`)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `---\nid: ${id}\ntitle: ${fields.title}\ntier: ${fields.tier}\n${fields.added ? `added: ${fields.added}\n` : ''}${fields.candidate ? `candidate: ${fields.candidate}\n` : ''}---\n\nBody for ${id}.\n`
  )
  return filePath
}

afterEach(async () => {
  atomicWrites.splice(0)
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('roadmap pool', () => {
  test('merges a returned entry with a later idea file without duplicating it', async () => {
    const root = await temporaryDirectory()
    const project = 'wordforge'
    const roadmapDirectory = path.join(root, project, 'roadmap')
    await mkdir(roadmapDirectory, { recursive: true })
    await writeFile(
      path.join(roadmapDirectory, 'order.json'),
      JSON.stringify({
        positions: { 'send-html': 1 },
        states: {},
        returned: {
          'send-html': {
            title: 'Returned title',
            tier: 'functionality',
            from: '0.19.6',
            at: '2026-08-07T06:00:00.000Z'
          }
        }
      })
    )

    expect((await readProjectPool(root, project)).ideas).toEqual([
      expect.objectContaining({
        id: 'send-html',
        title: 'Returned title',
        tier: 'functionality',
        returnedFrom: '0.19.6',
        bodyMarkdown: ''
      })
    ])

    await writeIdea(root, project, 'send-html', {
      title: 'The agent-authored title',
      tier: 'quality-of-life',
      candidate: '0.20.0'
    })

    const merged = await readProjectPool(root, project)
    expect(merged.ideas).toHaveLength(1)
    expect(merged.ideas[0]).toMatchObject({
      id: 'send-html',
      title: 'The agent-authored title',
      tier: 'quality-of-life',
      candidateRelease: '0.20.0',
      returnedFrom: '0.19.6',
      bodyMarkdown: 'Body for send-html.'
    })
  })

  test('a returned entry later promoted from its idea file does not reappear in the pool', async () => {
    const root = await temporaryDirectory()
    const project = 'wordforge'
    await writeIdea(root, project, 'send-html', {
      title: 'Send a draft as HTML',
      tier: 'functionality'
    })
    await writeFile(
      path.join(root, project, 'roadmap', 'order.json'),
      JSON.stringify({
        positions: { 'send-html': 1 },
        states: {
          'send-html': {
            state: 'promoted',
            release: '0.20.0',
            at: '2026-08-08T06:00:00.000Z'
          }
        },
        returned: {
          'send-html': {
            title: 'Returned title',
            tier: 'functionality',
            from: '0.19.6',
            at: '2026-08-07T06:00:00.000Z'
          }
        }
      })
    )

    const result = await readProjectPool(root, project)

    expect(result.ideas).toHaveLength(1)
    expect(result.ideas[0]).toMatchObject({
      id: 'send-html',
      state: 'promoted',
      candidateRelease: '0.20.0',
      returnedFrom: '0.19.6'
    })
    expect(result.ideas.filter((idea) => idea.state === 'pool')).toHaveLength(0)
  })

  test('reads every idea in lane order and resolves positions, states, releases and new marks', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    await writeIdea(root, project, 'later-positioned', {
      title: 'Later positioned',
      tier: 'functionality',
      added: '2026-08-03',
      candidate: '0.16.0'
    })
    await writeIdea(root, project, 'first-positioned', {
      title: 'First positioned',
      tier: 'functionality',
      added: '2026-08-04',
      candidate: '0.15.0'
    })
    await writeIdea(root, project, 'unpositioned-b', {
      title: 'Unpositioned B',
      tier: 'functionality',
      added: '2026-08-07'
    })
    await writeIdea(root, project, 'unpositioned-a', {
      title: 'Unpositioned A',
      tier: 'functionality',
      added: '2026-08-07'
    })
    await writeIdea(root, project, 'quality', {
      title: 'Quality',
      tier: 'quality-of-life',
      added: '2026-08-01'
    })
    await writeIdea(root, project, 'delight', {
      title: 'Delight',
      tier: 'delight',
      added: '2026-08-02'
    })
    await writeFile(
      path.join(root, project, 'roadmap', 'order.json'),
      JSON.stringify({
        positions: { 'first-positioned': 1, 'later-positioned': 2 },
        states: {
          'later-positioned': { release: '0.18.0' },
          'first-positioned': {
            state: 'promoted',
            release: '0.17.0',
            at: '2026-08-07T00:00:00.000Z'
          },
          'unpositioned-b': {
            state: 'setaside',
            reason: 'Wrong app for it.',
            at: '2026-08-07T09:00:00.000Z'
          },
          missing: { state: 'setaside', reason: 'No file exists.' }
        },
        seenAt: '2026-08-06T22:00:00.000Z'
      })
    )

    const result = await readProjectPool(root, project)

    expect(result.degradedOrder).toBe(false)
    expect(result.seenAt).toBe('2026-08-06T22:00:00.000Z')
    expect(result.ideas.map((idea) => idea.id)).toEqual([
      'first-positioned',
      'later-positioned',
      'unpositioned-a',
      'unpositioned-b',
      'quality',
      'delight'
    ])
    expect(result.ideas.map((idea) => [idea.id, idea.position])).toEqual([
      ['first-positioned', 1],
      ['later-positioned', 2],
      ['unpositioned-a', 3],
      ['unpositioned-b', 4],
      ['quality', 1],
      ['delight', 1]
    ])
    expect(result.ideas[0]).toMatchObject({
      state: 'promoted',
      candidateRelease: '0.17.0',
      isNew: false
    })
    expect(result.ideas[1]).toMatchObject({ state: 'pool', candidateRelease: '0.18.0' })
    expect(result.ideas[2].isNew).toBe(true)
    expect(result.ideas[3]).toMatchObject({
      state: 'setaside',
      setAsideReason: 'Wrong app for it.',
      isNew: true
    })
  })

  test('a malformed order sidecar degrades to the pool and default deterministic order', async () => {
    const root = await temporaryDirectory()
    const project = 'tallyboard'
    await writeIdea(root, project, 'z-last', {
      title: 'Z last',
      tier: 'functionality',
      added: '2026-08-07',
      candidate: '0.20.0'
    })
    await writeIdea(root, project, 'a-first', {
      title: 'A first',
      tier: 'functionality',
      added: '2026-08-01'
    })
    await writeFile(path.join(root, project, 'roadmap', 'order.json'), '{ not JSON')

    const result = await readProjectPool(root, project)

    expect(result.degradedOrder).toBe(true)
    expect(result.seenAt).toBeUndefined()
    expect(result.ideas.map((idea) => idea.id)).toEqual(['a-first', 'z-last'])
    expect(result.ideas.map((idea) => idea.state)).toEqual(['pool', 'pool'])
    expect(result.ideas.map((idea) => idea.position)).toEqual([1, 2])
    expect(result.ideas[1].candidateRelease).toBe('0.20.0')
  })

  test('the writer atomically changes order.json without rewriting an idea file', async () => {
    const root = await temporaryDirectory()
    const project = 'wordforge-desktop'
    const ideaPath = await writeIdea(root, project, 'collections', {
      title: 'Collections working properly',
      tier: 'functionality',
      added: '2026-08-06'
    })
    const originalIdea = await readFile(ideaPath, 'utf8')
    const order: PoolOrder = {
      positions: { collections: 1 },
      states: {
        collections: {
          state: 'setaside',
          reason: 'Superseded by the board.',
          at: '2026-08-07T10:00:00.000Z'
        }
      },
      seenAt: '2026-08-07T10:00:00.000Z'
    }

    await writePoolOrder(root, project, order)

    const orderPath = path.join(root, project, 'roadmap', 'order.json')
    expect(JSON.parse(await readFile(orderPath, 'utf8'))).toEqual(order)
    expect(await readFile(ideaPath, 'utf8')).toBe(originalIdea)
    expect(atomicWrites).toEqual([{ path: orderPath, data: `${JSON.stringify(order, null, 2)}\n` }])
  })

  test('moving an idea up changes exactly the two positions and touches no idea file', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    const firstPath = await writeIdea(root, project, 'first', {
      title: 'First',
      tier: 'functionality'
    })
    const secondPath = await writeIdea(root, project, 'second', {
      title: 'Second',
      tier: 'functionality'
    })
    const thirdPath = await writeIdea(root, project, 'third', {
      title: 'Third',
      tier: 'functionality'
    })
    const ideaFilesBefore = await Promise.all(
      [firstPath, secondPath, thirdPath].map((filePath) => readFile(filePath, 'utf8'))
    )
    await writeFile(
      path.join(root, project, 'roadmap', 'order.json'),
      JSON.stringify({
        positions: { first: 1, second: 2, third: 3 },
        states: {},
        seenAt: '2026-08-06T22:00:00.000Z'
      })
    )

    const result = await reorderProjectPool(root, project, 'second', 'up')

    expect(result.changedIds).toEqual(['first', 'second'])
    expect(result.pool.ideas.map((idea) => [idea.id, idea.position])).toEqual([
      ['second', 1],
      ['first', 2],
      ['third', 3]
    ])
    expect(
      JSON.parse(await readFile(path.join(root, project, 'roadmap', 'order.json'), 'utf8'))
        .positions
    ).toEqual({ first: 2, second: 1, third: 3 })
    expect(
      await Promise.all(
        [firstPath, secondPath, thirdPath].map((filePath) => readFile(filePath, 'utf8'))
      )
    ).toEqual(ideaFilesBefore)
  })

  test('moving an idea between lanes changes only tier in its idea file', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    const ideaPath = path.join(root, project, 'roadmap', 'first.md')
    await mkdir(path.dirname(ideaPath), { recursive: true })
    const original =
      '---\nid: first\ntitle: First\ntier: functionality\nadded: 2026-08-06\ncandidate: 0.15.0\nunknown-key: keep this exactly\n---\n\nA paragraph with trailing spaces.  \n\n- first item\n- second item  \n\n'
    await writeFile(ideaPath, original)
    const orderPath = path.join(root, project, 'roadmap', 'order.json')
    await writeFile(orderPath, JSON.stringify({ positions: { first: 1 }, states: {} }))

    const result = await reorderProjectPool(root, project, 'first', 'right')

    expect(await readFile(ideaPath, 'utf8')).toBe(
      original.replace('tier: functionality', 'tier: quality-of-life')
    )
    expect(result.pool.ideas[0]).toMatchObject({
      id: 'first',
      tier: 'quality-of-life',
      position: 1
    })
    expect(atomicWrites.map((write) => write.path)).toEqual([ideaPath, orderPath])
  })

  test('editing a title leaves the body and every other frontmatter byte untouched', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    const ideaPath = path.join(root, project, 'roadmap', 'first.md')
    await mkdir(path.dirname(ideaPath), { recursive: true })
    const original =
      '---\nid: first\ntitle: First title\ntier: functionality\nunknown-key: "keep: this"\n---\n\nBody line.  \n\n- one\n- two  \n'
    await writeFile(ideaPath, original)
    const writer = (await import('../pool')) as PoolWriterModule

    expect(writer.editProjectPoolIdea).toBeTypeOf('function')
    if (!writer.editProjectPoolIdea) return
    const pool = await writer.editProjectPoolIdea(root, project, 'first', {
      title: 'Changed title'
    })

    expect(await readFile(ideaPath, 'utf8')).toBe(
      original.replace('title: First title', 'title: Changed title')
    )
    expect(pool.ideas[0]).toMatchObject({
      title: 'Changed title',
      bodyMarkdown: 'Body line.  \n\n- one\n- two'
    })
  })

  test('editing a body leaves the complete frontmatter byte-identical', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    const ideaPath = path.join(root, project, 'roadmap', 'first.md')
    await mkdir(path.dirname(ideaPath), { recursive: true })
    const prefix =
      '---\nid: first\ntitle: First title\ntier: functionality\nunknown-key: "keep: this"\n---\n\n'
    await writeFile(ideaPath, `${prefix}Original body.\n`)
    const writer = (await import('../pool')) as PoolWriterModule

    expect(writer.editProjectPoolIdea).toBeTypeOf('function')
    if (!writer.editProjectPoolIdea) return
    const pool = await writer.editProjectPoolIdea(root, project, 'first', {
      bodyMarkdown: 'Changed body.\n\n- one\n- two  \n'
    })

    expect(await readFile(ideaPath, 'utf8')).toBe(`${prefix}Changed body.\n\n- one\n- two  \n`)
    expect(pool.ideas[0]).toMatchObject({
      title: 'First title',
      bodyMarkdown: 'Changed body.\n\n- one\n- two'
    })
  })

  test('adding colliding titles creates two complete agent-shaped idea files', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    const writer = (await import('../pool')) as PoolWriterModule

    expect(writer.addProjectPoolIdea).toBeTypeOf('function')
    if (!writer.addProjectPoolIdea) return
    const first = await writer.addProjectPoolIdea(root, project, {
      title: 'A useful idea',
      bodyMarkdown: 'The first body.\n',
      tier: 'delight',
      addedAt: '2026-08-07T12:00:00.000Z'
    })
    const second = await writer.addProjectPoolIdea(root, project, {
      title: 'A useful idea',
      bodyMarkdown: 'The second body.\n',
      tier: 'delight',
      addedAt: '2026-08-07T12:01:00.000Z'
    })

    expect([first.id, second.id]).toEqual(['a-useful-idea', 'a-useful-idea-2'])
    expect(await readFile(path.join(root, project, 'roadmap', `${first.id}.md`), 'utf8')).toBe(
      '---\nid: a-useful-idea\ntitle: A useful idea\ntier: delight\nadded: 2026-08-07\n---\n\nThe first body.\n'
    )
    expect(await readFile(path.join(root, project, 'roadmap', `${second.id}.md`), 'utf8')).toBe(
      '---\nid: a-useful-idea-2\ntitle: A useful idea\ntier: delight\nadded: 2026-08-07\n---\n\nThe second body.\n'
    )
    expect(second.pool.ideas.map((idea) => [idea.id, idea.position])).toEqual([
      ['a-useful-idea', 1],
      ['a-useful-idea-2', 2]
    ])
  })

  test('placing an idea before another writes every changed rank and no others', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    for (const id of ['first', 'second', 'third', 'fourth']) {
      await writeIdea(root, project, id, {
        title: id,
        tier: 'functionality'
      })
    }
    await writeFile(
      path.join(root, project, 'roadmap', 'order.json'),
      JSON.stringify({
        positions: { first: 1, second: 2, third: 3, fourth: 4 },
        states: {}
      })
    )

    const result = await placeProjectPoolIdea(root, project, 'third', 'first')

    expect(result.changedIds).toEqual(['third', 'first', 'second'])
    expect(result.pool.ideas.map((idea) => [idea.id, idea.position])).toEqual([
      ['third', 1],
      ['first', 2],
      ['second', 3],
      ['fourth', 4]
    ])
    expect(
      JSON.parse(await readFile(path.join(root, project, 'roadmap', 'order.json'), 'utf8'))
        .positions
    ).toEqual({ first: 2, second: 3, third: 1, fourth: 4 })
  })

  test('opening a pool advances seenAt and clears its new marks without changing order', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    await writeIdea(root, project, 'first', {
      title: 'First',
      tier: 'functionality',
      added: '2026-08-07T08:00:00.000Z'
    })
    await writeFile(
      path.join(root, project, 'roadmap', 'order.json'),
      JSON.stringify({
        positions: { first: 1 },
        states: {},
        seenAt: '2026-08-06T22:00:00.000Z'
      })
    )
    expect((await readProjectPool(root, project)).ideas[0].isNew).toBe(true)

    const result = await markProjectPoolSeen(root, project, '2026-08-07T09:00:00.000Z')

    expect(result.seenAt).toBe('2026-08-07T09:00:00.000Z')
    expect(result.ideas[0].isNew).toBe(false)
    expect(
      JSON.parse(await readFile(path.join(root, project, 'roadmap', 'order.json'), 'utf8'))
    ).toEqual({
      positions: { first: 1 },
      states: {},
      seenAt: '2026-08-07T09:00:00.000Z'
    })
  })

  test('promoting an idea records its release and spec choice without touching the idea file', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    const ideaPath = await writeIdea(root, project, 'tabs', {
      title: 'Tabs',
      tier: 'functionality'
    })
    const ideaBefore = await readFile(ideaPath, 'utf8')

    const result = await promoteProjectPoolIdea(
      root,
      project,
      'tabs',
      '0.15.0',
      true,
      '2026-08-07T10:00:00.000Z'
    )

    expect(result.ideas[0]).toMatchObject({
      id: 'tabs',
      state: 'promoted',
      candidateRelease: '0.15.0',
      specWanted: true,
      stateAt: '2026-08-07T10:00:00.000Z'
    })
    expect(
      JSON.parse(await readFile(path.join(root, project, 'roadmap', 'order.json'), 'utf8')).states
        .tabs
    ).toEqual({
      state: 'promoted',
      release: '0.15.0',
      specWanted: true,
      at: '2026-08-07T10:00:00.000Z'
    })
    expect(await readFile(ideaPath, 'utf8')).toBe(ideaBefore)
  })

  test('setting aside refuses an empty or multiline reason at the writer seam', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    await writeIdea(root, project, 'tabs', { title: 'Tabs', tier: 'functionality' })

    await expect(
      setAsideProjectPoolIdea(root, project, 'tabs', '   ', '2026-08-07T10:00:00.000Z')
    ).rejects.toThrow('A one-line reason is required to set an idea aside.')
    await expect(
      setAsideProjectPoolIdea(
        root,
        project,
        'tabs',
        'First line\nsecond line',
        '2026-08-07T10:00:00.000Z'
      )
    ).rejects.toThrow('A one-line reason is required to set an idea aside.')
    await expect(
      readFile(path.join(root, project, 'roadmap', 'order.json'), 'utf8')
    ).rejects.toThrow()
    expect(atomicWrites).toHaveLength(0)
  })

  test('putting a set-aside idea back restores it at the end of its lane', async () => {
    const root = await temporaryDirectory()
    const project = 'dev-traffic-control'
    for (const id of ['first', 'second', 'third']) {
      await writeIdea(root, project, id, { title: id, tier: 'functionality' })
    }
    await writeFile(
      path.join(root, project, 'roadmap', 'order.json'),
      JSON.stringify({ positions: { first: 1, second: 2, third: 3 }, states: {} })
    )

    const setAside = await setAsideProjectPoolIdea(
      root,
      project,
      'second',
      'Not for this release.',
      '2026-08-07T10:00:00.000Z'
    )
    expect(setAside.ideas.find((idea) => idea.id === 'second')).toMatchObject({
      state: 'setaside',
      setAsideReason: 'Not for this release.'
    })

    const restored = await restoreProjectPoolIdea(root, project, 'second')

    expect(
      restored.ideas
        .filter((idea) => idea.tier === 'functionality' && idea.state === 'pool')
        .map((idea) => idea.id)
    ).toEqual(['first', 'third', 'second'])
    expect(
      JSON.parse(await readFile(path.join(root, project, 'roadmap', 'order.json'), 'utf8'))
    ).toMatchObject({
      positions: { first: 1, second: 4, third: 3 },
      states: {}
    })
  })
})
