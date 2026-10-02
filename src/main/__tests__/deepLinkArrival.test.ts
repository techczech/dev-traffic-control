import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  landingForArrival,
  resolveDeepLinkArrival,
  type DeepLinkArrival,
  type LandingRecords
} from '../deepLinkResolve'
import { confineRecordPath } from '../requestPath'

/**
 * Both gates end to end, against a real record tree: the grammar in shared,
 * then confinement in main. Ticket 40 widened what opens — verb-less links and
 * a missing `.md` — and these cases pin that the widening happens INSIDE the
 * gates, never around them.
 */
async function fixture(): Promise<{ root: string; parent: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), 'dtc-arrival-'))
  const root = path.join(parent, '_REC')
  await mkdir(path.join(root, 'example-app'), { recursive: true })
  await mkdir(path.join(root, 'example-app'), { recursive: true })
  await writeFile(
    path.join(root, 'example-app', '2026-01-15-review-sign-in-journeys.md'),
    '# Review\n'
  )
  await writeFile(
    path.join(root, 'example-app', '2026-01-15-example-app-0.4.0-preview.2-check.md'),
    '# Check\n'
  )
  await writeFile(
    path.join(root, 'example-app', '2026-01-16-review-export-directions.md'),
    '# Review\n'
  )
  await writeFile(path.join(parent, 'secret.md'), '# Outside\n')
  await writeFile(path.join(parent, 'x'), 'outside\n')
  await writeFile(path.join(parent, 'x.md'), '# Outside\n')
  return { root, parent }
}

const arrive = (url: string, recordRoot: string): Promise<DeepLinkArrival> =>
  resolveDeepLinkArrival(url, { recordRoot })

describe('the verb-less links from the survey open', () => {
  test.each([
    [
      'dtc://example-app/2026-01-15-review-sign-in-journeys',
      'example-app/2026-01-15-review-sign-in-journeys.md'
    ],
    [
      'dtc://example-app/2026-01-15-example-app-0.4.0-preview.2-check',
      'example-app/2026-01-15-example-app-0.4.0-preview.2-check.md'
    ],
    [
      'dtc://example-app/2026-01-16-review-export-directions.md',
      'example-app/2026-01-16-review-export-directions.md'
    ]
  ])('%s', async (url, relative) => {
    const { root } = await fixture()
    const arrival = await arrive(url, root)
    expect(arrival).toEqual({
      kind: 'record',
      project: relative.split('/')[0],
      relative,
      path: path.join(await realpath(root), relative)
    })
  })

  test('and land on the request itself once it is scanned', async () => {
    const { root } = await fixture()
    const url = 'dtc://example-app/2026-01-15-example-app-0.4.0-preview.2-check'
    const scanned = path.join(
      root,
      'example-app',
      '2026-01-15-example-app-0.4.0-preview.2-check.md'
    )
    const records: LandingRecords = {
      recordRoot: root,
      runPaths: [scanned],
      notePaths: [],
      threadIds: []
    }
    expect(landingForArrival(await arrive(url, root), url, false, records)).toMatchObject({
      kind: 'opened',
      view: { kind: 'runner', path: scanned }
    })
  })
})

