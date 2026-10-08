// The mod never acts by itself: nothing in it submits a prompt or adds text to a turn. This reads
// the mod's own source and fails if any module reaches for the host's prompt-submit call, however
// it is spelled. It needs a real file system, so it runs with `npm test` (vitest), not under
// `claude plugin test`; hooks/session-flow.test.ts is the same promise checked in the host.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const MOD = fileURLToPath(new URL('..', import.meta.url))
const HOOKS = join(MOD, 'hooks')

/** Every module the host loads: the files in hooks/ that are not tests or test fixtures. */
const modules = readdirSync(HOOKS)
  .filter(name => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'fixtures.ts')
  .sort()

/** The source with comments taken out, so that prose about submitting is not mistaken for a call. */
const codeOf = (name: string): string =>
  readFileSync(join(HOOKS, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** Ways to reach a `submit` member: `x.submit`, `x?.submit`, `x['submit']`, a `submit(` call, a `submit:` key, a destructured `submit`. */
const SUBMIT = [/[.?]\s*submit\b/, /\[\s*['"`]submit['"`]\s*\]/, /\bsubmit\s*\(/, /\bsubmit\s*:/, /[{,]\s*submit\s*[,}]/]

describe('no module of the mod submits a prompt', () => {
  test('the mod has modules to check, the registering one among them', () => {
    expect(modules.length).toBeGreaterThan(15)
    expect(modules).toContain('register.tsx')
  })

  test('no source file names the submit call in any spelling', () => {
    const found: string[] = []
    for (const name of modules) {
      const code = codeOf(name)
      for (const pattern of SUBMIT) if (pattern.test(code)) found.push(`${name}: ${String(pattern)}`)
    }
    expect(found).toEqual([])
  })

  test('the patterns catch a call when there is one', () => {
    for (const call of ['await $.prompt.submit({ text })', '$.prompt?.submit(x)', "$.prompt['submit'](x)", 'const { submit } = $.prompt', 'io.submit(text)', '{ submit: text => send(text) }']) {
      expect(SUBMIT.some(pattern => pattern.test(call))).toBe(true)
    }
  })

  test('the only member of the host prompt the mod uses is fill, which puts text in the prompt box for the person to send', () => {
    const members = new Set<string>()
    for (const name of modules) for (const m of codeOf(name).matchAll(/\$\.prompt\s*\??\.\s*(\w+)/g)) members.add(m[1] as string)
    expect([...members]).toEqual(['fill'])
  })

  test('there is no delivery option to turn on, and no state kept for one', () => {
    const manifest = JSON.parse(readFileSync(join(MOD, '.claude-plugin', 'plugin.json'), 'utf8')) as { userConfig?: Record<string, unknown> }
    expect(Object.keys(manifest.userConfig ?? {}).sort()).toEqual(['bandRefreshSeconds', 'dtcRoot', 'hubDir'])
    const register = codeOf('register.tsx')
    expect(/\$\.store\.set\(\s*['"`](\w+)['"`]/.test(register)).toBe(true)
    const written = new Set([...register.matchAll(/\$\.store\.set\(\s*['"`](\w+)['"`]/g)].map(m => m[1]))
    expect([...written].sort()).toEqual(['registry', 'seen', 'sessions'])
  })
})
