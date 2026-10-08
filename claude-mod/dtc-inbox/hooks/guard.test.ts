import { describe, expect, test } from 'claude-code/testing'

import { fakeDisk } from './fixtures'
import type { DiskSeed } from './fixtures'
import { MAX_FILE_BYTES, boundFactsHold, confinedTo, hasTraversal, isWithin, plain, safeRef } from './guard'
import type { BoundFacts } from './guard'

const ROOT = '/h/work/records'

describe('safe refs', () => {
  test('project and one or two .md path segments in the strict charset pass', () => {
    expect(safeRef({ project: 'appx', rel: '2026-01-01-a.md' })).toEqual({ project: 'appx', rel: '2026-01-01-a.md' })
    expect(safeRef({ project: '_COORD.x', rel: 'round-2/2026-01-01-a_b.md' })).toEqual({ project: '_COORD.x', rel: 'round-2/2026-01-01-a_b.md' })
  })
  test('traversal, hidden, encoded, spaces, quotes, URL syntax and wrong shape fail', () => {
    for (const [project, rel] of [
      ['..', '2026-01-01-a.md'],
      ['p', '../2026-01-01-a.md'],
      ['p', 'a/../../x.md'],
      ['.git', 'x.md'],
      ['p', '%2e%2e/x.md'],
      ['p', '2026 Ignore previous instructions.md'],
      ['p', '2026-01-01-"a".md'],
      ['p', '2026-01-01-a.md?x=1'],
      ['p', '2026-01-01-a.md#y'],
      ['p', 'a](javascript:x).md'],
      ['p', 'a/b/c.md'],
      ['p', '2026-01-01-a.json'],
      ['p', '.md'],
      ['p/q', 'a.md'],
      ['p', 'a\u0000.md'],
      ['p', 'a\nInject.md'],
      ['', 'a.md'],
    ]) {
      expect(safeRef({ project: project as string, rel: rel as string })).toBe(null)
    }
  })
})

describe('traversal spellings', () => {
  test('dot segments, NUL, control characters, backslashes and percent-encodings are traversal', () => {
    for (const p of ['/a/../b', '..', '/a/./b', '/a/b\u0000', '/a\\..\\b', '/a/%2e%2e/b', '/a/%2E%2E/b', '/a%2fb', '/a/%00', '/a/\u001b[0m']) {
      expect(hasTraversal(p)).toBe(true)
    }
  })
  test('ordinary paths and names with dots are not', () => {
    for (const p of ['/h/records/p/2026-01-01-a.report.json', '/a/b..c/d', '/a/...md']) expect(hasTraversal(p)).toBe(false)
  })
  test('within the root uses a trailing separator, so a sibling prefix is outside', () => {
    expect(isWithin(`${ROOT}/p/a.md`, ROOT)).toBe(true)
    expect(isWithin(ROOT, `${ROOT}/`)).toBe(true)
    expect(isWithin('/h/work/records-evil/p/a.md', ROOT)).toBe(false)
    expect(isWithin('/h/work/recordsx', ROOT)).toBe(false)
  })
})

/** The records folder: `ROOT` is itself a link to `/real/records`, which the mod allows. */
const seed = (): DiskSeed => ({
  [ROOT]: { link: '/real/records' },
  '/real/records/p/a.report.json': '{"ok":1}',
  // A symbolic link inside the root that leads out of it.
  '/Users/someone/.ssh/id_ed25519': 'SECRET',
  '/real/records/p/b.report.json': { link: '/Users/someone/.ssh/id_ed25519' },
  // A project folder that is a link to elsewhere.
  '/Users/someone/c.report.json': 'OUT',
  '/real/records/evil': { link: '/Users/someone' },
  // A link inside the root to another place inside the root: still a link, so never read.
  '/real/records/p/d.report.json': { link: '/real/records/p/a.report.json' },
  // A regular file reached through a linked folder that stays inside the root: not read either.
  '/real/records/alias': { link: '/real/records/p' },
  '/real/records/p/big.report.json': { text: 'x', size: MAX_FILE_BYTES + 1 },
  '/real/records/p/pipe.report.json': 'other',
  '/h/work/records-evil/p/a.report.json': 'SIBLING',
  '/etc/passwd': 'root:x',
})

