import { describe, expect, test } from 'claude-code/testing'

import { docReviewReport, inProgressReport, lightReport } from './fixtures'
import { MAX_READS_PER_SCAN, scanRoot } from './scan'
import type { DirEntry, ScanCache, ScanIo } from './scan'

const ROOT = '/r/records'

/** A fake record root: path -> file text; directories derived. Counts reads. A file's listed size is its text's length. */
function fake(files: Record<string, string>, mtimes: Record<string, number> = {}) {
  const reads: string[] = []
  const io: ScanIo = {
    list: async dir => {
      const prefix = `${dir}/`
      const seen = new Map<string, DirEntry>()
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length)
        const slash = rest.indexOf('/')
        const name = slash < 0 ? rest : rest.slice(0, slash)
        seen.set(name, { name, kind: slash < 0 ? 'file' : 'dir', mtimeMs: slash < 0 ? (mtimes[path] ?? 1) : 0, ...(slash < 0 ? { size: (files[path] as string).length } : {}) })
      }
      return seen.size === 0 ? null : [...seen.values()]
    },
    read: async path => {
      reads.push(path)
      return files[path] ?? null
    },
  }
  return { io, reads }
}

const f = (project: string, name: string) => `${ROOT}/${project}/${name}`

const world = () => ({
  // no report, no opened: nothing at all but the request
  [f('p', '2026-01-01-none.md')]: '# n',
  [f('p', '2026-01-02-opened.opened.json')]: '{}',
  [f('p', '2026-01-03-progress.report.json')]: inProgressReport,
  [f('p', '2026-01-04-waiting.report.json')]: lightReport,
  [f('p', '2026-01-04-waiting.opened.json')]: '{}',
  [f('p', '2026-01-05-collected.report.json')]: lightReport,
  [f('p', '2026-01-05-collected.collected.json')]: '{}',
  [f('p', '2026-01-06-resolved.report.json')]: lightReport,
  [f('p', '2026-01-06-resolved.resolved.md')]: 'x',
  [f('p', '2026-01-07-malformed.report.json')]: '{"completedAt": "2026-',
  [f('q', 'round-1/2026-02-01-review.report.json')]: docReviewReport,
  [f('p', 'releases/0.21.0.answers.json')]: '{"completedAt":"x"}',
  [f('p', 'threads/2026-01-01-entry-a.report.json')]: lightReport,
  [f('p', '2026-01-04-waiting.shots/a.png')]: 'png',
  [f('p', 'roadmap.opened.json')]: '{}',
  [f('p', 'roadmap.md')]: '# Roadmap',
  [f('p', '2026-01-08-note-x.opened.json')]: '{}',
  [f('p', '2026-01-09-thing-handoff.opened.json')]: '{}',
})

describe('scanRoot over every state-table row', () => {
  test('opened, in-progress and waiting surface; an answer file that does not parse is listed as could-not-read; the rest are invisible', async () => {
    const { io } = fake(world())
    const { entries } = await scanRoot(io, ROOT, {})
    const byRel = Object.fromEntries(entries.map(e => [`${e.project}/${e.rel}`, e.state]))
    expect(byRel).toEqual({
      'p/2026-01-02-opened.md': 'opened',
      'p/2026-01-03-progress.md': 'in-progress',
      'p/2026-01-04-waiting.md': 'waiting',
      'p/2026-01-07-malformed.md': 'malformed',
      'p/releases/0.21.0.md': 'malformed',
      'q/round-1/2026-02-01-review.md': 'waiting',
    })
  })
  test('waiting entries carry title, completion, counts and decisions', async () => {
    const { entries } = await scanRoot(fake(world()).io, ROOT, {})
    const doc = entries.find(e => e.project === 'q')
    expect(doc?.title).toContain('pick a layout')
    expect(doc?.decisions).toEqual({ answered: 2, total: 3 })
    expect(doc?.completedAt).toBe('2026-01-12T13:06:44.867Z')
  })
  test('reserved folders and releases answers are not reports', async () => {
    const { entries } = await scanRoot(fake(world()).io, ROOT, {})
    expect(entries.some(e => e.rel.includes('threads'))).toBe(false)
    expect(entries.filter(e => e.rel.includes('releases')).map(e => [e.kind, e.state])).toEqual([['release', 'malformed']])
  })
})

