/** Invented records for the tests, in the shapes the app writes, and the in-memory stand-ins the tests share (a disk, a store, a lock). `example-app` is not a real project. */

import type { BoundFacts, BoundRequest, ConfineFs, ConfineStat } from './guard'

export const lightReport = JSON.stringify({
  id: 'example-app-0.4.0-export-button',
  title: 'The export button on the list toolbar',
  app: 'Example App',
  version: '0.4.0-preview.2',
  startedAt: '2026-01-15T09:11:24.079Z',
  noteFiles: [],
  mode: 'light',
  items: [{ id: 'export-button', title: 'The export button', status: 'pass', comment: '', flagged: [], quotes: [], screenshots: [] }],
  observations: [
    {
      id: 'obs-1',
      text: 'Slow first open',
      screenshots: ['a.png'],
      markups: [{ picture: 'a.png', marked: 'a-marked.png', notes: 'picture', marks: [{ n: 1, shape: 'text', at: { x: 0.2, y: 0.3 }, text: 'spinner sits here for two seconds' }] }],
    },
  ],
  completedAt: '2026-01-15T09:11:31.520Z',
})

export const docReviewReport = JSON.stringify({
  id: '2026-01-12-review-sign-in-journeys',
  title: 'Example App sign-in: pick a layout per screen',
  app: 'Example App',
  startedAt: '2026-01-12T13:02:37.294Z',
  noteFiles: [],
  items: [
    {
      id: 'document',
      title: 'Example App sign-in: pick a layout per screen',
      status: 'pass',
      comment: '',
      flagged: [],
      quotes: [],
      screenshots: [],
      decisions: [
        { id: 'sign-in-home', question: 'Sign-in screen: which layout?', choice: 'Layout A' },
        {
          id: 'reset',
          question: 'Password reset?',
          choice: 'Layout B',
          comment: 'b as the default',
          markups: [
            {
              picture: 'layout-b.png',
              marked: 'layout-b-marked.png',
              option: 'Layout B',
              marks: [
                { n: 1, shape: 'box', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 }, text: 'make this the primary button' },
                { n: 2, shape: 'arrow', from: { x: 0.8, y: 0.8 }, to: { x: 0.6, y: 0.5 }, text: '' },
              ],
            },
          ],
        },
        { id: 'open', question: 'Undecided one?', choice: '' },
      ],
    },
  ],
  completedAt: '2026-01-12T13:06:44.867Z',
})

export const detailedReport = JSON.stringify({
  id: 'x',
  title: 'Detailed',
  items: [
    {
      id: 'a',
      title: 'A',
      status: 'partial',
      comment: 'drifts',
      flagged: [{ expectedIndex: 1, text: 'Sidebar 30%', comment: 'Drops to 24%' }],
      quotes: [{ text: 'no clipping', comment: 'held' }],
      screenshots: ['s1.png', 's2.png'],
      markups: [{ picture: 's1.png', marked: 'm.png', notes: 'list', marks: [{ n: 1, shape: 'box', box: { x: 0, y: 0, w: 0.3, h: 1 }, text: 'sidebar too narrow' }, 'not a mark', { shape: 'text' }] }],
    },
    { id: 'b', title: 'B', status: 'fail' },
    { id: 'c', title: 'C', status: 'skip' },
    { id: 'd', title: 'D' },
    { id: 'e', title: 'E', status: 'pass', removed: true },
  ],
  completedAt: '2026-01-10T12:40:00.000Z',
})

export const inProgressReport = JSON.stringify({ id: 'y', title: 'Moving', items: [{ id: 'a', title: 'A', status: 'unanswered' }], startedAt: '2026-01-15T07:00:00Z' })

/** A feature request whose last entry is the reviewer's: an answer waiting for the agent. */
export const ideaWaiting = `---
id: export-keeps-filters
title: Export keeps the active filters
tier: functionality
added: 2026-01-15
by: reviewer
said:
  where: a test request
  when: 2026-01-15
quote: "the export ignores my filters"
plan: Apply the active filters when exporting.
fate: planned
candidate: 0.5.0
---

Exporting a filtered list wrote every row.

## Agent entry · 2026-01-16

Proposed: apply the filters on screen; aimed at 0.5.0.

## Reviewer entry · 2026-01-17 · Approved for the roadmap

Yes, and keep the sort order too.
`