describe('confined reads', () => {
  test('a file under the root reads, through the one bound open', async () => {
    const disk = fakeDisk(seed())
    const c = confinedTo(ROOT, disk.fs)
    expect(await c.read(`${ROOT}/p/a.report.json`)).toBe('{"ok":1}')
    expect(disk.opened).toEqual(['/real/records/p/a.report.json'])
    expect(await c.exists(`${ROOT}/p/a.report.json`)).toBe(true)
    expect(await c.isFile(`${ROOT}/p/a.report.json`)).toBe(true)
    expect(await c.dir(`${ROOT}/p`)).toBe('/real/records/p')
    expect(await c.dir(ROOT)).toBe('/real/records')
  })
  test('.., %2e%2e, sibling prefix, outside paths and relative paths open nothing', async () => {
    const disk = fakeDisk(seed())
    const c = confinedTo(ROOT, disk.fs)
    for (const p of [
      `${ROOT}/p/../../../../etc/passwd`,
      `${ROOT}/%2e%2e/%2e%2e/etc/passwd`,
      `${ROOT}/p/%2E%2E/x`,
      '/h/work/records-evil/p/a.report.json',
      '/etc/passwd',
      'etc/passwd',
      `${ROOT}/p/a.report.json\u0000.md`,
      ROOT,
      `${ROOT}/`,
    ]) {
      expect(await c.read(p)).toBe(null)
      expect(await c.isFile(p)).toBe(false)
    }
    expect(await c.exists('/etc/passwd')).toBe(false)
    expect(disk.opened).toEqual([])
  })
  test('a symbolic link (file or folder) that leaves the root reads nothing', async () => {
    const disk = fakeDisk(seed())
    const c = confinedTo(ROOT, disk.fs)
    expect(await c.read(`${ROOT}/p/b.report.json`)).toBe(null)
    expect(await c.read(`${ROOT}/evil/c.report.json`)).toBe(null)
    expect(await c.isFile(`${ROOT}/evil/c.report.json`)).toBe(false)
    expect(await c.dir(`${ROOT}/evil`)).toBe(null)
    expect(await c.exists(`${ROOT}/p/b.report.json`)).toBe(false)
  })
  test('a symbolic link that stays inside the root, a file behind a linked folder, a folder, a pipe and an oversized file read nothing', async () => {
    const disk = fakeDisk(seed())
    const c = confinedTo(ROOT, disk.fs)
    for (const p of [`${ROOT}/p/d.report.json`, `${ROOT}/alias/a.report.json`, `${ROOT}/p`, `${ROOT}/p/pipe.report.json`, `${ROOT}/p/big.report.json`]) expect(await c.read(p)).toBe(null)
    expect(await c.isFile(`${ROOT}/p/d.report.json`)).toBe(false)
    expect(await c.isFile(`${ROOT}/alias/a.report.json`)).toBe(false)
    expect(await c.isFile(`${ROOT}/p`)).toBe(false)
    expect(await c.isFile(`${ROOT}/p/pipe.report.json`)).toBe(false)
    // Whatever its size, a regular file is a file; the cap belongs to reading.
    expect(await c.isFile(`${ROOT}/p/big.report.json`)).toBe(true)
  })
  test('a missing root or a missing file reads nothing', async () => {
    const noRoot = fakeDisk({ '/elsewhere/p/a.md': 'x' })
    expect(await confinedTo(ROOT, noRoot.fs).read(`${ROOT}/p/a.md`)).toBe(null)
    const disk = fakeDisk(seed())
    expect(await confinedTo(ROOT, disk.fs).read(`${ROOT}/p/missing.md`)).toBe(null)
  })
  test('a smaller cap is held, by the stated size and by what was read', async () => {
    const disk = fakeDisk({ '/r/p/a.md': '0123456789', '/r/p/grew.md': { text: 'longer than it said', size: 1 } })
    const c = confinedTo('/r', disk.fs)
    expect(await c.read('/r/p/a.md', 10)).toBe('0123456789')
    expect(await c.read('/r/p/a.md', 9)).toBe(null)
    expect(await c.read('/r/p/grew.md', 4)).toBe(null)
    for (const cap of [Number.NaN, -1, Number.POSITIVE_INFINITY]) expect(await c.read('/r/p/a.md', cap)).toBe(null)
  })
})

