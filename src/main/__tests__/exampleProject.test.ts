import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  examplePresent,
  openExample,
  removeExample
} from '../exampleProject'
import { createExampleHandlers } from '../exampleIpc'
import { EXAMPLE_MARKER, EXAMPLE_SLUG } from '../../shared/example'
import { scanQaRepo } from '../qa/scan'
import { scanHandoffs } from '../qa/handoffs'

const BUNDLE = path.resolve(__dirname, '../../../resources/example-app')

let parent: string
let root: string
let outside: string

beforeEach(async () => {
  parent = realpathSync(await mkdtemp(path.join(tmpdir(), 'dtc-example-')))
  root = path.join(parent, 'records')
  outside = path.join(parent, 'elsewhere')
  await mkdir(root)
  await mkdir(outside)
  await writeFile(path.join(outside, 'keep.txt'), 'mine')
})

async function tree(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name)
    out.push(rel)
    if (entry.isDirectory()) out.push(...(await tree(path.join(dir, entry.name), rel)))
  }
  return out.sort()
}

describe('the bundled example project', () => {
  test('holds one light check request, one doc-review with option pictures and one handoff', async () => {
    await openExample(root, BUNDLE)
    const scan = await scanQaRepo(root)
    const runs = scan.runs.filter((run) => run.project === EXAMPLE_SLUG)
    expect(runs).toHaveLength(2)
    const review = runs.find((run) => run.request.labels.kind === 'doc-review')
    const check = runs.find((run) => run.request.labels.kind !== 'doc-review')
    expect(check?.request.mode).toBe('light')
    expect(check?.request.items).toHaveLength(4)
    const body = review?.request.document?.bodyMarkdown ?? ''
    expect(body).toMatch(/- A: .*!\[\]\(sign-in-layout-a\.svg\)/)
    expect(body).toMatch(/- B: .*!\[\]\(sign-in-layout-b\.svg\)/)
    const handoffs = (await scanHandoffs(root)).handoffs.filter((h) => h.project === EXAMPLE_SLUG)
    expect(handoffs.map((h) => [h.title, h.move, h.state])).toEqual([
      ['Continue: password reset email', 'agent', 'live']
    ])
  })

  test('names no real project, path or person', async () => {
    for (const rel of await tree(BUNDLE)) {
      const full = path.join(BUNDLE, rel)
      if ((await lstat(full)).isDirectory()) continue
      const text = await readFile(full, 'utf8')
      expect(text).not.toMatch(
        /dominik|projects|_REC|\/Users\/|techczech|wordforge|redforge|tallyboard/i
      )
    }
  })
})

describe('opening the example writes only <root>/example-app', () => {
  test('copies the bundle and a marker into a new example-app folder', async () => {
    expect(await openExample(root, BUNDLE)).toEqual({ kind: 'installed', slug: EXAMPLE_SLUG })
    const target = path.join(root, EXAMPLE_SLUG)
    expect(await tree(target)).toEqual([EXAMPLE_MARKER, ...(await tree(BUNDLE))].sort())
    expect(await readdir(root)).toEqual([EXAMPLE_SLUG])
    expect(await examplePresent(root)).toBe(true)
  })

  test('an example already there is opened again without writing', async () => {
    await openExample(root, BUNDLE)
    const marker = path.join(root, EXAMPLE_SLUG, EXAMPLE_MARKER)
    const before = (await lstat(marker)).mtimeMs
    expect(await openExample(root, BUNDLE)).toEqual({ kind: 'present', slug: EXAMPLE_SLUG })
    expect((await lstat(marker)).mtimeMs).toBe(before)
  })

  test('an existing folder of the same name is refused and left untouched', async () => {
    const own = path.join(root, EXAMPLE_SLUG)
    await mkdir(own)
    await writeFile(path.join(own, 'notes.md'), 'mine')
    expect(await openExample(root, BUNDLE)).toEqual({ kind: 'refused', reason: 'folder-exists' })
    expect(await readdir(own)).toEqual(['notes.md'])
    expect(await examplePresent(root)).toBe(false)
  })

  test('a symlinked example-app pointing outside the root is refused, nothing written through it', async () => {
    await symlink(outside, path.join(root, EXAMPLE_SLUG))
    expect(await openExample(root, BUNDLE)).toEqual({ kind: 'refused', reason: 'folder-exists' })
    expect(await readdir(outside)).toEqual(['keep.txt'])
  })

  test('a dangling symlink at example-app is refused', async () => {
    await symlink(path.join(outside, 'not-yet'), path.join(root, EXAMPLE_SLUG))
    expect(await openExample(root, BUNDLE)).toEqual({ kind: 'refused', reason: 'folder-exists' })
    expect(await readdir(outside)).toEqual(['keep.txt'])
  })

  test('a plain file named example-app is refused', async () => {
    await writeFile(path.join(root, EXAMPLE_SLUG), 'x')
    expect(await openExample(root, BUNDLE)).toEqual({ kind: 'refused', reason: 'folder-exists' })
  })

  test('a missing record root is refused and nothing is created', async () => {
    const missing = path.join(parent, 'no-such-root')
    expect(await openExample(missing, BUNDLE)).toEqual({ kind: 'refused', reason: 'no-root' })
    expect(await readdir(parent)).toEqual(['elsewhere', 'records'])
  })

  test('a record root that is itself a symlink writes into its real folder only', async () => {
    const linkedRoot = path.join(parent, 'linked-records')
    await symlink(root, linkedRoot)
    expect((await openExample(linkedRoot, BUNDLE)).kind).toBe('installed')
    expect(await readdir(root)).toEqual([EXAMPLE_SLUG])
  })

  test('a missing bundle is refused and leaves no folder behind', async () => {
    expect(await openExample(root, path.join(parent, 'no-bundle'))).toEqual({
      kind: 'refused',
      reason: 'no-source'
    })
    expect(await readdir(root)).toEqual([])
  })

  test('symlinks and dot files in the bundle are not copied', async () => {
    const bundle = path.join(parent, 'bundle')
    await mkdir(bundle)
    await writeFile(path.join(bundle, 'request.md'), '# A request')
    await writeFile(path.join(bundle, '.DS_Store'), 'x')
    await symlink(path.join(outside, 'keep.txt'), path.join(bundle, 'leak.md'))
    await openExample(root, bundle)
    expect(await readdir(path.join(root, EXAMPLE_SLUG))).toEqual(
      [EXAMPLE_MARKER, 'request.md'].sort()
    )
  })
})

