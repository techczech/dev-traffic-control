import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  compareReleaseVersions,
  parseReleaseRecord,
  readProjectRelease,
  verdictShotFeature,
  writeReleaseAnswer,
  type ReleaseAnswers
} from '../releaseRecords'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'dtc-releases-'))
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

describe('release records', () => {
  test('reads the intro before the first feature, and nothing when there is none', () => {
    const raw = `---
app: TallyBoard
release: 0.34.0
repo: apps/example-app
updated: 2026-09-27
---

Everything since 0.32.3 in one release: sharing a read-only view from a /v link.

Designs locked 25–27 September.

## Share a read-only view from a /v link {#read-only-view}
state: built
The talk's short link plus /v opens a read-only copy of the page.
`
    const record = parseReleaseRecord(raw, '/records/tallyboard/releases/0.34.0.md')

    expect(record.intro).toBe(
      'Everything since 0.32.3 in one release: sharing a read-only view from a /v link.\n\nDesigns locked 25–27 September.'
    )
    expect(record.features.map((feature) => feature.id)).toEqual(['read-only-view'])
    expect(record.features[0].prose).toBe(
      "The talk's short link plus /v opens a read-only copy of the page."
    )

    const bare = parseReleaseRecord(
      raw.replace(/\n\nEverything[\s\S]*?September\.\n/, '\n'),
      '/records/tallyboard/releases/0.34.0.md'
    )
    expect(bare).not.toHaveProperty('intro')
  })

  test('parses frontmatter, declared states, groundwork, prose, checks and a pinned id', () => {
    const raw = `---
app: Dev Traffic Control
release: 0.11.0
repo: apps/qa-probe
handoff: handoffs/2026-07-29-dev-traffic-control-handoff.md
updated: 2026-07-30
---

## See the board
state: notstarted
unknown: ignored
Every app and its release appear together.
later: this stays prose because the field block has ended.

**How to check**
Open the board and find Dev Traffic Control.

## Open a handoff {#open-handoff}
state: built
The handoff opens as Markdown.

## Answer on the row
state: you

## Release readers
kind: groundwork
unlocks: The board and handoffs views.
`

    const record = parseReleaseRecord(raw, '/records/dev-traffic-control/releases/0.11.0.md')

    expect(record).toMatchObject({
      app: 'Dev Traffic Control',
      release: '0.11.0',
      version: '0.11.0',
      repo: 'apps/qa-probe',
      handoff: 'handoffs/2026-07-29-dev-traffic-control-handoff.md',
      updated: '2026-07-30',
      degraded: false
    })
    expect(record.features).toHaveLength(4)
    expect(record.features[0]).toMatchObject({
      id: 'see-the-board',
      title: 'See the board',
      declaredState: 'notstarted',
      status: 'notstarted',
      prose:
        'Every app and its release appear together.\nlater: this stays prose because the field block has ended.',
      howToCheck: 'Open the board and find Dev Traffic Control.'
    })
    expect(record.features[1]).toMatchObject({
      id: 'open-handoff',
      declaredState: 'built',
      status: 'built'
    })
    expect(record.features[2]).toMatchObject({
      id: 'answer-on-the-row',
      declaredState: 'you',
      status: 'you'
    })
    expect(record.features[3]).toMatchObject({
      id: 'release-readers',
      kind: 'groundwork',
      unlocks: 'The board and handoffs views.'
    })
    expect(record.features[3].declaredState).toBeUndefined()
    expect(record.features[3].status).toBeUndefined()
  })

  test('state done is malformed input and never becomes a Done feature', () => {
    const record = parseReleaseRecord(
      `---
app: Dev Traffic Control
release: 0.11.0
repo: apps/qa-probe
---
## This must not be done
state: done
`,
      '/records/dev-traffic-control/releases/0.11.0.md'
    )

    expect(record.degraded).toBe(true)
    expect(record.features).toHaveLength(1)
    expect(record.features[0].declaredState).toBeUndefined()
    expect(record.features[0].status).toBeUndefined()
  })

  test('an off answer derives Being built and keeps the note', () => {
    const record = parseReleaseRecord(
      `---
app: Dev Traffic Control
release: 0.11.0
repo: apps/qa-probe
---
## Flagged feature {#flagged-feature}
state: you
`,
      '/records/dev-traffic-control/releases/0.11.0.md',
      {
        app: 'Dev Traffic Control',
        release: '0.11.0',
        answers: [
          {
            id: 'flagged-feature',
            verdict: 'off',
            comment: 'The row points at the wrong release.',
            at: '2026-07-30T09:12:00.000Z'
          }
        ]
      }
    )

    expect(record.features[0].status).toBe('building')
    expect(record.features[0].answer?.comment).toBe('The row points at the wrong release.')
  })

  test('the answers sidecar keeps an answer after a pinned heading is reworded', async () => {
    const root = await temporaryDirectory()
    const releases = path.join(root, 'dev-traffic-control', 'releases')
    await mkdir(releases, { recursive: true })
    await writeFile(
      path.join(releases, '0.11.0.md'),
      `---
app: Dev Traffic Control
release: 0.11.0
repo: apps/qa-probe
---
## Relaunch work from a handoff {#handoff-reader}
state: you
`
    )
    const answers: ReleaseAnswers = {
      app: 'Dev Traffic Control',
      release: '0.11.0',
      answers: [
        {
          id: 'handoff-reader',
          verdict: 'works',
          comment: '',
          at: '2026-07-30T09:12:00.000Z'
        }
      ]
    }
    await writeFile(path.join(releases, '0.11.0.answers.json'), JSON.stringify(answers))

    const result = await readProjectRelease(root, 'dev-traffic-control')
    expect(result.kind).toBe('recorded')
    if (result.kind !== 'recorded') return
    const [feature] = result.record.features

    expect(feature.id).toBe('handoff-reader')
    expect(feature.answer?.verdict).toBe('works')
    expect(feature.declaredState).toBe('you')
    expect(feature.status).toBe('done')
  })

  test('selects 0.10.0 over 0.9.0 by numeric version order', async () => {
    const root = await temporaryDirectory()
    const releases = path.join(root, 'dev-traffic-control', 'releases')
    await mkdir(releases, { recursive: true })
    await writeFile(
      path.join(releases, '0.9.0.md'),
      `---
app: Dev Traffic Control
release: 0.9.0
repo: apps/qa-probe
---
## Older feature
state: built
`
    )
    await writeFile(
      path.join(releases, '0.10.0.md'),
      `---
app: Dev Traffic Control
release: 0.10.0
repo: apps/qa-probe
---
## Newer feature
state: building
`
    )

    const result = await readProjectRelease(root, 'dev-traffic-control')

    expect(result.kind).toBe('recorded')
    if (result.kind === 'recorded') {
      expect(result.record.version).toBe('0.10.0')
      expect(result.record.features[0].title).toBe('Newer feature')
      expect(result.shippedVersions).toEqual(['0.9.0'])
    }
  })

  test('reads every version and identifies the one release in flight from shipment records', async () => {
    const root = await temporaryDirectory()
    const releases = path.join(root, 'wordforge', 'releases')
    await mkdir(releases, { recursive: true })

    for (const version of ['0.19.0', '0.19.2', '0.19.4', '0.19.6']) {
      await writeFile(
        path.join(releases, `${version}.md`),
        `---
app: WordForge
release: ${version}
repo: apps/wordforge
---
## Feature in ${version}
state: built
`
      )
    }
    await writeFile(
      path.join(releases, '0.19.0.shipped.json'),
      JSON.stringify({
        app: 'WordForge',
        release: '0.19.0',
        notes: 'The main release notes.',
        shippedAt: '2026-08-05T12:00:00.000Z',
        returnedFeatureIds: []
      })
    )
    for (const version of ['0.19.2', '0.19.4']) {
      await writeFile(
        path.join(releases, `${version}.shipped.json`),
        JSON.stringify({
          app: 'WordForge',
          release: version,
          notes: `Fixes in ${version}.`,
          shippedAt: '2026-08-06T12:00:00.000Z',
          returnedFeatureIds: [],
          fixesTo: '0.19.0'
        })
      )
    }

    const result = await readProjectRelease(root, 'wordforge')

    expect(result.kind).toBe('recorded')
    if (result.kind !== 'recorded') return
    expect(result.inFlightVersion).toBe('0.19.6')
    expect(result.record.version).toBe('0.19.6')
    expect(result.versions.map((version) => version.version)).toEqual([
      '0.19.6',
      '0.19.4',
      '0.19.2',
      '0.19.0'
    ])
    expect(result.versions.find((version) => version.version === '0.19.4')?.shipment).toMatchObject(
      {
        notes: 'Fixes in 0.19.4.',
        fixesTo: '0.19.0'
      }
    )
  })

  test('compares every numeric segment rather than comparing version text', () => {
    expect(compareReleaseVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.19.10', '0.19.6')).toBeGreaterThan(0)
    expect(compareReleaseVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
  })

  test('no releases folder and a highest record with no features are distinct nothing-recorded results', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'without-releases'))

    expect(await readProjectRelease(root, 'without-releases')).toEqual({
      kind: 'nothing-recorded',
      project: 'without-releases'
    })

    const releases = path.join(root, 'empty-record', 'releases')
    await mkdir(releases, { recursive: true })
    await writeFile(
      path.join(releases, '0.11.0.md'),
      `---
app: Dev Traffic Control
release: 0.11.0
repo: apps/qa-probe
---
No feature headings.
`
    )

    expect(await readProjectRelease(root, 'empty-record')).toEqual({
      kind: 'nothing-recorded',
      project: 'empty-record'
    })
  })
})

