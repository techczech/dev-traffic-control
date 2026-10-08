import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { buildRelaunchPrompt, readHandoffFile, scanHandoffs } from '../handoffs'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'dtc-handoffs-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeHandoff(
  root: string,
  project: string,
  file: string,
  content = '# Resume example\n'
): Promise<string> {
  const handoffPath = path.join(root, project, 'handoffs', file)
  await mkdir(path.dirname(handoffPath), { recursive: true })
  await writeFile(handoffPath, content)
  return handoffPath
}

function statePathFor(handoffPath: string): string {
  return handoffPath.replace(/\.md$/, '.state.json')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('handoffs', () => {
  test('a synthetic handoff with no frontmatter keeps the required fallback path', async () => {
    const root = await temporaryDirectory()
    const file = await writeHandoff(
      root,
      'rivermill',
      '2026-01-28-harbour-reading-pane-handoff.md',
      '# Harbour — handoff: finish the reading pane\n'
    )

    const handoff = await readHandoffFile(file, new Date('2026-07-30T12:00:00.000Z'))

    expect(handoff.title).toBe('Harbour — handoff: finish the reading pane')
    expect(handoff.project).toBe('rivermill')
    expect(handoff.domain).toBe('rivermill')
    expect(handoff.repo).toBeUndefined()
    expect(handoff.updated).not.toBe('')
    expect(handoff.frontmatterMalformed).toBe(false)
  })

  test('README.md, AGENTS.md and CLAUDE.md in a handoff folder are never listed', async () => {
    const root = await temporaryDirectory()
    const directory = path.join(root, 'dev-traffic-control', 'handoffs')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'README.md'), '# Handoffs')
    await writeFile(path.join(directory, 'AGENTS.md'), '# Contract')
    await writeFile(path.join(directory, 'CLAUDE.md'), '@AGENTS.md')
    await writeFile(path.join(directory, '2026-07-30-example-handoff.md'), '# Resume example')

    const result = await scanHandoffs(root, new Date('2026-07-30T12:00:00.000Z'))

    expect(result.rootMissing).toBe(false)
    expect(result.handoffs.map((handoff) => handoff.file)).toEqual([
      '2026-07-30-example-handoff.md'
    ])
  })

  test('finds a handoff in _unfiled/handoffs', async () => {
    const root = await temporaryDirectory()
    await writeHandoff(root, '_unfiled', '2026-07-30-unfiled-handoff.md')

    const result = await scanHandoffs(root, new Date('2026-07-30T12:00:00.000Z'))

    expect(result.handoffs).toHaveLength(1)
    expect(result.handoffs[0]).toMatchObject({
      project: '_unfiled',
      file: '2026-07-30-unfiled-handoff.md'
    })
  })

  test('parses declared frontmatter without guessing omitted fields', async () => {
    const root = await temporaryDirectory()
    const file = await writeHandoff(
      root,
      'dev-traffic-control',
      '2026-07-30-declared-handoff.md',
      `---
title: Declared handoff
domain: utilities
repo: apps/example-app
project: wrong-project
move: agent
state: superseded
updated: 2026-07-20
resume: Read the release specification.
---
# Body title is not the row title
`
    )

    const handoff = await readHandoffFile(file, new Date('2026-07-30T12:00:00.000Z'))

    expect(handoff).toMatchObject({
      title: 'Declared handoff',
      domain: 'utilities',
      repo: 'apps/example-app',
      project: 'dev-traffic-control',
      move: 'agent',
      state: 'superseded',
      updated: '2026-07-20',
      resume: 'Read the release specification.',
      ageDays: 10,
      stale: true,
      frontmatterMalformed: false
    })
  })

  test('skips a handoffs folder symlinked outside the record root and still reads a real one', async () => {
    const parent = await temporaryDirectory()
    const root = path.join(parent, 'record')
    const outside = path.join(parent, 'elsewhere')
    const real = await writeHandoff(root, 'real', '2026-09-28-real-handoff.md', '# Real\n')
    await writeHandoff(outside, 'planted', '2026-09-28-outside-handoff.md', '# Outside\n')
    await mkdir(path.join(root, 'linked'))
    await symlink(path.join(outside, 'planted', 'handoffs'), path.join(root, 'linked', 'handoffs'))

    const result = await scanHandoffs(root, new Date('2026-09-28T12:00:00.000Z'))

    expect(result.handoffs.map((handoff) => handoff.path)).toEqual([real])
  })

  test('a missing record folder is reported separately from an empty folder', async () => {
    const parent = await temporaryDirectory()
    const missing = path.join(parent, 'missing')

    expect(await scanHandoffs(missing)).toEqual({
      root: missing,
      rootMissing: true,
      handoffs: []
    })

    const empty = path.join(parent, 'empty')
    await mkdir(empty)
    expect(await scanHandoffs(empty)).toEqual({
      root: empty,
      rootMissing: false,
      handoffs: []
    })
  })

  test('builds the exact three-line prompt with and without a repo', async () => {
    const root = await temporaryDirectory()
    for (const [file, repo] of [
      ['2026-07-29-with-repo-handoff.md', 'apps/example-app'],
      ['2026-07-29-without-repo-handoff.md', undefined]
    ] as const) {
      const handoffPath = await writeHandoff(
        root,
        'dev-traffic-control',
        file,
        `---
title: Dev Traffic Control features board
${repo ? `repo: ${repo}\n` : ''}---
# Body
`
      )
      const handoff = await readHandoffFile(handoffPath)

      expect(handoff.relaunchPrompt).toBe(
        `Continue the Dev Traffic Control features board thread.\n\nRead ${root}/dev-traffic-control/handoffs/${file} and pick up from where it leaves off.`
      )
    }
  })

  test('the copy prompt names the chosen records folder, home shortened to ~', async () => {
    const root = path.join(homedir(), 'Documents', 'Dev Traffic Control')
    expect(buildRelaunchPrompt('Board', 'proj', 'h.md', root)).toBe(
      'Continue the Board thread.\n\nRead ~/Documents/Dev Traffic Control/proj/handoffs/h.md and pick up from where it leaves off.'
    )
    expect(buildRelaunchPrompt('Board', 'proj', 'h.md', '/srv/records')).toContain(
      'Read /srv/records/proj/handoffs/h.md '
    )
  })

  test('an absent sidecar exposes never-picked-up history', async () => {
    const root = await temporaryDirectory()
    const file = await writeHandoff(root, 'rivermill', '2026-07-30-absent-handoff.md')

    const handoff = await readHandoffFile(file)

    expect(handoff.sidecar).toEqual({ pickedUpAt: null, archivedAt: null })
    expect(handoff.history).toEqual({ kind: 'never-picked-up' })
  })

  test('a picked-up sidecar exposes its picked-up history', async () => {
    const root = await temporaryDirectory()
    const file = await writeHandoff(root, 'rivermill', '2026-07-30-picked-up-handoff.md')
    const pickedUpAt = '2026-07-30T09:12:00.000Z'
    await writeFile(statePathFor(file), JSON.stringify({ pickedUpAt, archivedAt: null }))

    const handoff = await readHandoffFile(file)

    expect(handoff.sidecar).toEqual({ pickedUpAt, archivedAt: null })
    expect(handoff.history).toEqual({ kind: 'picked-up', at: pickedUpAt })
  })

  test('an archived sidecar exposes its archived history', async () => {
    const root = await temporaryDirectory()
    const file = await writeHandoff(root, 'rivermill', '2026-07-30-archived-handoff.md')
    const pickedUpAt = '2026-07-30T09:12:00.000Z'
    const archivedAt = '2026-07-30T11:20:00.000Z'
    await writeFile(statePathFor(file), JSON.stringify({ pickedUpAt, archivedAt }))

    const handoff = await readHandoffFile(file)

    expect(handoff.sidecar).toEqual({ pickedUpAt, archivedAt })
    expect(handoff.history).toEqual({ kind: 'archived', at: archivedAt })
  })

  test('a malformed sidecar degrades to never-picked-up history without throwing', async () => {
    const root = await temporaryDirectory()
    const file = await writeHandoff(root, 'rivermill', '2026-07-30-malformed-handoff.md')
    await writeFile(statePathFor(file), '{ not valid JSON')

    await expect(readHandoffFile(file)).resolves.toMatchObject({
      sidecar: { pickedUpAt: null, archivedAt: null },
      history: { kind: 'never-picked-up' }
    })
  })
})
