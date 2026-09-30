import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { armingFor, openedPathFor, writeArming } from '../arming'
import { scanQaRepo } from '../scan'

const REQ = '/record/dev-traffic-control/2026-09-23-a-check.md'
const NOW = '2026-09-23T21:30:00.000Z'

describe('arming the watch when a request is opened (ticket 16)', () => {
  test('an unfinished request arms, beside the request, with machine and time', () => {
    expect(armingFor(REQ, null, 'laptop.local', NOW)).toEqual({
      path: '/record/dev-traffic-control/2026-09-23-a-check.opened.json',
      body: { machine: 'laptop.local', openedAt: NOW }
    })
  })

  test('a report in progress still arms', () => {
    expect(armingFor(REQ, { completedAt: undefined }, 'm', NOW)).not.toBeNull()
  })

  test('a finished record is never armed', () => {
    expect(armingFor(REQ, { completedAt: '2026-09-23T20:00:00Z' }, 'm', NOW)).toBeNull()
  })

  test('only a Markdown request can arm', () => {
    expect(armingFor('/record/x/notes.txt', null, 'm', NOW)).toBeNull()
  })

  test('the opened file shares the request basename', () => {
    expect(openedPathFor('/a/b/2026-01-01-x.md')).toBe('/a/b/2026-01-01-x.opened.json')
  })
})

describe('writing the arming', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('a re-visit rewrites openedAt rather than appending', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dtc-arming-'))
    const req = join(dir, '2026-09-23-a-check.md')
    await writeArming(armingFor(req, null, 'm', '2026-09-23T10:00:00.000Z'))
    await writeArming(armingFor(req, null, 'm', NOW))
    const body = JSON.parse(await readFile(openedPathFor(req), 'utf8'))
    expect(body).toEqual({ machine: 'm', openedAt: NOW })
  })

  test('a failed write is swallowed', async () => {
    await expect(
      writeArming({
        path: '/nonexistent-dir-for-dtc/x.opened.json',
        body: { machine: 'm', openedAt: NOW }
      })
    ).resolves.toBeUndefined()
  })

  test('the opened file is never scanned as a request', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dtc-arming-scan-'))
    const project = join(dir, 'demo')
    await rm(project, { recursive: true, force: true })
    await import('node:fs/promises').then((fs) => fs.mkdir(project))
    await writeFile(
      join(project, '2026-09-23-a-check.md'),
      '---\nid: a-check\ntitle: A check\napp: Demo\ndate: 2026-09-23\n---\n\n## One {#one}\nDo it.\n'
    )
    await writeFile(join(project, '2026-09-23-a-check.opened.json'), '{}')
    const result = await scanQaRepo(dir)
    expect(result.runs.map((run) => run.request.path.split('/').pop())).toEqual([
      '2026-09-23-a-check.md'
    ])
  })
})