// 2026-09-27: several unshipped releases used to mean none was in flight.
test('with several unshipped releases the newest is in flight', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const pathModule = await import('node:path')
  const root = await mkdtemp(pathModule.join(tmpdir(), 'dtc-inflight-'))
  const releases = pathModule.join(root, 'tw', 'releases')
  await mkdir(releases, { recursive: true })
  for (const version of ['0.33.0', '0.34.0', '0.35.0']) {
    await writeFile(
      pathModule.join(releases, `${version}.md`),
      `---\napp: TallyBoard\nrelease: ${version}\nrepo: x\n---\n\n## A feature {#f}\nstate: building\nSomething.\n`
    )
  }
  const { readProjectRelease } = await import('../releaseRecords')
  const result = await readProjectRelease(root, 'tw')
  expect(result.kind === 'recorded' && result.inFlightVersion).toBe('0.35.0')
})

describe('ticket 25: since dates and verdict pictures', () => {
  const ledger = `---
app: Demo
release: 0.2.0
repo: apps/demo
---

## Links open {#links}
state: you
since: 2026-09-27

## Browse mode
state: built
since: 27 Sep

## Impossible day
state: building
since: 2026-02-30
`

  async function recordIn(answers?: string): Promise<{ dir: string; sidecar: string }> {
    const root = await temporaryDirectory()
    const dir = path.join(root, 'demo', 'releases')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, '0.2.0.md'), ledger)
    const sidecar = path.join(dir, '0.2.0.answers.json')
    if (answers) await writeFile(sidecar, answers)
    return { dir: root, sidecar }
  }

  test('since is read only as a real YYYY-MM-DD day, and never degrades the record', () => {
    const record = parseReleaseRecord(ledger, '/r/demo/releases/0.2.0.md')
    expect(record.features.map((feature) => feature.since)).toEqual([
      '2026-09-27',
      undefined,
      undefined
    ])
    expect(record.degraded).toBe(false)
  })

  test('an answer written before ticket 25 still reads, with no screenshots field', async () => {
    const old = JSON.stringify({
      app: 'Demo',
      release: '0.2.0',
      answers: [{ id: 'links', verdict: 'off', comment: 'no', at: '2026-09-27T10:00:00Z' }]
    })
    const { dir } = await recordIn(old)
    const release = await readProjectRelease(dir, 'demo')
    if (release.kind !== 'recorded') throw new Error('fixture')
    expect(release.record.features[0].answer).toEqual({
      id: 'links',
      verdict: 'off',
      comment: 'no',
      at: '2026-09-27T10:00:00Z'
    })
  })

  test('an answer carries its pictures; an answer without any writes no field', async () => {
    const { dir, sidecar } = await recordIn()
    const release = await readProjectRelease(dir, 'demo')
    if (release.kind !== 'recorded') throw new Error('fixture')
    const shots = ['releases/0.2.0.shots/links-1.png', 'releases/0.2.0.shots/links-2.png']

    await writeReleaseAnswer(release.record, 'links', 'off', ' wrong ', 'T1', shots)
    let written = JSON.parse(await readFile(sidecar, 'utf8'))
    expect(written.answers).toEqual([
      { id: 'links', verdict: 'off', comment: 'wrong', at: 'T1', screenshots: shots }
    ])

    // No list keeps the pictures (a re-answer from Releases); a list replaces them.
    await writeReleaseAnswer(release.record, 'links', 'works', '', 'T2')
    written = JSON.parse(await readFile(sidecar, 'utf8'))
    expect(written.answers[0].screenshots).toEqual(shots)
    await writeReleaseAnswer(release.record, 'links', 'works', '', 'T3', [])
    written = JSON.parse(await readFile(sidecar, 'utf8'))
    expect(written.answers[0]).toEqual({ id: 'links', verdict: 'works', comment: '', at: 'T3' })

    const reread = await readProjectRelease(dir, 'demo')
    if (reread.kind !== 'recorded') throw new Error('fixture')
    expect(reread.record.features[0].answer?.screenshots).toBeUndefined()
  })

  test('an answer refuses a picture that is not its own', async () => {
    const { dir, sidecar } = await recordIn()
    const release = await readProjectRelease(dir, 'demo')
    if (release.kind !== 'recorded') throw new Error('fixture')
    for (const shot of [
      'releases/0.2.0.shots/browse-mode-1.png',
      'releases/0.1.0.shots/links-1.png',
      'releases/0.2.0.shots/../../../elsewhere/links-1.png',
      '/etc/links-1.png',
      'releases/0.2.0.shots/links-1.jpg'
    ]) {
      await expect(
        writeReleaseAnswer(release.record, 'links', 'off', '', 'T', [shot])
      ).rejects.toThrow('not one of its own')
    }
    await expect(readFile(sidecar, 'utf8')).rejects.toThrow()
  })

  test('the verdict-picture grammar names the feature and nothing else', () => {
    expect(verdictShotFeature('0.2.0', 'releases/0.2.0.shots/links-3.png')).toBe('links')
    expect(verdictShotFeature('0.2.0', 'releases/0.2.0.shots/a-2-1.png')).toBe('a-2')
    expect(verdictShotFeature('0.2.0', 'releases/0.2.0.shots/sub/links-1.png')).toBeNull()
    expect(verdictShotFeature('0.2.0', 'releases/0.2.0.shots/links.png')).toBeNull()
    expect(verdictShotFeature('0.2.0', 7)).toBeNull()
  })
})