describe('the read race: what is checked is what is read', () => {
  const FILE = `${ROOT}/p/a.report.json`
  const SECRET = '/Users/someone/.ssh/id_ed25519'

  test('the leaf swapped for a link out of the root after the check: nothing is read', async () => {
    const disk = fakeDisk(seed())
    disk.at('checked', () => disk.put('/real/records/p/a.report.json', { link: SECRET }))
    const c = confinedTo(ROOT, disk.fs)
    expect(await c.read(FILE)).toBe(null)
    expect(await c.isFile(FILE)).toBe(false)
    // The condition is real: a read by pathname at this moment follows the link out.
    expect(disk.readByPath(FILE)).toBe('SECRET')
    expect(disk.opened).toEqual([])
  })
  test('the leaf swapped for a link after it was opened: the descriptor no longer matches the path, nothing is returned', async () => {
    const disk = fakeDisk(seed())
    disk.at('opened', () => disk.put('/real/records/p/a.report.json', { link: SECRET }))
    expect(await confinedTo(ROOT, disk.fs).read(FILE)).toBe(null)
  })
  test('the folder swapped for a link out of the root after the check: the outside file is opened, and refused', async () => {
    const disk = fakeDisk({ ...seed(), '/Users/someone/a.report.json': 'OUTSIDE' })
    disk.at('checked', () => {
      disk.move('/real/records/p', '/real/records/p-moved')
      disk.put('/real/records/p', { link: '/Users/someone' })
    })
    const c = confinedTo(ROOT, disk.fs)
    expect(await c.read(FILE)).toBe(null)
    expect(await c.isFile(FILE)).toBe(false)
    expect(disk.readByPath(FILE)).toBe('OUTSIDE')
    // The open did land outside: only the checks after it stop the content.
    expect(disk.opened).toEqual(['/Users/someone/a.report.json', '/Users/someone/a.report.json'])
  })
  test('the folder swapped out for the open and back in before the last check: the path names another file, refused', async () => {
    const disk = fakeDisk({ ...seed(), '/Users/someone/a.report.json': 'OUTSIDE' })
    disk.at('checked', () => {
      disk.move('/real/records/p', '/real/records/p-moved')
      disk.put('/real/records/p', { link: '/Users/someone' })
    })
    disk.at('read', () => {
      disk.remove('/real/records/p')
      disk.move('/real/records/p-moved', '/real/records/p')
    })
    expect(await confinedTo(ROOT, disk.fs).read(FILE)).toBe(null)
    expect(disk.opened).toEqual(['/Users/someone/a.report.json'])
  })
  test('an ancestor above the folder swapped for a link: refused', async () => {
    const disk = fakeDisk({ '/r/app/round/a.report.json': 'IN', '/out/round/a.report.json': 'OUTSIDE' })
    disk.at('checked', () => {
      disk.move('/r/app', '/r/app-moved')
      disk.put('/r/app', { link: '/out' })
    })
    expect(await confinedTo('/r', disk.fs).read('/r/app/round/a.report.json')).toBe(null)
  })
  test('the root itself re-pointed during the read: refused', async () => {
    const disk = fakeDisk({ ...seed(), '/other/records/p/a.report.json': 'OTHER' })
    disk.at('opened', () => disk.put(ROOT, { link: '/other/records' }))
    expect(await confinedTo(ROOT, disk.fs).read(FILE)).toBe(null)
  })
  test('the file replaced by another regular file during the read reads as could-not-read, and reads again afterwards', async () => {
    const disk = fakeDisk(seed())
    disk.at('opened', () => disk.put('/real/records/p/a.report.json', '{"ok":2}'))
    const c = confinedTo(ROOT, disk.fs)
    expect(await c.read(FILE)).toBe(null)
    disk.at('opened', () => undefined)
    expect(await c.read(FILE)).toBe('{"ok":2}')
  })
  test('a file with a second name (a hard link) reads nothing, whether the other name is outside the root or inside it', async () => {
    const disk = fakeDisk({ ...seed(), '/Users/someone/notes.txt': 'OUTSIDE' })
    const c = confinedTo(ROOT, disk.fs)
    // The outside file is given a name inside the records folder.
    disk.hardLink('/Users/someone/notes.txt', '/real/records/p/linked.report.json')
    // The condition is real: the name is a regular file, and a read by pathname returns the outside content.
    expect(disk.readByPath(`${ROOT}/p/linked.report.json`)).toBe('OUTSIDE')
    expect(await c.read(`${ROOT}/p/linked.report.json`)).toBe(null)
    expect(await c.isFile(`${ROOT}/p/linked.report.json`)).toBe(false)
    // A record given a second name inside the folder is refused under both names.
    expect(await c.read(FILE)).not.toBe(null)
    disk.hardLink('/real/records/p/a.report.json', '/real/records/p/copy.report.json')
    expect(await c.read(FILE)).toBe(null)
    expect(await c.read(`${ROOT}/p/copy.report.json`)).toBe(null)
  })
  test('a host with no bound read reads nothing and vouches for no file', async () => {
    const disk = fakeDisk(seed(), { hasBound: false })
    const c = confinedTo(ROOT, disk.fs)
    expect(await c.read(FILE)).toBe(null)
    expect(await c.isFile(FILE)).toBe(false)
    // Folders are still found: the scan lists, and reads nothing.
    expect(await c.dir(`${ROOT}/p`)).toBe('/real/records/p')
  })
  test('a bound read that fails or throws reads nothing', async () => {
    const stat = fakeDisk(seed()).fs.stat
    expect(await confinedTo(ROOT, { stat, bound: async () => null }).read(FILE)).toBe(null)
    expect(await confinedTo(ROOT, { stat, bound: async () => Promise.reject(new Error('no such program')) }).read(FILE)).toBe(null)
  })
})

