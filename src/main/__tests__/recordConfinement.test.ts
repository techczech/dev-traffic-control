import { realpathSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createNote, saveNote } from '../noteIo'
import { writeArming } from '../qa/arming'
import { ensureQaRepo } from '../qa/bootstrap'
import { archiveHandoff, readHandoffSidecar, scanHandoffs } from '../qa/handoffs'
import { readProjectRelease, writeReleaseAnswer } from '../qa/releaseRecords'
import { shipRelease } from '../qa/releaseShipping'
import { scanQaRepo } from '../qa/scan'
import { openRun, save, setAsideCorruptReport } from '../runnerIo'

// One rule for every kind of record: a file that is a link, or that sits
// below a linked folder, is neither read nor written, and what it points to
// stays as it was. The roadmap has its own file (qa/__tests__/pool.confinement).

const PROJECT = 'example-app'
const NOW = (): string => '2026-10-08T09:00:00.000Z'
const SECRET = 'outside text that must not be read or changed\n'

const REQUEST = `---
id: check-one
title: Check one
---
## Alpha
**Steps**
- open it
**Expected**
- it opens
`

const LEDGER = `---
app: Example
release: 0.2.0
---

## Links open {#links}
state: you
`

let parent: string
let root: string
let outside: string
let secret: string

beforeEach(async () => {
  parent = realpathSync(await mkdtemp(path.join(tmpdir(), 'dtc-record-confinement-')))
  root = path.join(parent, 'records')
  outside = path.join(parent, 'elsewhere')
  secret = path.join(outside, 'secret.json')
  await mkdir(path.join(root, PROJECT), { recursive: true })
  await mkdir(outside)
  await writeFile(secret, SECRET)
})

afterEach(async () => {
  await rm(parent, { recursive: true, force: true })
})

async function expectOutsideUntouched(expected = ['secret.json']): Promise<void> {
  expect(await readFile(secret, 'utf8')).toBe(SECRET)
  expect((await readdir(outside)).sort()).toEqual(expected)
}

describe('reports and their signal files', () => {
  test('a report that is a link is not read by the scan and not written by a save', async () => {
    const request = path.join(root, PROJECT, '2026-10-08-check-one.md')
    await writeFile(request, REQUEST)
    const report = (await openRun(request, NOW, root)).report
    await writeFile(secret, `${JSON.stringify(report)}\n`)
    const planted = await readFile(secret, 'utf8')
    await symlink(secret, path.join(root, PROJECT, '2026-10-08-check-one.report.json'))
    await symlink(secret, path.join(root, PROJECT, '2026-10-08-check-one.watch.json'))

    const [run] = (await scanQaRepo(root)).runs

    // The link's target is a valid report; it must still not be taken as one.
    expect(run.report).toBeNull()
    expect(run.reportError).toMatch(/Refused/)
    expect(run.watch).toBeUndefined()
    await expect(save(request, report, root)).rejects.toMatchObject({ code: 'ECONFINED' })
    await expect(setAsideCorruptReport(request, NOW, root)).rejects.toMatchObject({
      code: 'ECONFINED'
    })
    expect(await readFile(secret, 'utf8')).toBe(planted)
    expect(await readdir(outside)).toEqual(['secret.json'])
  })

  test('a request below a linked round folder is refused for reads and writes', async () => {
    const realRound = path.join(outside, 'round-1')
    await mkdir(realRound)
    await writeFile(path.join(realRound, '2026-10-08-check-one.md'), REQUEST)
    await symlink(realRound, path.join(root, PROJECT, 'round-1'))
    const request = path.join(root, PROJECT, 'round-1', '2026-10-08-check-one.md')

    await expect(openRun(request, NOW, root)).rejects.toMatchObject({ code: 'ECONFINED' })
    await writeArming(
      {
        path: request.replace(/\.md$/, '.opened.json'),
        body: {
          machine: 'example-machine',
          openedAt: NOW()
        }
      },
      root
    )

    expect((await scanQaRepo(root)).runs).toEqual([])
    expect(await readdir(realRound)).toEqual(['2026-10-08-check-one.md'])
  })
})