describe('request classification, titles, times and watch claims', () => {
  test('roadmap.md, notes and handoffs are not requests', async () => {
    const { entries } = await scanRoot(fake(world()).io, ROOT, {})
    expect(entries.some(e => /roadmap|-note-|-handoff/.test(e.rel))).toBe(false)
  })
  test('opened time from openedAt, else file mtime; title from the request heading', async () => {
    const files = {
      [f('p', '2026-01-01-a.opened.json')]: '{"openedAt":"2026-10-02T08:15:00.000Z"}',
      [f('p', '2026-01-01-a.md')]: '---\ntitle: "From frontmatter"\n---\n# Heading',
      [f('p', '2026-01-02-b.opened.json')]: '{}',
      [f('p', '2026-01-02-b.md')]: '# From heading',
    }
    const { entries } = await scanRoot(fake(files, { [f('p', '2026-01-02-b.opened.json')]: 12345 }).io, ROOT, {})
    const a = entries.find(e => e.rel === '2026-01-01-a.md')
    const b = entries.find(e => e.rel === '2026-01-02-b.md')
    expect(a?.sinceMs).toBe(Date.parse('2026-10-02T08:15:00.000Z'))
    expect(a?.requestTitle).toBe('From frontmatter')
    expect(b?.sinceMs).toBe(12345)
    expect(b?.requestTitle).toBe('From heading')
  })
  test('a watch claim next to the request is read', async () => {
    const files = {
      [f('p', '2026-01-01-a.opened.json')]: '{}',
      [f('p', '2026-01-01-a.watch.json')]: '{"agent":"agent-1","machine":"laptop","heartbeatAt":"2026-10-02T08:15:00Z"}',
    }
    const { entries } = await scanRoot(fake(files).io, ROOT, {})
    expect(entries[0]?.watch).toEqual({ agent: 'agent-1', machine: 'laptop', heartbeatMs: Date.parse('2026-10-02T08:15:00Z') })
  })
})

describe('scan cost and races', () => {
  test('a second scan reads no report whose mtime is unchanged; a changed one is re-read', async () => {
    const files = world()
    const first = fake(files)
    const a = await scanRoot(first.io, ROOT, {})
    expect(first.reads.length).toBeGreaterThan(0)
    const second = fake(files)
    const b = await scanRoot(second.io, ROOT, a.cache)
    expect(second.reads.filter(p => p.endsWith('.report.json'))).toEqual([])
    expect(b.entries.map(e => e.state).sort()).toEqual(a.entries.map(e => e.state).sort())
    const third = fake(files, { [f('p', '2026-01-04-waiting.report.json')]: 99 })
    await scanRoot(third.io, ROOT, a.cache)
    expect(third.reads.filter(p => p.endsWith('.report.json'))).toEqual([f('p', '2026-01-04-waiting.report.json')])
  })
  test('a collected receipt appearing flips the state even though the report is cached', async () => {
    const files = world()
    const a = await scanRoot(fake(files).io, ROOT, {})
    const withReceipt = { ...files, [f('p', '2026-01-04-waiting.collected.json')]: '{}' }
    const b = await scanRoot(fake(withReceipt).io, ROOT, a.cache)
    expect(b.entries.some(e => e.rel === '2026-01-04-waiting.md')).toBe(false)
  })
  test('a half-written report is could-not-read now and right once it completes', async () => {
    const files = { [f('p', '2026-01-01-x.report.json')]: '{"comp' }
    const a = await scanRoot(fake(files).io, ROOT, {})
    expect(a.entries.map(e => [e.rel, e.state, e.completedAt])).toEqual([['2026-01-01-x.md', 'malformed', null]])
    const b = await scanRoot(fake({ [f('p', '2026-01-01-x.report.json')]: lightReport }, { [f('p', '2026-01-01-x.report.json')]: 2 }).io, ROOT, a.cache)
    expect(b.entries[0]?.state).toBe('waiting')
  })
  test('an unlistable root or a throwing io returns nothing without throwing', async () => {
    const cache: ScanCache = {}
    expect((await scanRoot({ list: async () => null, read: async () => null }, ROOT, cache)).entries).toEqual([])
    const boom: ScanIo = { list: async () => { throw new Error('gone') }, read: async () => null }
    expect((await scanRoot(boom, ROOT, cache)).entries).toEqual([])
  })
})