/** The same idea once the agent has answered: nothing waiting. */
export const ideaAnswered = `${ideaWaiting}
## Agent entry · 2026-01-18

Sort order is kept as well.
`

/** A reviewer entry whose heading carries a date and no answer. */
export const ideaDateOnly = `---
id: quieter-toasts
title: "Quieter toasts"
fate: sometime
---

## Reviewer entry · 2026-01-20
`

export const releaseAnswers = JSON.stringify({
  app: 'Example App',
  release: '0.4.0',
  answers: [
    { id: 'pdf-export', verdict: 'works', comment: '', at: '2026-01-20T10:00:00.000Z' },
    { id: 'export-settings', verdict: 'off', comment: 'The page size is ignored.', at: '2026-01-20T10:05:00.000Z', screenshots: ['releases/0.4.0.shots/export-settings-1.png', '../../outside.png', '/etc/passwd', 'releases/0.4.0.shots/gone.png'] },
    { id: 'old-feature', verdict: 'works', comment: '', at: '2026-01-19T08:00:00.000Z', removed: true },
    { id: 'no-verdict', verdict: 'maybe', comment: '', at: '2026-01-20T11:00:00.000Z' },
    'junk',
  ],
})

type DiskNode = { ino: number; nlink?: number } & ({ kind: 'file'; text: string; size?: number } | { kind: 'dir' } | { kind: 'link'; to: string } | { kind: 'other' })

/** What a fake disk starts with, by absolute path: a file's text, a link's target, a folder, a pipe, or a file whose stated size differs from its text. */
export type DiskSeed = Record<string, string | { link: string } | 'dir' | 'other' | { text: string; size: number }>

/** A moment inside one bound read at which a test may change the disk: after the folder was checked, after the leaf was opened, after its content was read. */
export type DiskStep = 'checked' | 'opened' | 'read'

/**
 * An in-memory disk with folders, files and symbolic links, each with its own inode. `fs.bound`
 * does what the helper does, in the same order, against it: resolve, open the leaf without
 * following a link, identify and read the opened node (never the path again), resolve again,
 * `lstat`. `at` lets a test swap things between those moments, which is what a process writing
 * in the folder could do.
 */