describe('removing the example deletes only a marked example-app folder', () => {
  test('removes the example it installed, and nothing else in the root', async () => {
    await mkdir(path.join(root, 'my-app'))
    await openExample(root, BUNDLE)
    expect(await removeExample(root)).toEqual({ kind: 'removed' })
    expect(await readdir(root)).toEqual(['my-app'])
    expect(await examplePresent(root)).toBe(false)
  })

  test('a folder without the marker is refused and kept', async () => {
    const own = path.join(root, EXAMPLE_SLUG)
    await mkdir(own)
    await writeFile(path.join(own, 'notes.md'), 'mine')
    expect(await removeExample(root)).toEqual({ kind: 'refused', reason: 'not-example' })
    expect(await readdir(own)).toEqual(['notes.md'])
  })

  test('a marker with the wrong content, or a symlinked marker, is refused', async () => {
    const own = path.join(root, EXAMPLE_SLUG)
    await mkdir(own)
    await writeFile(path.join(own, EXAMPLE_MARKER), '{"example":"something-else"}')
    expect(await removeExample(root)).toEqual({ kind: 'refused', reason: 'not-example' })

    const real = path.join(outside, 'marker.json')
    await writeFile(real, '{"example":"dev-traffic-control"}')
    await unlink(path.join(own, EXAMPLE_MARKER))
    await symlink(real, path.join(own, EXAMPLE_MARKER))
    expect(await removeExample(root)).toEqual({ kind: 'refused', reason: 'not-example' })
    expect(await readdir(own)).toEqual([EXAMPLE_MARKER])
  })

  test('a symlinked example-app pointing at a marked folder outside the root is refused', async () => {
    const elsewhere = path.join(outside, 'example-app')
    await openExample(outside, BUNDLE)
    await symlink(elsewhere, path.join(root, EXAMPLE_SLUG))
    expect(await removeExample(root)).toEqual({ kind: 'refused', reason: 'not-example' })
    expect(await examplePresent(outside)).toBe(true)
  })

  test('nothing to remove is refused', async () => {
    expect(await removeExample(root)).toEqual({ kind: 'refused', reason: 'absent' })
    expect(await removeExample(path.join(parent, 'no-such-root'))).toEqual({
      kind: 'refused',
      reason: 'no-root'
    })
  })

  test('symlinks inside the example are removed, never followed', async () => {
    await openExample(root, BUNDLE)
    await symlink(outside, path.join(root, EXAMPLE_SLUG, 'planted'))
    expect(await removeExample(root)).toEqual({ kind: 'removed' })
    expect(await readdir(outside)).toEqual(['keep.txt'])
  })
})

describe('example IPC handlers', () => {
  test('rescan after a write, not after a refusal; the renderer names no path', async () => {
    const refresh = vi.fn(async () => undefined)
    const handlers = createExampleHandlers({
      recordRoot: () => root,
      sourceDir: () => BUNDLE,
      refresh
    })
    expect(await handlers.present()).toBe(false)
    expect((await handlers.open()).kind).toBe('installed')
    expect((await handlers.open()).kind).toBe('present')
    expect(await handlers.present()).toBe(true)
    expect((await handlers.remove()).kind).toBe('removed')
    expect((await handlers.remove()).kind).toBe('refused')
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(handlers.open.length + handlers.remove.length).toBe(0)
  })

  test('copies a binary file byte for byte', async () => {
    const source = path.join(parent, 'bundle')
    await mkdir(source)
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0xc3, 0x28, 0x80])
    await writeFile(path.join(source, 'picture.png'), bytes)
    expect(await openExample(root, source)).toEqual({ kind: 'installed', slug: EXAMPLE_SLUG })
    const copied = await readFile(path.join(root, EXAMPLE_SLUG, 'picture.png'))
    expect(Buffer.compare(copied, bytes)).toBe(0)
  })
})