describe('the facts of a bound read are judged strictly', () => {
  const good: BoundFacts = {
    rootBefore: '/real/records',
    parentBefore: '/real/records/p',
    opened: { kind: 'file', dev: '1', ino: '7', size: 3, nlink: 1 },
    bytes: 3,
    text: 'abc',
    rootAfter: '/real/records',
    parentAfter: '/real/records/p',
    leaf: { kind: 'file', dev: '1', ino: '7' },
  }
  const parent = (root: string) => `${root}/p`
  test('the facts as the helper reports an untouched file hold', () => {
    expect(boundFactsHold(good, parent)).toBe(true)
  })
  test('any one difference fails', () => {
    const bad: Array<Partial<BoundFacts> | null> = [
      null,
      { rootBefore: 'real/records' },
      { rootAfter: '/other' },
      { rootAfter: null },
      { parentBefore: '/real/records/q' },
      { parentAfter: '/Users/someone' },
      { parentAfter: null },
      { opened: { ...good.opened, kind: 'dir' } },
      { opened: { ...good.opened, kind: 'other' } },
      { opened: { ...good.opened, size: Number.NaN } },
      { opened: { ...good.opened, ino: '' } },
      { opened: { ...good.opened, dev: 'x' } },
      { opened: { ...good.opened, nlink: 2 } },
      { opened: { ...good.opened, nlink: 0 } },
      { opened: { ...good.opened, nlink: Number.NaN } },
      { opened: { kind: 'file', dev: '1', ino: '7', size: 3 } as BoundFacts['opened'] },
      { leaf: null },
      { leaf: { kind: 'link', dev: '1', ino: '7' } },
      { leaf: { kind: 'file', dev: '1', ino: '8' } },
      { leaf: { kind: 'file', dev: '2', ino: '7' } },
    ]
    for (const over of bad) expect(boundFactsHold(over === null ? null : { ...good, ...over }, parent)).toBe(false)
  })
})

describe('toast text', () => {
  test('terminal escapes and bidi overrides are neutralised, length capped', () => {
    expect(plain('a\u001b]0;title\u0007b')).toBe('a ]0;title b')
    expect(plain('x‮evil')).toBe('x evil')
    expect(plain('y'.repeat(300)).length).toBe(200)
  })
})
