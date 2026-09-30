import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createReleaseShotHandlers } from '../releaseShotIpc'
import { readProjectRelease, type ProjectRelease } from '../qa/releaseRecords'
import type { QaSnapshot } from '../../shared/ipc'

/**
 * Ticket 25. Verdict pictures are the one renderer-initiated write into a
 * release folder: only `<project>/releases/<version>.shots/<feature>-<n>.png`,
 * only for a feature of a release in the snapshot, never through a symlink.
 */

const PNG = Buffer.from('fake png bytes').toString('base64')
const LEDGER = `---
app: Demo
release: 0.2.0
repo: apps/demo
---

## Links open on the thing they name {#links}
state: you

## Browse mode
state: built
`

let parent: string
let root: string
let releases: string
let outside: string

beforeEach(async () => {
  parent = realpathSync(await mkdtemp(path.join(tmpdir(), 'dtc-verdict-shots-')))
  root = path.join(parent, '_REC')
  releases = path.join(root, 'demo', 'releases')
  outside = path.join(parent, 'elsewhere')
  await mkdir(releases, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(path.join(releases, '0.2.0.md'), LEDGER)
})

afterEach(async () => {
  await rm(parent, { recursive: true, force: true })
})

async function handlers(
  releasesOf: () => Promise<ProjectRelease[]> = async () => [await readProjectRelease(root, 'demo')]
): Promise<ReturnType<typeof createReleaseShotHandlers>> {
  const snapshot = { releases: await releasesOf() } as Pick<QaSnapshot, 'releases'>
  return createReleaseShotHandlers({ recordRoot: () => root, snapshot: () => snapshot })
}

const add = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  project: 'demo',
  version: '0.2.0',
  id: 'links',
  pngBase64: PNG,
  ...over
})

async function outsideUntouched(): Promise<void> {
  expect(await readdir(outside)).toEqual([])
}

describe('verdict pictures inside the release folder', () => {
  test('add numbers pictures per feature and read gives them back', async () => {
    const h = await handlers()
    expect(await h.add(add())).toBe('releases/0.2.0.shots/links-1.png')
    expect(await h.add(add())).toBe('releases/0.2.0.shots/links-2.png')
    expect(await readdir(path.join(releases, '0.2.0.shots'))).toEqual([
      'links-1.png',
      'links-2.png'
    ])
    expect(
      await h.read({ project: 'demo', version: '0.2.0', rel: 'releases/0.2.0.shots/links-1.png' })
    ).toBe(`data:image/png;base64,${PNG}`)
  })

  test('a picture already on disk is never overwritten', async () => {
    await mkdir(path.join(releases, '0.2.0.shots'))
    await writeFile(path.join(releases, '0.2.0.shots', 'links-1.png'), 'first')
    const h = await handlers()
    expect(await h.add(add())).toBe('releases/0.2.0.shots/links-2.png')
    expect(await readFile(path.join(releases, '0.2.0.shots', 'links-1.png'), 'utf8')).toBe('first')
  })
})

describe('verdict pictures refuse anything outside the snapshot', () => {
  test('a project, a version or a feature the snapshot does not hold', async () => {
    const h = await handlers()
    expect(await h.add(add({ project: 'other' }))).toBeNull()
    expect(await h.add(add({ version: '0.1.0' }))).toBeNull()
    expect(await h.add(add({ id: 'nothing-here' }))).toBeNull()
    expect(await h.add(add({ id: '../../../elsewhere/x' }))).toBeNull()
    // A built feature is not waiting on a verdict, so it takes no picture.
    expect(await h.add(add({ id: 'browse-mode' }))).toBeNull()
    expect(await h.add(add({ pngBase64: '' }))).toBeNull()
    expect(await h.add(add({ pngBase64: 7 }))).toBeNull()
    expect(await h.add(null)).toBeNull()
    await expect(readdir(path.join(releases, '0.2.0.shots'))).rejects.toThrow()
  })

  test('no snapshot means no write', async () => {
    const h = createReleaseShotHandlers({ recordRoot: () => root, snapshot: () => null })
    expect(await h.add(add())).toBeNull()
    await expect(readdir(path.join(releases, '0.2.0.shots'))).rejects.toThrow()
  })

  test('a shots folder that is a symlink out of the root is refused', async () => {
    await symlink(outside, path.join(releases, '0.2.0.shots'))
    const h = await handlers()
    expect(await h.add(add())).toBeNull()
    await outsideUntouched()
  })

  test('a releases folder reached through a symlink is refused', async () => {
    // The project's releases folder lives outside the root, linked in.
    const realReleases = path.join(outside, 'releases')
    await mkdir(realReleases)
    await writeFile(path.join(realReleases, '0.2.0.md'), LEDGER)
    await rm(releases, { recursive: true })
    await symlink(realReleases, releases)
    const h = await handlers()
    expect(await h.add(add())).toBeNull()
    expect(await readdir(realReleases)).toEqual(['0.2.0.md'])
  })

  test('a snapshot record whose ledger is not at <project>/releases is refused', async () => {
    const stray = path.join(root, 'demo', 'round-1')
    await mkdir(stray)
    const release = await readProjectRelease(root, 'demo')
    if (release.kind !== 'recorded') throw new Error('fixture')
    const moved = { ...release.record, path: path.join(stray, '0.2.0.md') }
    const h = await handlers(async () => [
      { ...release, record: moved, versions: [{ version: '0.2.0', record: moved }] }
    ])
    expect(await h.add(add())).toBeNull()
    expect(await readdir(stray)).toEqual([])
  })
})

describe('reading a verdict picture is confined the same way', () => {
  test('only the verdict-picture grammar, for a feature of that release', async () => {
    const h = await handlers()
    await h.add(add())
    await writeFile(path.join(outside, 'secret.png'), 'secret')
    await writeFile(path.join(releases, '0.2.0.answers.json'), '{}')
    const read = (rel: unknown, over: Record<string, unknown> = {}): Promise<string | null> =>
      h.read({ project: 'demo', version: '0.2.0', rel, ...over })

    expect(await read('releases/0.2.0.shots/../../../../elsewhere/secret.png')).toBeNull()
    expect(await read('releases/0.2.0.answers.json')).toBeNull()
    expect(await read('/etc/passwd')).toBeNull()
    expect(await read('releases/0.2.0.shots/unknown-1.png')).toBeNull()
    expect(await read('releases/0.2.0.shots/links-1.png', { version: '0.1.0' })).toBeNull()
    expect(await read('releases/0.2.0.shots/links-1.png', { project: 'other' })).toBeNull()
    expect(await read(7)).toBeNull()
  })

  test('a picture name that is a symlink out of the root is not read', async () => {
    await mkdir(path.join(releases, '0.2.0.shots'))
    await writeFile(path.join(outside, 'secret.png'), 'secret')
    await symlink(
      path.join(outside, 'secret.png'),
      path.join(releases, '0.2.0.shots', 'links-1.png')
    )
    const h = await handlers()
    expect(
      await h.read({ project: 'demo', version: '0.2.0', rel: 'releases/0.2.0.shots/links-1.png' })
    ).toBeNull()
  })

  test('a shots folder that is a symlink out of the root is not read through', async () => {
    await writeFile(path.join(outside, 'links-1.png'), 'secret')
    await symlink(outside, path.join(releases, '0.2.0.shots'))
    const h = await handlers()
    expect(
      await h.read({ project: 'demo', version: '0.2.0', rel: 'releases/0.2.0.shots/links-1.png' })
    ).toBeNull()
  })
})
