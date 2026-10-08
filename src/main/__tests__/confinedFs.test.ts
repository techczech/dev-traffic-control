import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  ConfinementError,
  ensureConfinedDir,
  listConfined,
  overwriteConfined,
  readConfined,
  readConfinedText,
  recordRelative,
  recordTarget,
  removeConfinedTree,
  renameConfinedExclusive,
  writeConfinedAtomic
} from '../confinedFs'

let parent: string
let root: string
let outside: string

beforeEach(async () => {
  parent = realpathSync(await mkdtemp(path.join(tmpdir(), 'dtc-confined-fs-')))
  root = path.join(parent, 'records')
  outside = path.join(parent, 'elsewhere')
  await mkdir(path.join(root, 'example-app', 'roadmap'), { recursive: true })
  await mkdir(outside)
  await writeFile(path.join(outside, 'private.md'), 'outside text')
})

afterEach(async () => {
  await rm(parent, { recursive: true, force: true })
})

const refusal = (reason: string): object => expect.objectContaining({ code: 'ECONFINED', reason })

/** Names left in a folder, so a refused write can be shown to leave nothing. */
const names = async (dir: string): Promise<string[]> => (await readdir(dir)).sort()

describe('readConfined', () => {
  test('reads a regular file below the root, whole or only its head', async () => {
    await writeFile(path.join(root, 'example-app', 'idea.md'), 'first line\nsecond line\n')

    expect(await readConfinedText(root, 'example-app/idea.md')).toBe('first line\nsecond line\n')
    expect((await readConfined(root, 'example-app/idea.md', { head: 5 })).toString()).toBe('first')
  })

  test('a missing file is ENOENT, not a refusal', async () => {
    await expect(readConfined(root, 'example-app/absent.md')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  test('refuses a path that is not plain names below the root', async () => {
    for (const rel of [
      '',
      '../elsewhere/private.md',
      'example-app/../../x',
      '/etc/hosts',
      'a//b'
    ]) {
      await expect(readConfined(root, rel)).rejects.toEqual(refusal('invalid-path'))
    }
  })

  test('refuses a symlinked file, wherever it points', async () => {
    await symlink(path.join(outside, 'private.md'), path.join(root, 'example-app', 'out.md'))
    await writeFile(path.join(root, 'example-app', 'real.md'), 'inside text')
    await symlink(
      path.join(root, 'example-app', 'real.md'),
      path.join(root, 'example-app', 'in.md')
    )

    await expect(readConfined(root, 'example-app/out.md')).rejects.toEqual(refusal('symlink'))
    await expect(readConfined(root, 'example-app/in.md')).rejects.toEqual(refusal('symlink'))
  })

  test('refuses a file below a symlinked folder, outside the root or within it', async () => {
    await symlink(outside, path.join(root, 'linked-out'))
    await writeFile(path.join(root, 'example-app', 'roadmap', 'idea.md'), 'inside text')
    await symlink(path.join(root, 'example-app', 'roadmap'), path.join(root, 'linked-in'))

    await expect(readConfined(root, 'linked-out/private.md')).rejects.toEqual(refusal('symlink'))
    await expect(readConfined(root, 'linked-in/idea.md')).rejects.toEqual(refusal('symlink'))
  })

  test('refuses a file with a second name, outside the root or within it', async () => {
    await link(path.join(outside, 'private.md'), path.join(root, 'example-app', 'out.md'))
    await writeFile(path.join(root, 'example-app', 'real.md'), 'inside text')
    await link(path.join(root, 'example-app', 'real.md'), path.join(root, 'example-app', 'in.md'))

    for (const rel of ['example-app/out.md', 'example-app/in.md', 'example-app/real.md']) {
      await expect(readConfined(root, rel)).rejects.toEqual(refusal('multiply-linked'))
      await expect(readConfined(root, rel, { head: 4 })).rejects.toEqual(refusal('multiply-linked'))
    }
  })

  test('reads a file again once its second name is gone', async () => {
    const file = path.join(root, 'example-app', 'real.md')
    await writeFile(file, 'inside text')
    await link(file, path.join(root, 'example-app', 'in.md'))
    await rm(path.join(root, 'example-app', 'in.md'))

    expect(await readConfinedText(root, 'example-app/real.md')).toBe('inside text')
  })

  test('refuses a file larger than the cap and reads one at the cap', async () => {
    await writeFile(path.join(root, 'example-app', 'big.md'), 'x'.repeat(11))

    await expect(readConfined(root, 'example-app/big.md', { maxBytes: 10 })).rejects.toEqual(
      refusal('too-large')
    )
    expect((await readConfined(root, 'example-app/big.md', { maxBytes: 11 })).length).toBe(11)
  })

  test('refuses a folder where a file should be', async () => {
    await expect(readConfined(root, 'example-app/roadmap')).rejects.toEqual(
      refusal('not-regular-file')
    )
  })

  test.skipIf(process.platform === 'win32')(
    'refuses a named pipe without waiting on it',
    async () => {
      execFileSync('mkfifo', [path.join(root, 'example-app', 'pipe.md')])

      await expect(readConfined(root, 'example-app/pipe.md')).rejects.toEqual(
        refusal('not-regular-file')
      )
    }
  )

  test('refuses when the folder is swapped for a link after the file is open', async () => {
    const folder = path.join(root, 'example-app')
    await writeFile(path.join(folder, 'idea.md'), 'inside text')

    await expect(
      readConfined(root, 'example-app/idea.md', {
        hooks: {
          afterOpen: async () => {
            await rename(folder, path.join(root, 'moved-away'))
            await symlink(outside, folder)
          }
        }
      })
    ).rejects.toEqual(refusal('moved'))
  })
})

describe('writeConfinedAtomic', () => {
  test('replaces a file through a temporary file and leaves no temporary behind', async () => {
    const file = path.join(root, 'example-app', 'idea.md')
    await writeFile(file, 'before')

    await writeConfinedAtomic(root, 'example-app/idea.md', 'after')

    expect(await readFile(file, 'utf8')).toBe('after')
    expect(await names(path.join(root, 'example-app'))).toEqual(['idea.md', 'roadmap'])
  })

  test('refuses a symlinked file and leaves its target as it was', async () => {
    const target = path.join(outside, 'private.md')
    await symlink(target, path.join(root, 'example-app', 'idea.md'))

    await expect(writeConfinedAtomic(root, 'example-app/idea.md', 'changed')).rejects.toEqual(
      refusal('symlink')
    )
    expect(await readFile(target, 'utf8')).toBe('outside text')
    expect(await names(path.join(root, 'example-app'))).toEqual(['idea.md', 'roadmap'])
  })

  test('refuses a symlinked folder, outside the root or within it, and writes nothing', async () => {
    await symlink(outside, path.join(root, 'linked-out'))
    await symlink(path.join(root, 'example-app'), path.join(root, 'linked-in'))

    await expect(writeConfinedAtomic(root, 'linked-out/new.md', 'x')).rejects.toEqual(
      refusal('symlink')
    )
    await expect(writeConfinedAtomic(root, 'linked-in/new.md', 'x')).rejects.toEqual(
      refusal('symlink')
    )
    await expect(
      writeConfinedAtomic(root, 'linked-out/sub/new.md', 'x', { makeDirs: true })
    ).rejects.toEqual(refusal('symlink'))
    expect(await names(outside)).toEqual(['private.md'])
    expect(await names(path.join(root, 'example-app'))).toEqual(['roadmap'])
  })

  test('refuses when the folder is swapped for a link between the check and the rename', async () => {
    const folder = path.join(root, 'example-app')
    const movedAway = path.join(root, 'moved-away')
    await writeFile(path.join(folder, 'idea.md'), 'before')

    await expect(
      writeConfinedAtomic(root, 'example-app/idea.md', 'after', {
        hooks: {
          beforeCommit: async () => {
            await rename(folder, movedAway)
            await symlink(outside, folder)
          }
        }
      })
    ).rejects.toEqual(refusal('moved'))

    // Nothing landed outside, the file kept its bytes, and the temporary
    // file written before the swap is not removed through the swapped name.
    expect(await names(outside)).toEqual(['private.md'])
    expect(await readFile(path.join(movedAway, 'idea.md'), 'utf8')).toBe('before')
  })

  test('refuses when the folder is replaced by another real folder before the rename', async () => {
    const folder = path.join(root, 'example-app')
    await writeFile(path.join(folder, 'idea.md'), 'before')

    await expect(
      writeConfinedAtomic(root, 'example-app/idea.md', 'after', {
        hooks: {
          beforeCommit: async () => {
            await rename(folder, path.join(root, 'moved-away'))
            await mkdir(folder)
          }
        }
      })
    ).rejects.toEqual(refusal('moved'))
    expect(await names(folder)).toEqual([])
  })

  test('exclusive creation never replaces and never follows a link at the name', async () => {
    const file = path.join(root, 'example-app', 'shot-1.png')
    await writeConfinedAtomic(root, 'example-app/shot-1.png', Buffer.from([1, 2]), {
      exclusive: true
    })
    await symlink(path.join(outside, 'planted.png'), path.join(root, 'example-app', 'shot-2.png'))

    await expect(
      writeConfinedAtomic(root, 'example-app/shot-1.png', Buffer.from([9]), { exclusive: true })
    ).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(
      writeConfinedAtomic(root, 'example-app/shot-2.png', Buffer.from([9]), { exclusive: true })
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect([...(await readFile(file))]).toEqual([1, 2])
    expect(await names(outside)).toEqual(['private.md'])
  })

  test('creates missing folders below the root only when asked', async () => {
    await expect(
      writeConfinedAtomic(root, 'new-app/roadmap/order.json', '{}')
    ).rejects.toMatchObject({ code: 'ENOENT' })

    await writeConfinedAtomic(root, 'new-app/roadmap/order.json', '{}', { makeDirs: true })

    expect(await readFile(path.join(root, 'new-app', 'roadmap', 'order.json'), 'utf8')).toBe('{}')
  })
})

describe('a file with a second name, on write', () => {
  test('an atomic replace puts a new file under the name and leaves the other name alone', async () => {
    const target = path.join(outside, 'private.md')
    await link(target, path.join(root, 'example-app', 'idea.md'))

    await writeConfinedAtomic(root, 'example-app/idea.md', 'changed')

    expect(await readFile(target, 'utf8')).toBe('outside text')
    expect(await readConfinedText(root, 'example-app/idea.md')).toBe('changed')
    expect(await names(path.join(root, 'example-app'))).toEqual(['idea.md', 'roadmap'])
  })
})

describe('overwriteConfined', () => {
  test('creates the file, then rewrites it in place', async () => {
    const file = path.join(root, 'example-app', 'probe.json')

    await overwriteConfined(root, 'example-app/probe.json', 'a longer first write')
    await overwriteConfined(root, 'example-app/probe.json', 'second')

    expect(await readFile(file, 'utf8')).toBe('second')
    expect(await names(path.join(root, 'example-app'))).toEqual(['probe.json', 'roadmap'])
  })

  test('refuses a file with a second name and changes no byte of it', async () => {
    const target = path.join(outside, 'private.md')
    await link(target, path.join(root, 'example-app', 'probe.json'))

    await expect(overwriteConfined(root, 'example-app/probe.json', 'changed')).rejects.toEqual(
      refusal('multiply-linked')
    )
    expect(await readFile(target, 'utf8')).toBe('outside text')
  })

  test('refuses a symlinked file, a symlinked folder and a folder at the name', async () => {
    const target = path.join(outside, 'private.md')
    await symlink(target, path.join(root, 'example-app', 'probe.json'))
    await symlink(outside, path.join(root, 'linked-out'))

    await expect(overwriteConfined(root, 'example-app/probe.json', 'changed')).rejects.toEqual(
      refusal('symlink')
    )
    await expect(overwriteConfined(root, 'linked-out/private.md', 'changed')).rejects.toEqual(
      refusal('symlink')
    )
    await expect(overwriteConfined(root, 'example-app/roadmap', 'changed')).rejects.toMatchObject({
      code: expect.stringMatching(/^(EISDIR|ECONFINED)$/)
    })
    expect(await readFile(target, 'utf8')).toBe('outside text')
  })
})

describe('folders', () => {
  test('lists a real folder and refuses a linked one', async () => {
    await writeFile(path.join(root, 'example-app', 'roadmap', 'idea.md'), 'x')
    await symlink(outside, path.join(root, 'example-app', 'linked'))

    expect((await listConfined(root, 'example-app/roadmap')).map((entry) => entry.name)).toEqual([
      'idea.md'
    ])
    await expect(listConfined(root, 'example-app/linked')).rejects.toBeInstanceOf(ConfinementError)
    await expect(ensureConfinedDir(root, 'example-app/linked/sub')).rejects.toEqual(
      refusal('symlink')
    )
    expect(await names(outside)).toEqual(['private.md'])
  })

  test('removes a real folder with the links inside it, never what they point to', async () => {
    await symlink(outside, path.join(root, 'example-app', 'roadmap', 'link'))
    await symlink(outside, path.join(root, 'linked'))

    await expect(removeConfinedTree(root, 'linked')).rejects.toBeInstanceOf(ConfinementError)
    await removeConfinedTree(root, 'example-app')

    expect(await names(root)).toEqual(['linked'])
    expect(await names(outside)).toEqual(['private.md'])
  })

  test('renames a regular file without replacing, and refuses a linked one', async () => {
    const folder = path.join(root, 'example-app')
    await writeFile(path.join(folder, 'a.json'), 'a')
    await writeFile(path.join(folder, 'taken.json'), 'taken')
    await symlink(path.join(outside, 'private.md'), path.join(folder, 'link.json'))

    await expect(
      renameConfinedExclusive(root, 'example-app/a.json', 'taken.json')
    ).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(renameConfinedExclusive(root, 'example-app/link.json', 'b.json')).rejects.toEqual(
      refusal('symlink')
    )
    await expect(renameConfinedExclusive(root, 'example-app/a.json', '../b.json')).rejects.toEqual(
      refusal('invalid-path')
    )
    await renameConfinedExclusive(root, 'example-app/a.json', 'b.json')

    expect(await names(folder)).toEqual(['b.json', 'link.json', 'roadmap', 'taken.json'])
    expect(await readFile(path.join(outside, 'private.md'), 'utf8')).toBe('outside text')
  })
})

describe('record paths', () => {
  test('an absolute path below the root becomes plain names; anything else is refused', async () => {
    expect(await recordRelative(root, path.join(root, 'example-app', 'idea.md'))).toBe(
      path.join('example-app', 'idea.md')
    )
    await expect(recordRelative(root, path.join(outside, 'private.md'))).rejects.toEqual(
      refusal('outside-root')
    )
    await expect(recordRelative(root, root)).rejects.toEqual(refusal('outside-root'))
    await expect(recordRelative(root, 'example-app/idea.md')).rejects.toEqual(
      refusal('invalid-path')
    )
  })

  test('without a records folder the file’s own folder stands in', async () => {
    const file = path.join(root, 'example-app', 'idea.md')

    expect(await recordTarget(file, root)).toEqual({
      root,
      rel: path.join('example-app', 'idea.md')
    })
    expect(await recordTarget(file)).toEqual({ root: path.dirname(file), rel: 'idea.md' })
  })
})
