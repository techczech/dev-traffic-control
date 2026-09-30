import { expect, test } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { notePathFor, parseNote, serialiseNote } from '../note'
import { nextShotPath, saveShot, shotsDirFor } from '../shots'

test('note path convention', () => {
  expect(notePathFor('/qa/tallyboard', '2026-07-18', 'title-ideas')).toBe(
    '/qa/tallyboard/2026-07-18-note-title-ideas.md'
  )
})

test('note round-trips: frontmatter, body, shots, hand-over stamp', () => {
  const raw = serialiseNote({
    title: 'Title ideas',
    body: 'The sidebar could carry the deck logo.',
    linkedRun: '2026-07-18-title-padding-0.18.13.md',
    handedOverAt: '2026-07-18T12:00:00.000Z',
    shots: ['2026-07-18-note-title-ideas.shots/idea-1.png']
  })
  const n = parseNote(raw)
  expect(n.title).toBe('Title ideas')
  expect(n.handedOverAt).toBe('2026-07-18T12:00:00.000Z')
  expect(n.linkedRun).toContain('title-padding')
  expect(n.shots).toHaveLength(1)
  expect(n.body).toContain('deck logo')
})

test('draft note has no handedOverAt line', () => {
  const raw = serialiseNote({ title: 'T', body: 'b', shots: [] })
  expect(raw).not.toContain('handedOverAt')
})

test('shot naming increments per item', () => {
  const dir = shotsDirFor('/qa/p/2026-07-18-run')
  expect(dir).toBe('/qa/p/2026-07-18-run.shots')
  expect(nextShotPath(dir, 'alpha', [])).toBe(path.join(dir, 'alpha-1.png'))
  expect(nextShotPath(dir, 'alpha', ['alpha-1.png', 'alpha-2.png'])).toBe(
    path.join(dir, 'alpha-3.png')
  )
})

test('saveShot writes bytes and refuses empty buffers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'shots-'))
  const p = path.join(dir, 'a-1.png')
  await saveShot(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  expect((await stat(p)).size).toBe(4)
  await expect(saveShot(path.join(dir, 'a-2.png'), Buffer.alloc(0))).rejects.toThrow(/empty/i)
})

test('saveShot never follows a symlink planted at the chosen name; it takes the next number', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'qa-shot-symlink-'))
  const dir = path.join(parent, 'x.shots')
  const victim = path.join(parent, 'victim.txt')
  await writeFile(victim, 'untouched')
  // Chosen before the plant, as a racing attacker would see it.
  const chosen = nextShotPath(dir, 'note', [])
  await mkdir(dir, { recursive: true })
  await symlink(victim, chosen)

  const written = await saveShot(chosen, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  expect(await readFile(victim, 'utf8')).toBe('untouched')
  expect(written).toBe(path.join(dir, 'note-2.png'))
  expect((await lstat(written)).isFile()).toBe(true)
})

test('saveShot fails cleanly when an unnumbered name is taken', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-shot-taken-'))
  const taken = path.join(dir, 'shot.png')
  await writeFile(taken, 'existing')
  await expect(saveShot(taken, Buffer.from([1]))).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(taken, 'utf8')).toBe('existing')
})