describe('the cache carries hits forward', () => {
  test('four scans of an unchanged root read each report once', async () => {
    const files = world()
    const reads: string[] = []
    let cache: ScanCache = {}
    for (let i = 0; i < 4; i++) {
      const run = fake(files)
      cache = (await scanRoot(run.io, ROOT, cache)).cache
      reads.push(...run.reads.filter(p => p.endsWith('.report.json')))
    }
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.length).toBe(new Set(reads).size)
  })
})

describe('a completion must be a real timestamp, not in the future', () => {
  const NOW = Date.parse('2026-10-03T12:00:00Z')
  const report = (completedAt: string) => JSON.stringify({ title: 't', items: [], completedAt })
  test('a non-ISO completedAt is in progress, not waiting', async () => {
    const { entries } = await scanRoot(fake({ [f('p', '2026-01-01-x.report.json')]: report('forged') }).io, ROOT, {}, NOW)
    expect(entries.map(e => [e.state, e.completedAt])).toEqual([['in-progress', null]])
  })
  test('a completedAt beyond the skew is in progress until its time comes, even from the cache', async () => {
    const files = { [f('p', '2026-01-01-x.report.json')]: report('2026-10-03T13:00:00Z') }
    const a = await scanRoot(fake(files).io, ROOT, {}, NOW)
    expect(a.entries[0]?.state).toBe('in-progress')
    const b = await scanRoot(fake(files).io, ROOT, a.cache, Date.parse('2026-10-03T13:00:01Z'))
    expect(b.entries[0]?.state).toBe('waiting')
  })
})

describe('a file is read once for the size and mtime it was listed with', () => {
  test('a second scan of an unchanged folder reads nothing at all: reports, request titles, opened and watch markers', async () => {
    const files = {
      ...world(),
      [f('p', '2026-01-02-opened.md')]: '# Opened one',
      [f('p', '2026-01-02-opened.opened.json')]: '{"openedAt":"2026-10-02T08:15:00.000Z"}',
      [f('p', '2026-01-02-opened.watch.json')]: '{"agent":"agent-1","machine":"laptop","heartbeatAt":"2026-10-02T08:15:00Z"}',
      [f('p', 'roadmap/an-idea.md')]: '---\nid: an-idea\ntitle: An idea\n---\n\n## Reviewer entry · 2026-01-17 · Approved\n\nYes.\n',
    }
    const first = fake(files)
    const a = await scanRoot(first.io, ROOT, {})
    expect(first.reads).toContain(f('p', '2026-01-02-opened.md'))
    expect(first.reads).toContain(f('p', '2026-01-02-opened.opened.json'))
    expect(first.reads).toContain(f('p', '2026-01-02-opened.watch.json'))
    expect(first.reads).toContain(f('p', 'roadmap/an-idea.md'))
    // No file is read twice within one scan.
    expect(first.reads.length).toBe(new Set(first.reads).size)
    const second = fake(files)
    const b = await scanRoot(second.io, ROOT, a.cache)
    // A file that parsed to nothing (the half-written report, the release answers in another shape) is held as well.
    expect(second.reads).toEqual([])
    expect(b.entries).toEqual(a.entries)
    expect(b.unread).toBe(0)
    const opened = b.entries.find(e => e.rel === '2026-01-02-opened.md')
    expect(opened?.requestTitle).toBe('Opened one')
    expect(opened?.sinceMs).toBe(Date.parse('2026-10-02T08:15:00.000Z'))
    expect(opened?.watch).toEqual({ agent: 'agent-1', machine: 'laptop', heartbeatMs: Date.parse('2026-10-02T08:15:00Z') })
  })
  test('the same mtime with another size is another file: read again', async () => {
    const path = f('p', '2026-01-04-waiting.report.json')
    const a = await scanRoot(fake({ [path]: lightReport }).io, ROOT, {})
    const longer = fake({ [path]: `${lightReport} ` })
    await scanRoot(longer.io, ROOT, a.cache)
    expect(longer.reads).toEqual([path])
    // A cache entry kept without a size (as an earlier version kept it) is read again once, then held.
    const old = Object.fromEntries(Object.entries(a.cache).map(([p, v]) => [p, { mtimeMs: v.mtimeMs, s: v.s }]))
    const upgraded = fake({ [path]: lightReport })
    const c = await scanRoot(upgraded.io, ROOT, old)
    expect(upgraded.reads).toEqual([path])
    const after = fake({ [path]: lightReport })
    await scanRoot(after.io, ROOT, c.cache)
    expect(after.reads).toEqual([])
  })
  test('a file that could not be read is not held: it is tried again on the next scan', async () => {
    const path = f('p', '2026-01-04-waiting.report.json')
    const gone: ScanIo = { ...fake({ [path]: lightReport }).io, read: async () => null }
    const a = await scanRoot(gone, ROOT, {})
    expect(a.entries.map(e => e.state)).toEqual(['malformed'])
    expect(a.cache).toEqual({})
    const back = fake({ [path]: lightReport })
    expect((await scanRoot(back.io, ROOT, a.cache)).entries.map(e => e.state)).toEqual(['waiting'])
  })
})

