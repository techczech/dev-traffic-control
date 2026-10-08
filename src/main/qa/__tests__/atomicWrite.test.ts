import { lstat, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { atomicWrite } from '../atomicWrite'

let dir: string
let target: string
let victim: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dtc-atomic-write-'))
  await mkdir(path.join(dir, 'record'))
  await mkdir(path.join(dir, 'elsewhere'))
  target = path.join(dir, 'record', 'report.json')
  victim = path.join(dir, 'elsewhere', 'victim.txt')
  await writeFile(victim, 'untouched')
})

describe('atomicWrite', () => {
  test('writes the file and leaves no temp file behind', async () => {
    await atomicWrite(target, 'first')
    await atomicWrite(target, 'second')
    expect(await readFile(target, 'utf8')).toBe('second')
    expect(await readdir(path.dirname(target))).toEqual(['report.json'])
  })

  test('a symlink planted at the old predictable temp name redirects nothing', async () => {
    // The pre-fix writer used `<p>.tmp-<pid>`; an attacker who knows the pid
    // plants a symlink there. The write must neither follow it nor leave the
    // target itself a symlink.
    await symlink(victim, `${target}.tmp-${process.pid}`)

    await atomicWrite(target, 'record data')

    expect(await readFile(victim, 'utf8')).toBe('untouched')
    expect((await lstat(target)).isSymbolicLink()).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('record data')
  })

  test('a failed write removes its temp file and rethrows', async () => {
    // Renaming a file over a non-empty directory fails after the temp is written.
    await mkdir(target)
    await writeFile(path.join(target, 'occupied'), 'x')

    await expect(atomicWrite(target, 'data')).rejects.toBeDefined()

    expect(await readdir(path.dirname(target))).toEqual(['report.json'])
  })
})