describe('a missing .md', () => {
  test('resolves to <path>.md only when that file exists inside the root', async () => {
    const { root } = await fixture()
    await expect(
      arrive('dtc://open/example-app/2026-01-16-review-export-directions', root)
    ).resolves.toMatchObject({
      kind: 'record',
      relative: 'example-app/2026-01-16-review-export-directions.md'
    })
  })

  test('with no <path>.md either, it is sync lag, not a refusal', async () => {
    const { root } = await fixture()
    await expect(arrive('dtc://example-app/2026-10-02-not-synced', root)).resolves.toEqual({
      kind: 'behind',
      project: 'example-app'
    })
  })

  test('tries .md and no other extension', async () => {
    const { root } = await fixture()
    await writeFile(path.join(root, 'example-app', 'notes.txt'), 'text\n')
    await writeFile(path.join(root, 'example-app', 'notes.markdown'), 'text\n')
    const confine = vi.fn(confineRecordPath)
    await expect(
      resolveDeepLinkArrival('dtc://example-app/notes', { recordRoot: root, confine })
    ).resolves.toMatchObject({ kind: 'behind' })
    expect(confine.mock.calls.map((call) => call[1])).toEqual([
      'example-app/notes',
      'example-app/notes.md'
    ])
  })

  test('a missing x.md is never retried as x.md.md', async () => {
    const { root } = await fixture()
    const confine = vi.fn(confineRecordPath)
    await expect(
      resolveDeepLinkArrival('dtc://example-app/x.md', { recordRoot: root, confine })
    ).resolves.toMatchObject({ kind: 'behind' })
    expect(confine.mock.calls.map((call) => call[1])).toEqual(['example-app/x.md'])
  })

  test('an existing file is opened as named, and .md is never appended to it', async () => {
    const { root } = await fixture()
    await writeFile(path.join(root, 'example-app', 'plain'), 'no extension\n')
    await writeFile(path.join(root, 'example-app', 'plain.md'), '# Other\n')
    await expect(arrive('dtc://example-app/plain', root)).resolves.toMatchObject({
      kind: 'record',
      relative: 'example-app/plain'
    })
  })

  test('a <path>.md that is a symlink out of the root is refused, never read', async () => {
    const { root, parent } = await fixture()
    await symlink(path.join(parent, 'secret.md'), path.join(root, 'example-app', 'escape.md'))
    await expect(arrive('dtc://example-app/escape', root)).resolves.toEqual({ kind: 'refused' })
    await expect(arrive('dtc://open/example-app/escape', root)).resolves.toEqual({
      kind: 'refused'
    })
  })

  test('a <path>.md under a symlinked folder out of the root is refused', async () => {
    const { root, parent } = await fixture()
    await mkdir(path.join(parent, 'elsewhere'), { recursive: true })
    await writeFile(path.join(parent, 'elsewhere', 'loot.md'), '# Outside\n')
    await symlink(path.join(parent, 'elsewhere'), path.join(root, 'example-app', 'out'), 'dir')
    await expect(arrive('dtc://example-app/out/loot', root)).resolves.toEqual({ kind: 'refused' })
  })

  test('applies to open links only, never to project or thread', async () => {
    const { root } = await fixture()
    await writeFile(path.join(root, 'newproj.md'), '# Not a project\n')
    const confine = vi.fn(confineRecordPath)
    await expect(
      resolveDeepLinkArrival('dtc://project/newproj', { recordRoot: root, confine })
    ).resolves.toMatchObject({ kind: 'behind' })
    expect(confine).toHaveBeenCalledTimes(1)
  })
})

describe('traversal stays refused, end to end', () => {
  test.each([
    'dtc://open/../../../../Users/someone/.ssh/id_ed25519',
    'dtc://open/dev-traffic-control/../../x',
    'dtc://open/%2e%2e/%2e%2e/%2e%2e/%2e%2e/Users/someone/.ssh/id_ed25519',
    'dtc://open/dev-traffic-control/%2e%2e/%2e%2e/x',
    'dtc://open/dev-traffic-control/..%2f..%2fx',
    'dtc://open/dev-traffic-control/%2E%2E%2F%2E%2E%2Fx',
    'dtc://example-app/../x',
    'dtc://example-app/../secret',
    'dtc://example-app/%2e%2e/x',
    'dtc://example-app/..%2fx',
    'dtc://%2e%2e/x',
    'dtc://../secret',
    'dtc:///etc/passwd'
  ])('%s', async (url) => {
    const { root } = await fixture()
    const confine = vi.fn(confineRecordPath)
    await expect(resolveDeepLinkArrival(url, { recordRoot: root, confine })).resolves.toEqual({
      kind: 'refused'
    })
    // Refused by the grammar: no path ever reached the filesystem.
    expect(confine).not.toHaveBeenCalled()
  })

  test('a refused link lands refused, carrying the string as it arrived and nothing else', async () => {
    const { root } = await fixture()
    const url = 'dtc://example-app/../x'
    const records: LandingRecords = { recordRoot: root, runPaths: [], notePaths: [], threadIds: [] }
    expect(landingForArrival(await arrive(url, root), url, true, records)).toEqual({
      kind: 'refused',
      url,
      coldLaunch: true
    })
  })
})
