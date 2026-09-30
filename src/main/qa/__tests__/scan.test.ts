import { describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { noteTitle, scanQaRepo } from '../scan'
import { hostname } from 'node:os'

const REQ = `---
id: t1
title: T1
---
## A
**Steps**
- s
**Expected**
- e
`

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-repo-'))
  await mkdir(path.join(root, 'tallyboard/0.18-title-slides'), { recursive: true })
  await mkdir(path.join(root, 'pebbles'), { recursive: true })
  await mkdir(path.join(root, '.git'), { recursive: true })
  await writeFile(path.join(root, 'AGENTS.md'), 'contract')
  await writeFile(path.join(root, 'tallyboard/AGENTS.md'), 'ptr')
  await writeFile(path.join(root, 'tallyboard/0.18-title-slides/2026-07-18-padding.md'), REQ)
  await writeFile(path.join(root, 'tallyboard/2026-07-17-root-level.md'), REQ)
  await writeFile(
    path.join(root, 'tallyboard/2026-07-18-note-ideas.md'),
    '---\ntitle: Ideas\nhandedOverAt: 2026-07-18T10:00:00Z\n---\nbody'
  )
  await writeFile(path.join(root, 'pebbles/2026-07-16-smoke.md'), REQ)
  await writeFile(
    path.join(root, 'pebbles/2026-07-16-smoke.report.json'),
    JSON.stringify({
      id: 't1',
      title: 'T1',
      startedAt: 'x',
      completedAt: 'y',
      noteFiles: [],
      items: []
    })
  )
  return root
}

describe('scanQaRepo', () => {
  test('finds projects, rounds, root-level runs; skips dotdirs and AGENTS files', async () => {
    const { runs, projects } = await scanQaRepo(await fixture())
    expect(projects.sort()).toEqual(['pebbles', 'tallyboard'])
    const tw = runs.filter((r) => r.project === 'tallyboard')
    expect(tw).toHaveLength(2)
    expect(tw.find((r) => r.round === '0.18-title-slides')).toBeTruthy()
    expect(tw.find((r) => r.round === null)).toBeTruthy()
  })

  test('releases is reserved and never scanned as a round folder', async () => {
    const root = await fixture()
    const releases = path.join(root, 'tallyboard', 'releases')
    await mkdir(releases)
    await writeFile(path.join(releases, '0.11.0.md'), REQ)

    const { runs } = await scanQaRepo(root)

    expect(runs.some((run) => run.round === 'releases')).toBe(false)
  })

  test('handoffs is reserved, never returned as a request, and never treated as a round', async () => {
    const root = await fixture()
    const handoffs = path.join(root, 'tallyboard', 'handoffs')
    const handoffPath = path.join(handoffs, '2026-07-30-resume-handoff.md')
    await mkdir(handoffs)
    await writeFile(handoffPath, REQ)

    const { runs } = await scanQaRepo(root)

    expect(runs.some((run) => run.request.path === handoffPath)).toBe(false)
    expect(runs.some((run) => run.round === 'handoffs')).toBe(false)
  })

  test('roadmap is reserved, never returned as a request, and never treated as a round', async () => {
    const root = await fixture()
    const roadmap = path.join(root, 'tallyboard', 'roadmap')
    const ideaPath = path.join(roadmap, 'live-board.md')
    await mkdir(roadmap)
    await writeFile(ideaPath, REQ)

    const { runs } = await scanQaRepo(root)

    expect(runs.some((run) => run.request.path === ideaPath)).toBe(false)
    expect(runs.some((run) => run.round === 'roadmap')).toBe(false)
  })

  test('derives statuses from reports', async () => {
    const { runs } = await scanQaRepo(await fixture())
    expect(runs.find((r) => r.project === 'pebbles')?.status).toBe('done')
    expect(runs.find((r) => r.round === '0.18-title-slides')?.status).toBe('waiting')
  })

  test('carries each request file mtime into its run reference', async () => {
    const root = await fixture()
    const requestPath = path.join(root, 'tallyboard/2026-07-17-root-level.md')
    const writtenAt = new Date('2026-07-27T10:23:00.000Z')
    await utimes(requestPath, writtenAt, writtenAt)

    const { runs } = await scanQaRepo(root)
    const run = runs.find((candidate) => candidate.request.path === requestPath)

    expect(run?.requestMtime).toBe(writtenAt.toISOString())
  })

  test('reads valid local watch and collection signals, ignoring malformed signals', async () => {
    const root = await fixture()
    const requestPath = path.join(root, 'tallyboard/2026-07-17-root-level.md')
    await writeFile(
      requestPath.replace(/\.md$/, '.watch.json'),
      JSON.stringify({
        agent: 'fable',
        machine: hostname(),
        startedAt: '2026-08-03T10:00:00.000Z',
        heartbeatAt: '2026-08-03T10:01:00.000Z'
      })
    )
    await writeFile(
      requestPath.replace(/\.md$/, '.collected.json'),
      JSON.stringify({
        agent: 'fable',
        machine: hostname(),
        collectedAt: '2026-08-03T10:02:00.000Z',
        note: 'Filed in the task log.'
      })
    )
    const run = (await scanQaRepo(root)).runs.find((r) => r.request.path === requestPath)!
    expect(run.watch?.agent).toBe('fable')
    expect(run.collection?.note).toBe('Filed in the task log.')

    await writeFile(
      requestPath.replace(/\.md$/, '.collected.json'),
      JSON.stringify({
        agent: 'fable',
        machine: hostname(),
        collectedAt: '2026-08-03T10:02:00.000Z'
      })
    )
    const withoutNote = (await scanQaRepo(root)).runs.find(
      (candidate) => candidate.request.path === requestPath
    )!
    expect(withoutNote.collection?.agent).toBe('fable')
    expect(withoutNote.collection?.note).toBeUndefined()

    await writeFile(requestPath.replace(/\.md$/, '.watch.json'), '{bad')
    await writeFile(requestPath.replace(/\.md$/, '.collected.json'), '{"agent": 4}')
    const malformed = (await scanQaRepo(root)).runs.find((r) => r.request.path === requestPath)!
    expect(malformed.watch).toBeUndefined()
    expect(malformed.collection).toBeUndefined()
  })

  test('does not scan watch or collection suffixes as requests', async () => {
    const root = await fixture()
    const dir = path.join(root, 'tallyboard')
    await writeFile(path.join(dir, '2026-07-18-not-a-request.watch.json'), '{}')
    await writeFile(path.join(dir, '2026-07-18-not-a-request.collected.json'), '{}')
    const { runs } = await scanQaRepo(root)
    expect(runs.some((run) => run.request.path.includes('not-a-request'))).toBe(false)
  })

  test('notes split out with lifecycle status', async () => {
    const { notes } = await scanQaRepo(await fixture())
    expect(notes).toHaveLength(1)
    expect(notes[0].status).toBe('handed-over')
    expect(notes[0].title).toBe('Ideas')
  })

  test('a .resolved.md marker sets resolvedAt and is never its own run', async () => {
    const root = await fixture()
    await writeFile(
      path.join(root, 'tallyboard/2026-07-17-root-level.resolved.md'),
      '---\nresolved_by: agent\nat: 2026-07-25T09:00:00.000Z\n---\nResolved in chat: Dominik approved the padding.'
    )
    const { runs } = await scanQaRepo(root)
    // The marker is not a run of its own.
    expect(runs.some((r) => r.request.path.endsWith('.resolved.md'))).toBe(false)
    const resolved = runs.find((r) => r.request.path.endsWith('2026-07-17-root-level.md'))
    expect(resolved?.resolvedAt).toBe('2026-07-25T09:00:00.000Z')
    // An unmarked request stays unresolved.
    const other = runs.find((r) => r.round === '0.18-title-slides')
    expect(other?.resolvedAt).toBeUndefined()
  })

  test('a request deleted during collection is skipped without rejecting the scan', async () => {
    const root = await fixture()
    const vanished = path.join(root, 'tallyboard/2026-07-17-root-level.md')
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      const result = await scanQaRepo(root, async (file, encoding) => {
        if (file === vanished) {
          const error = new Error('vanished') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        }
        return readFile(file, encoding)
      })
      expect(result.runs.some((run) => run.request.path === vanished)).toBe(false)
      expect(result.runs.length).toBeGreaterThan(0)
      expect(warnings.some((args) => String(args[0]).includes(vanished))).toBe(true)
    } finally {
      console.warn = originalWarn
    }
  })
})

