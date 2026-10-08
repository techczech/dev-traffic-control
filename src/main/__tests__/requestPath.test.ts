import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { confineRequestPath } from '../requestPath'

async function fixture(): Promise<{ root: string; request: string; outside: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), 'dtc-request-path-'))
  const root = path.join(parent, 'records')
  const request = path.join(root, 'alpha', 'request.md')
  const outside = path.join(parent, 'outside.md')
  await mkdir(path.dirname(request), { recursive: true })
  await writeFile(request, '# Request\n')
  await writeFile(outside, '# Outside\n')
  return { root, request, outside }
}

describe('confineRequestPath', () => {
  test('returns the authoritative scanned path for an in-root request', async () => {
    const { root, request } = await fixture()
    await expect(confineRequestPath(root, [request], request)).resolves.toBe(request)
    await expect(confineRequestPath(root, [request], 'alpha/request.md')).resolves.toBe(request)
  })

  test('rejects parent traversal and an absolute path outside the record root', async () => {
    const { root, request, outside } = await fixture()
    await expect(confineRequestPath(root, [request], '../outside.md')).rejects.toThrow(
      /outside the record root/i
    )
    await expect(confineRequestPath(root, [request], outside)).rejects.toThrow(
      /outside the record root/i
    )
  })

  test('rejects a symlink that escapes the record root even if named as scanned', async () => {
    const { root, outside } = await fixture()
    const escaped = path.join(root, 'alpha', 'escaped.md')
    await symlink(outside, escaped)

    await expect(confineRequestPath(root, [escaped], escaped)).rejects.toThrow(
      /outside the record root/i
    )
  })

  test('rejects unscanned paths and non-Markdown paths', async () => {
    const { root, request } = await fixture()
    const unscanned = path.join(root, 'alpha', 'unscanned.md')
    const json = path.join(root, 'alpha', 'request.report.json')
    await writeFile(unscanned, '# Unscanned\n')
    await writeFile(json, '{}\n')

    await expect(confineRequestPath(root, [request], unscanned)).rejects.toThrow(
      /existing scanned request/i
    )
    await expect(confineRequestPath(root, [request], json)).rejects.toThrow(/must end in \.md/i)
  })
})