describe('release records', () => {
  async function ledgerIn(folder: string): Promise<void> {
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, '0.2.0.md'), LEDGER)
  }

  test('a linked releases folder reads as nothing recorded and takes no answer or shipment', async () => {
    const realReleases = path.join(outside, 'releases')
    await ledgerIn(realReleases)
    await symlink(realReleases, path.join(root, PROJECT, 'releases'))

    expect(await readProjectRelease(root, PROJECT)).toEqual({
      kind: 'nothing-recorded',
      project: PROJECT
    })
    const record = {
      path: path.join(root, PROJECT, 'releases', '0.2.0.md'),
      version: '0.2.0',
      app: 'Example',
      release: '0.2.0',
      features: [
        {
          id: 'links',
          title: 'Links open',
          kind: 'feature' as const,
          declaredState: 'you' as const,
          status: 'you' as const
        }
      ],
      answers: [],
      degraded: false
    }
    await expect(
      writeReleaseAnswer(record, 'links', 'works', '', NOW(), undefined, root)
    ).rejects.toMatchObject({ code: 'ECONFINED' })
    await expect(
      shipRelease({ root, project: PROJECT, record, notes: 'Notes.', shippedAt: NOW() })
    ).rejects.toMatchObject({ code: 'ECONFINED' })
    expect(await readdir(realReleases)).toEqual(['0.2.0.md'])
    // The shipment's roadmap step ran first and stayed inside the records.
    await expectOutsideUntouched(['releases', 'secret.json'])
  })

  test('linked answers and shipped files are not read, and an answer does not replace the link', async () => {
    const releases = path.join(root, PROJECT, 'releases')
    await ledgerIn(releases)
    await writeFile(
      secret,
      JSON.stringify({
        app: 'Example',
        release: '0.2.0',
        shippedAt: NOW(),
        notes: 'outside notes',
        answers: [{ id: 'links', verdict: 'off', comment: 'outside comment', at: NOW() }]
      })
    )
    const planted = await readFile(secret, 'utf8')
    await symlink(secret, path.join(releases, '0.2.0.answers.json'))
    await symlink(secret, path.join(releases, '0.2.0.shipped.json'))

    const release = await readProjectRelease(root, PROJECT)

    if (release.kind !== 'recorded') throw new Error('fixture')
    expect(release.record.features[0].answer).toBeUndefined()
    expect(release.versions[0].shipment).toBeUndefined()
    await expect(
      writeReleaseAnswer(release.record, 'links', 'works', '', NOW(), undefined, root)
    ).rejects.toMatchObject({ code: 'ECONFINED', reason: 'symlink' })
    await expect(
      shipRelease({
        root,
        project: PROJECT,
        record: release.record,
        notes: 'Notes.',
        shippedAt: NOW()
      })
    ).rejects.toMatchObject({ code: 'ECONFINED', reason: 'symlink' })
    expect(await readFile(secret, 'utf8')).toBe(planted)
  })
})

describe('handoffs and notes', () => {
  test('a linked handoff state file is not read and not written', async () => {
    const handoffs = path.join(root, PROJECT, 'handoffs')
    const handoff = path.join(handoffs, '2026-10-08-example-handoff.md')
    await mkdir(handoffs)
    await writeFile(handoff, '# Example\n')
    await writeFile(secret, JSON.stringify({ pickedUpAt: NOW(), archivedAt: NOW() }))
    const planted = await readFile(secret, 'utf8')
    await symlink(secret, path.join(handoffs, '2026-10-08-example-handoff.state.json'))

    expect(await readHandoffSidecar(handoff)).toEqual({ pickedUpAt: null, archivedAt: null })
    expect((await scanHandoffs(root)).handoffs[0].sidecar.archivedAt).toBeNull()
    await expect(archiveHandoff(handoff, NOW)).rejects.toMatchObject({ code: 'ECONFINED' })
    expect(await readFile(secret, 'utf8')).toBe(planted)
  })

  test('a note is not created or saved below a linked folder', async () => {
    await symlink(outside, path.join(root, 'linked-app'))
    const linked = path.join(root, 'linked-app')

    await expect(createNote(linked, 'A note', NOW, root)).rejects.toMatchObject({
      code: 'ECONFINED'
    })
    await expect(
      saveNote(
        { path: path.join(linked, '2026-10-08-note-a.md'), title: 'A', body: 'b', shots: [] },
        root
      )
    ).rejects.toMatchObject({ code: 'ECONFINED' })
    await expectOutsideUntouched()
  })
})

describe('the files the app keeps at the top of the records folder', () => {
  test('a linked .gitignore is not copied into the records and its target is not changed', async () => {
    await symlink(secret, path.join(root, '.gitignore'))
    await symlink(secret, path.join(root, 'AGENTS.md'))
    await symlink(secret, path.join(root, 'CLAUDE.md'))

    await ensureQaRepo(root)

    await expectOutsideUntouched()
    // Still the three links, with no temporary file left beside them: none
    // was replaced by a file holding the text of what it points to.
    expect((await readdir(root)).sort()).toEqual(['.gitignore', 'AGENTS.md', 'CLAUDE.md', PROJECT])
    for (const name of ['.gitignore', 'AGENTS.md', 'CLAUDE.md']) {
      expect((await lstat(path.join(root, name))).isSymbolicLink()).toBe(true)
    }
  })
})
