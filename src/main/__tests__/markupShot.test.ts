import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { confineRequestPath } from '../requestPath'
import { storeShot } from '../runnerIo'

// The marked-up copy of a picture is written through the same
// confined screenshot path as a pasted screenshot (the addShot handler in
// index.ts: confineRequestPath, then storeShot). No new write handler exists;
// these tests pin that path's refusals for the marked-up copy.

const REVIEW = `---
id: review
title: A review
kind: doc-review
---

## Section

\`\`\`decision {#pick}
Which?
- A ![](review.images/a.png)
- B
\`\`\`
`

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(): Promise<{
  parent: string
  root: string
  request: string
  original: string
  outside: string
}> {
  const parent = await mkdtemp(path.join(tmpdir(), 'dtc-markup-shot-'))
  dirs.push(parent)
  const root = path.join(parent, 'records')
  const request = path.join(root, 'playground', '2026-09-29-review.md')
  const original = path.join(root, 'playground', 'review.images', 'a.png')
  const outside = path.join(parent, 'outside')
  await mkdir(path.dirname(original), { recursive: true })
  await mkdir(outside)
  await writeFile(request, REVIEW)
  await writeFile(original, Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]))
  return { parent, root, request, original, outside }
}

/** What the addShot handler does with a renderer-supplied request path. */
async function addShot(
  root: string,
  scanned: string[],
  supplied: string,
  png: Buffer
): Promise<string> {
  return storeShot(root, await confineRequestPath(root, scanned, supplied), 'document', png)
}

const MARKED = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

describe('writing a marked-up copy', () => {
  test('lands in the request’s .shots folder and leaves the original byte-identical', async () => {
    const { root, request, original } = await fixture()
    const before = await readFile(original)
    const rel = await addShot(root, [request], request, MARKED)
    expect(rel).toBe(path.join('2026-09-29-review.shots', 'document-1.png'))
    expect(await readFile(path.join(path.dirname(request), rel))).toEqual(MARKED)
    expect(await readFile(original)).toEqual(before)
  })

  test('a request path outside the record root is refused and nothing is written', async () => {
    const { root, request, outside } = await fixture()
    const stray = path.join(outside, '2026-09-29-review.md')
    await writeFile(stray, REVIEW)
    await expect(addShot(root, [request, stray], stray, MARKED)).rejects.toThrow(
      /outside the record root/
    )
    await expect(
      addShot(root, [request], '../outside/2026-09-29-review.md', MARKED)
    ).rejects.toThrow()
    expect(await readdir(outside)).toEqual(['2026-09-29-review.md'])
  })

  test('a planted symlinked .shots folder is refused and its target stays empty', async () => {
    const { root, request, outside } = await fixture()
    await symlink(outside, request.replace(/\.md$/, '.shots'))
    await expect(addShot(root, [request], request, MARKED)).rejects.toThrow(
      /outside the record root/
    )
    expect(await readdir(outside)).toEqual([])
  })

  test('a symlink planted at the next file name is never followed', async () => {
    const { root, request, outside } = await fixture()
    const shots = request.replace(/\.md$/, '.shots')
    await mkdir(shots)
    const victim = path.join(outside, 'victim.png')
    await writeFile(victim, 'keep me')
    await symlink(victim, path.join(shots, 'document-1.png'))
    const rel = await addShot(root, [request], request, MARKED)
    expect(rel).toBe(path.join('2026-09-29-review.shots', 'document-2.png'))
    expect(await readFile(victim, 'utf8')).toBe('keep me')
  })
})
