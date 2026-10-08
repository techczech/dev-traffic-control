import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { confineRecordPath } from '../requestPath'

/**
 * The second gate a `dtc://` link passes, and the one that decides between the
 * two states held apart: confined-but-absent is the records folder not
 * having synced yet, refused is a link turned away. A test that collapsed them would let
 * the app teach the reviewer to ignore refusals.
 */
async function fixture(): Promise<{ root: string; parent: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), 'dtc-record-path-'))
  const root = path.join(parent, 'records')
  await mkdir(path.join(root, 'windmill-desktop', 'releases'), { recursive: true })
  await writeFile(path.join(root, 'windmill-desktop', 'request.md'), '# Request\n')
  await writeFile(path.join(root, 'windmill-desktop', 'releases', '0.21.0.md'), '# Release\n')
  await writeFile(path.join(parent, 'secret.md'), '# Outside\n')
  await mkdir(path.join(parent, 'elsewhere'), { recursive: true })
  return { root, parent }
}

describe('a path that confines', () => {
  test('resolves a record inside the root and says it is here', async () => {
    const { root } = await fixture()
    await expect(confineRecordPath(root, 'windmill-desktop/request.md')).resolves.toEqual({
      kind: 'confined',
      path: path.join(await realRoot(root), 'windmill-desktop', 'request.md'),
      exists: true
    })
  })

  test('resolves a nested record and a project folder', async () => {
    const { root } = await fixture()
    await expect(
      confineRecordPath(root, 'windmill-desktop/releases/0.21.0.md')
    ).resolves.toMatchObject({ kind: 'confined', exists: true })
    await expect(confineRecordPath(root, 'windmill-desktop')).resolves.toMatchObject({
      kind: 'confined',
      exists: true
    })
  })
})

describe('a path that confines but is not here yet', () => {
  test('a missing record inside the root is absent, not refused', async () => {
    const { root } = await fixture()
    await expect(
      confineRecordPath(root, 'windmill-desktop/2026-09-13-not-synced.md')
    ).resolves.toMatchObject({ kind: 'confined', exists: false })
  })

  test('a missing project folder is absent, not refused', async () => {
    const { root } = await fixture()
    await expect(confineRecordPath(root, 'a-project-not-pulled-yet')).resolves.toMatchObject({
      kind: 'confined',
      exists: false
    })
  })

  test('a record under a folder that has not arrived is absent, not refused', async () => {
    const { root } = await fixture()
    await expect(
      confineRecordPath(root, 'unpulled-project/threads/a-thread.md')
    ).resolves.toMatchObject({ kind: 'confined', exists: false })
  })
})

describe('a path that is refused', () => {
  test.each([
    ['parent traversal', '../secret.md'],
    ['traversal from inside a project', 'windmill-desktop/../../secret.md'],
    ['a dot segment', './windmill-desktop/request.md'],
    ['a backslash-separated traversal', 'windmill-desktop\\..\\..\\secret.md'],
    ['an empty path', '']
  ])('refuses %s', async (_case, supplied) => {
    const { root } = await fixture()
    await expect(confineRecordPath(root, supplied)).resolves.toEqual({ kind: 'refused' })
  })

  test('refuses an absolute path, even one inside the root', async () => {
    const { root, parent } = await fixture()
    await expect(confineRecordPath(root, path.join(parent, 'secret.md'))).resolves.toEqual({
      kind: 'refused'
    })
    await expect(
      confineRecordPath(root, path.join(root, 'windmill-desktop', 'request.md'))
    ).resolves.toEqual({ kind: 'refused' })
  })

  test('refuses a symlink that leaves the root', async () => {
    const { root, parent } = await fixture()
    await symlink(path.join(parent, 'secret.md'), path.join(root, 'windmill-desktop', 'escape.md'))
    await expect(confineRecordPath(root, 'windmill-desktop/escape.md')).resolves.toEqual({
      kind: 'refused'
    })
  })

  test('refuses a symlinked FOLDER that leaves the root, even when the leaf does not exist', async () => {
    // The case a leaf-only realpath cannot see. The leaf's ENOENT looks exactly
    // like a record that has not synced yet, so an escape would be reported as
    // the records folder not having synced yet — amber, with a retry that pulls and tries again.
    const { root, parent } = await fixture()
    await symlink(path.join(parent, 'elsewhere'), path.join(root, 'out'), 'dir')
    await expect(confineRecordPath(root, 'out/anything.md')).resolves.toEqual({ kind: 'refused' })
    await expect(confineRecordPath(root, 'out')).resolves.toEqual({ kind: 'refused' })
  })

  test('refuses everything when the record root itself does not resolve', async () => {
    const { parent } = await fixture()
    await expect(
      confineRecordPath(path.join(parent, 'no-such-root'), 'project/record.md')
    ).resolves.toEqual({ kind: 'refused' })
  })
})

async function realRoot(root: string): Promise<string> {
  const { realpath } = await import('node:fs/promises')
  return realpath(root)
}