export function fakeDisk(seed: DiskSeed, options: { hasBound?: boolean } = {}) {
  const nodes = new Map<string, DiskNode>()
  let nextIno = 100
  const hooks: Partial<Record<DiskStep, () => void>> = {}
  /** Every path a bound read opened, as the open resolved it. */
  const opened: string[] = []

  const put = (path: string, value: DiskSeed[string]): void => {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      const dir = `/${parts.slice(0, i).join('/')}`
      if (!nodes.has(dir)) nodes.set(dir, { kind: 'dir', ino: nextIno++ })
    }
    const ino = nextIno++
    if (value === 'dir') nodes.set(path, { kind: 'dir', ino })
    else if (value === 'other') nodes.set(path, { kind: 'other', ino })
    else if (typeof value === 'string') nodes.set(path, { kind: 'file', text: value, ino })
    else if ('link' in value) nodes.set(path, { kind: 'link', to: value.link, ino })
    else nodes.set(path, { kind: 'file', text: value.text, size: value.size, ino })
  }
  for (const [path, value] of Object.entries(seed)) put(path, value)

  /** The real path of `path`, every link followed; null when it leads nowhere. */
  const resolve = (path: string, depth = 0): string | null => {
    if (depth > 20) return null
    let real = ''
    const parts = path.split('/').filter(Boolean)
    for (let i = 0; i < parts.length; i++) {
      const next = `${real}/${parts[i] as string}`
      const node = nodes.get(next)
      if (node === undefined) return null
      if (node.kind === 'link') return resolve(`${node.to}${parts.slice(i + 1).map(p => `/${p}`).join('')}`, depth + 1)
      real = next
    }
    return real === '' ? '/' : real
  }
  /** The node at `folder/name`, the folder's links followed and the leaf's not. */
  const leafOf = (folder: string, name: string): { node: DiskNode; path: string } | null => {
    const real = resolve(folder)
    if (real === null) return null
    const path = `${real === '/' ? '' : real}/${name}`
    const node = nodes.get(path)
    return node === undefined ? null : { node, path }
  }
  const sizeOf = (node: DiskNode): number => (node.kind === 'file' ? (node.size ?? node.text.length) : 0)

  const stat = async (path: string): Promise<ConfineStat | null> => {
    const own = nodes.get(path) ?? (() => {
      const cut = path.lastIndexOf('/')
      return leafOf(path.slice(0, cut) || '/', path.slice(cut + 1))?.node
    })()
    const real = resolve(path)
    if (own === undefined) return null
    const target = real === null ? undefined : nodes.get(real)
    const kind = target === undefined ? 'other' : target.kind === 'file' ? 'file' : target.kind === 'dir' ? 'dir' : 'other'
    return { kind, ...(target === undefined ? {} : { size: sizeOf(target) }), ...(own.kind === 'link' ? { isLink: true } : {}), ...(real === null ? {} : { realPath: real }) }
  }

  const bound = async (req: BoundRequest): Promise<BoundFacts | null> => {
    const rootBefore = resolve(req.root)
    const parentBefore = resolve(req.parent)
    if (rootBefore === null || parentBefore === null) return null
    hooks.checked?.()
    const found = leafOf(req.parent, req.name)
    // No-follow: a link at the leaf is not opened.
    if (found === null || found.node.kind === 'link') return null
    const node = found.node
    opened.push(found.path)
    const kind = node.kind === 'file' ? 'file' : node.kind === 'dir' ? 'dir' : 'other'
    const size = sizeOf(node)
    hooks.opened?.()
    const isInside = parentBefore === rootBefore || parentBefore.startsWith(`${rootBefore === '/' ? '' : rootBefore}/`)
    const may = req.wantText && isInside && node.kind === 'file' && (node.nlink ?? 1) === 1 && size <= req.maxBytes
    // Read from the node the open returned, whatever the path names by now.
    const content = may && node.kind === 'file' ? node.text : ''
    const hasText = may && content.length <= req.maxBytes
    hooks.read?.()
    const after = leafOf(req.parent, req.name)
    return {
      rootBefore,
      parentBefore,
      opened: { kind, dev: '1', ino: String(node.ino), size, nlink: node.nlink ?? 1 },
      bytes: content.length,
      text: hasText ? content : null,
      rootAfter: resolve(req.root),
      parentAfter: resolve(req.parent),
      leaf: after === null ? null : { kind: after.node.kind, dev: '1', ino: String(after.node.ino) },
    }
  }

  const fs: ConfineFs = options.hasBound === false ? { stat } : { stat, bound }
  return {
    fs,
    opened,
    /** Runs `change` at that moment of the next bound reads. */
    at: (step: DiskStep, change: () => void): void => void (hooks[step] = change),
    /** Creates or replaces what is at `path` (a new inode). */
    put,
    remove: (path: string): void => void nodes.delete(path),
    /** Gives the file at `from` a second name at `to` (a hard link: the same node, its link count raised). `from` may be anywhere on the disk. */
    hardLink: (from: string, to: string): void => {
      const node = nodes.get(from)
      if (node === undefined) return
      node.nlink = (node.nlink ?? 1) + 1
      nodes.set(to, node)
    },
    /** Moves a node (and, for a folder, everything under it), keeping inodes. */
    move: (from: string, to: string): void => {
      for (const [path, node] of [...nodes]) {
        if (path !== from && !path.startsWith(`${from}/`)) continue
        nodes.delete(path)
        nodes.set(`${to}${path.slice(from.length)}`, node)
      }
    },
    /** What a read by pathname would return right now, links followed: the read the mod no longer makes. */
    readByPath: (path: string): string | null => {
      const real = resolve(path)
      const node = real === null ? undefined : nodes.get(real)
      return node !== undefined && node.kind === 'file' ? node.text : null
    },
  }
}