describe('a scan reads a bounded number of files', () => {
  const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [f('p', `2026-01-01-r${String(i).padStart(4, '0')}.report.json`), lightReport]))
  test('1,000 reports, cold: each scan reads at most the cap and says more is not read yet; every report is read exactly once in all', async () => {
    const files = many(1000)
    const reads: string[] = []
    let cache: ScanCache = {}
    const listed: number[] = []
    const unread: number[] = []
    for (let i = 0; i < 7; i++) {
      const run = fake(files)
      const r = await scanRoot(run.io, ROOT, cache)
      expect(run.reads.length).toBeLessThanOrEqual(MAX_READS_PER_SCAN)
      reads.push(...run.reads)
      cache = r.cache
      listed.push(r.entries.length)
      unread.push(r.unread)
    }
    expect(MAX_READS_PER_SCAN).toBe(200)
    expect(listed).toEqual([200, 400, 600, 800, 1000, 1000, 1000])
    expect(unread).toEqual([800, 600, 400, 200, 0, 0, 0])
    expect(reads).toHaveLength(1000)
    expect(new Set(reads).size).toBe(1000)
  })
  test('a record whose report was not read yet is left out, never shown as could-not-read', async () => {
    const r = await scanRoot(fake(many(5)).io, ROOT, {}, undefined, 2)
    expect(r.entries.map(e => e.state)).toEqual(['waiting', 'waiting'])
    expect(r.unread).toBe(3)
  })
  test('ideas, release answers and the small files beside a request count against the same cap', async () => {
    const files = {
      [f('p', '2026-01-02-opened.md')]: '# Opened one',
      [f('p', '2026-01-02-opened.opened.json')]: '{"openedAt":"2026-10-02T08:15:00.000Z"}',
      [f('p', 'roadmap/an-idea.md')]: '---\nid: an-idea\ntitle: An idea\n---\n\n## Reviewer entry · 2026-01-17 · Approved\n\nYes.\n',
      [f('p', 'releases/0.4.0.answers.json')]: '{"app":"Example App","release":"0.4.0","answers":[{"id":"a","verdict":"works","comment":"","at":"2026-01-20T10:00:00.000Z"}]}',
    }
    const none = fake(files)
    const r0 = await scanRoot(none.io, ROOT, {}, undefined, 0)
    expect(none.reads).toEqual([])
    expect(r0.unread).toBe(4)
    // The opened request is still listed (its marker's own mtime stands in for the time), without a title; the idea and the release are not, yet.
    expect(r0.entries.map(e => [e.rel, e.state, e.requestTitle, e.sinceMs])).toEqual([['2026-01-02-opened.md', 'opened', undefined, 1]])
    const all = fake(files)
    const r1 = await scanRoot(all.io, ROOT, r0.cache)
    expect(all.reads).toHaveLength(4)
    expect(r1.unread).toBe(0)
    expect(r1.entries.map(e => e.rel).sort()).toEqual(['2026-01-02-opened.md', 'releases/0.4.0.md', 'roadmap/an-idea.md'])
  })
  test('a cap that is not a number reads nothing rather than everything', async () => {
    const run = fake(many(3))
    expect((await scanRoot(run.io, ROOT, {}, undefined, Number.NaN)).unread).toBe(3)
    expect(run.reads).toEqual([])
  })
})

