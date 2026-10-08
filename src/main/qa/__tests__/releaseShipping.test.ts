import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { draftReleaseNotes } from '../../../shared/releaseNotes'
import { readProjectPool } from '../pool'
import { readProjectRelease, type ReleaseRecord } from '../releaseRecords'
import { shipRelease } from '../releaseShipping'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'dtc-release-shipping-'))
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

describe('release notes drafter', () => {
  test('drafts feature titles and descriptions while leaving groundwork in the record', () => {
    const record = releaseRecord('/records/windmill/releases/0.19.6.md', [
      {
        id: 'move-structure',
        title: 'Moving rows by structure',
        kind: 'feature',
        declaredState: 'built',
        status: 'built',
        prose: 'Move a row, and its nested rows move with it.'
      },
      {
        id: 'outline-engine',
        title: 'The outline engine',
        kind: 'groundwork',
        prose: 'Every structure command runs through this engine.',
        unlocks: 'Moving and promoting paragraphs.'
      }
    ])

    expect(draftReleaseNotes(record)).toBe(
      '## Moving rows by structure\n\nMove a row, and its nested rows move with it.'
    )
    expect(record.features.map((feature) => feature.id)).toEqual([
      'move-structure',
      'outline-engine'
    ])
  })
})

describe('release ship writer', () => {
  test('ships a declared Not started feature with no idea file and returns it by name', async () => {
    const root = await temporaryDirectory()
    const project = 'windmill'
    const releaseDirectory = path.join(root, project, 'releases')
    await mkdir(releaseDirectory, { recursive: true })
    const record = releaseRecord(path.join(releaseDirectory, '0.19.6.md'), [
      {
        id: 'send-html',
        title: 'Send a draft as an HTML document someone can read',
        kind: 'feature',
        declaredState: 'notstarted',
        status: 'notstarted'
      }
    ])

    const result = await shipRelease({
      root,
      project,
      record,
      notes: 'Edited and approved release notes.',
      shippedAt: '2026-08-07T06:00:00.000Z'
    })

    expect(result.returnedFeatures).toEqual([
      { id: 'send-html', title: 'Send a draft as an HTML document someone can read' }
    ])
    expect((await readProjectPool(root, project)).ideas).toEqual([
      expect.objectContaining({
        id: 'send-html',
        title: 'Send a draft as an HTML document someone can read',
        tier: 'functionality',
        state: 'pool',
        returnedFrom: '0.19.6',
        bodyMarkdown: ''
      })
    ])
    expect(
      JSON.parse(await readFile(path.join(root, project, 'roadmap', 'order.json'), 'utf8')).returned
    ).toEqual({
      'send-html': {
        title: 'Send a draft as an HTML document someone can read',
        tier: 'functionality',
        from: '0.19.6',
        at: '2026-08-07T06:00:00.000Z'
      }
    })
    expect(await readdir(path.join(root, project, 'roadmap'))).toEqual(['order.json'])
  })

  test('returns exactly the Not started feature to the pool and freezes its id and name', async () => {
    const root = await temporaryDirectory()
    const project = 'windmill'
    const releaseDirectory = path.join(root, project, 'releases')
    const roadmapDirectory = path.join(root, project, 'roadmap')
    await mkdir(releaseDirectory, { recursive: true })
    await mkdir(roadmapDirectory, { recursive: true })

    const ledgerPath = path.join(releaseDirectory, '0.19.6.md')
    const ledger = releaseLedger()
    await writeFile(ledgerPath, ledger)
    await writeFile(
      path.join(roadmapDirectory, 'send-html.md'),
      `---\nid: send-html\ntitle: Send a draft as an HTML document someone can read\ntier: functionality\nadded: 2026-08-06\n---\n\nSend the current draft as a self-contained document.\n`
    )
    await writeFile(
      path.join(roadmapDirectory, 'order.json'),
      JSON.stringify({
        positions: { 'send-html': 1 },
        states: {
          'send-html': {
            state: 'promoted',
            release: '0.19.6',
            specWanted: true,
            at: '2026-08-06T12:00:00.000Z'
          }
        }
      })
    )

    const projectRelease = await readProjectRelease(root, project)
    expect(projectRelease.kind).toBe('recorded')
    if (projectRelease.kind !== 'recorded') return

    const result = await shipRelease({
      root,
      project,
      record: projectRelease.record,
      notes: 'Edited and approved release notes.',
      shippedAt: '2026-08-07T12:00:00.000Z',
      fixesTo: '0.19.0'
    })

    expect(result.returnedFeatures).toEqual([
      { id: 'send-html', title: 'Send a draft as an HTML document someone can read' }
    ])
    expect(result.shipment.returnedFeatureIds).toEqual(['send-html'])
    expect(await readFile(ledgerPath, 'utf8')).toBe(ledger)
    expect(
      (await readProjectPool(root, project)).ideas.find((idea) => idea.id === 'send-html')
    ).toMatchObject({
      title: 'Send a draft as an HTML document someone can read',
      state: 'pool'
    })
    expect(
      JSON.parse(await readFile(path.join(releaseDirectory, '0.19.6.shipped.json'), 'utf8'))
    ).toEqual({
      app: 'Windmill',
      release: '0.19.6',
      notes: 'Edited and approved release notes.',
      shippedAt: '2026-08-07T12:00:00.000Z',
      returnedFeatureIds: ['send-html'],
      fixesTo: '0.19.0'
    })
    expect((await readdir(releaseDirectory)).sort()).toEqual(['0.19.6.md', '0.19.6.shipped.json'])
  })

  test('refuses a second shipment without changing the frozen sidecar', async () => {
    const root = await temporaryDirectory()
    const project = 'windmill'
    const releaseDirectory = path.join(root, project, 'releases')
    await mkdir(releaseDirectory, { recursive: true })
    const record = releaseRecord(path.join(releaseDirectory, '0.19.6.md'), [
      {
        id: 'ready',
        title: 'A finished feature',
        kind: 'feature',
        declaredState: 'built',
        status: 'built',
        prose: 'It is ready.'
      }
    ])
    const sidecarPath = path.join(releaseDirectory, '0.19.6.shipped.json')
    const frozen = `${JSON.stringify({
      app: 'Windmill',
      release: '0.19.6',
      notes: 'The first notes.',
      shippedAt: '2026-08-07T10:00:00.000Z',
      returnedFeatureIds: []
    })}\n`
    await writeFile(sidecarPath, frozen)

    await expect(
      shipRelease({
        root,
        project,
        record,
        notes: 'Replacement notes.',
        shippedAt: '2026-08-07T12:00:00.000Z'
      })
    ).rejects.toThrow('Windmill 0.19.6 has already shipped. Frozen notes cannot be overwritten.')
    expect(await readFile(sidecarPath, 'utf8')).toBe(frozen)
  })

  test('reads a frozen sidecar with no Markdown ledger as notes-only history', async () => {
    const root = await temporaryDirectory()
    const releaseDirectory = path.join(root, 'windmill', 'releases')
    await mkdir(releaseDirectory, { recursive: true })
    await writeFile(
      path.join(releaseDirectory, '0.18.0.shipped.json'),
      JSON.stringify({
        app: 'Windmill',
        release: '0.18.0',
        notes: 'The frozen notes survive without the ledger.',
        shippedAt: '2026-08-01T12:00:00.000Z',
        returnedFeatureIds: []
      })
    )

    const result = await readProjectRelease(root, 'windmill')

    expect(result.kind).toBe('recorded')
    if (result.kind !== 'recorded') return
    expect(result.inFlightVersion).toBeUndefined()
    expect(result.versions).toHaveLength(1)
    expect(result.versions[0]).toMatchObject({
      version: '0.18.0',
      record: { degraded: true, features: [] },
      shipment: { notes: 'The frozen notes survive without the ledger.' }
    })
  })
})

function releaseRecord(filePath: string, features: ReleaseRecord['features']): ReleaseRecord {
  return {
    path: filePath,
    version: '0.19.6',
    app: 'Windmill',
    release: '0.19.6',
    repo: 'apps/windmill',
    features,
    answers: [],
    degraded: false
  }
}

function releaseLedger(): string {
  return `---
app: Windmill
release: 0.19.6
repo: apps/windmill
---
## Moving rows by structure {#move-structure}
state: built
Move a paragraph and take its children with it.

## Send a draft as an HTML document someone can read {#send-html}
state: notstarted
Send the current draft as a self-contained document.
`
}