/**
 * Ticket 05 fix round. Two of Wordforge Desktop's notes carry `title: ""` — the
 * editor's default for a note never named — and the project home drew them as
 * rows with a date and no text.
 */
describe('what a note is called', () => {
  test('its title, when it has one', () => {
    expect(noteTitle('Ideas', 'body', '2026-07-18-note-ideas.md')).toBe('Ideas')
  })

  test('an empty title falls back to the first line that says something', () => {
    const body = '\n\n  not sure whether the ask to replace is a rule  \nsecond line'
    expect(noteTitle('', body, '2026-07-25-note-item.md')).toBe(
      'not sure whether the ask to replace is a rule'
    )
    expect(noteTitle('   ', '## A heading\ntext', 'n.md')).toBe('A heading')
  })

  test('with no title and no text, the file name', () => {
    expect(noteTitle('', '\n  \n', '2026-07-23-note-item.md')).toBe('2026-07-23-note-item')
    expect(noteTitle(undefined, '', '2026-07-23-note-item.md')).toBe('2026-07-23-note-item')
  })

  test('a scanned note with an empty title is listed by its first line', async () => {
    const root = await fixture()
    await writeFile(
      path.join(root, 'pebbles/2026-07-25-note-item.md'),
      '---\ntitle: ""\nhandedOverAt: "2026-07-25T14:56:19.684Z"\n---\n\nit worked the second time\n'
    )
    const { notes } = await scanQaRepo(root)
    expect(notes.find((note) => note.path.endsWith('2026-07-25-note-item.md'))?.title).toBe(
      'it worked the second time'
    )
  })
})
