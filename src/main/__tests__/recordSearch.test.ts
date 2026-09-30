import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readRecordFiles, searchRecordBodies } from '../recordSearch'

const temporaryDirectories: string[] = []

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('record body search', () => {
  test('returns body hits with file, line, snippet and kind while ignoring frontmatter titles', async () => {
    const root = await temporaryDirectory('dtc-search-')
    const project = path.join(root, 'project')
    const threads = path.join(project, 'threads')
    const handoffs = path.join(project, 'handoffs')
    await mkdir(threads, { recursive: true })
    await mkdir(handoffs)
    await writeFile(
      path.join(project, '2026-08-01-request.md'),
      '---\ntitle: needle only in title\n---\n# Request\nThe body has a needle here.\n'
    )
    await writeFile(
      path.join(project, '2026-08-01-note-observation.md'),
      '---\ntitle: Observation\n---\nA note needle lives here.\n'
    )
    await writeFile(
      path.join(threads, '2026-08-01-entry.md'),
      '---\nthread: search-thread\n---\nAn entry needle lives here.\n'
    )
    await writeFile(path.join(handoffs, 'handoff.md'), 'A handoff needle is not in scope.\n')
    await writeFile(path.join(root, 'maps.md'), 'A root registry needle is not in scope.\n')

    const result = await searchRecordBodies(root, 'needle', 20)

    expect(result.total).toBe(3)
    expect(result.capped).toBe(false)
    expect(new Set(result.hits.map((hit) => hit.kind))).toEqual(
      new Set(['request', 'note', 'entry'])
    )
    const request = result.hits.find((hit) => hit.kind === 'request')
    expect(request).toMatchObject({ line: 5, project: 'project' })
    expect(request?.file).toBe(await realpath(path.join(project, '2026-08-01-request.md')))
    expect(request?.snippet).toContain('body has a needle')
    expect(result.hits.every((hit) => hit.thread !== 'search-thread' || hit.kind === 'entry')).toBe(
      true
    )
  })

  test('does not return a symlinked file outside the record root', async () => {
    const root = await temporaryDirectory('dtc-search-root-')
    const outside = await temporaryDirectory('dtc-search-outside-')
    const project = path.join(root, 'project')
    await mkdir(project)
    const secret = path.join(outside, '2026-08-01-note-secret.md')
    await writeFile(secret, 'The forbidden needle is outside.\n')
    await symlink(secret, path.join(project, '2026-08-01-note-linked.md'))

    const result = await searchRecordBodies(root, 'needle', 20)
    expect(result.hits).toEqual([])
    await expect(
      readRecordFiles(root, [path.join(root, '..', path.basename(outside), path.basename(secret))])
    ).rejects.toThrow('outside the record root')
  })

  test('reports cap behaviour without losing the total match count', async () => {
    const root = await temporaryDirectory('dtc-search-cap-')
    const project = path.join(root, 'project')
    await mkdir(project)
    await writeFile(
      path.join(project, '2026-08-01-request.md'),
      '---\ntitle: Many\n---\nneedle one\nneedle two\nneedle three\n'
    )

    const result = await searchRecordBodies(root, 'needle', 2)
    expect(result.hits).toHaveLength(2)
    expect(result.total).toBe(3)
    expect(result.files).toBe(1)
    expect(result.cap).toBe(2)
    expect(result.capped).toBe(true)
  })
})
