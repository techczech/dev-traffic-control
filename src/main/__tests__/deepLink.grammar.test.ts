import { describe, expect, test } from 'vitest'
import {
  deepLinkFromArgv,
  isDeepLinkUrl,
  parseDeepLink,
  projectLink,
  recordRelativePath
} from '../../shared/deepLink'

/**
 * The grammar is a security boundary: any web page can fire a custom-scheme
 * URL, so every string here is attacker-controllable input rather than
 * something an agent wrote. The hostile cases are the point of this file.
 */

describe('the three verbs', () => {
  test('open addresses a record by its record-root-relative path', () => {
    expect(parseDeepLink('dtc://open/wordforge-desktop/2026-09-11-action-bar.md')).toEqual({
      verb: 'open',
      project: 'wordforge-desktop',
      path: '2026-09-11-action-bar.md'
    })
  })

  test('open carries a nested path and an optional fragment', () => {
    const link = parseDeepLink('dtc://open/wordforge-desktop/releases/0.21.0.md#action-bar')
    expect(link).toEqual({
      verb: 'open',
      project: 'wordforge-desktop',
      path: 'releases/0.21.0.md',
      fragment: 'action-bar'
    })
    expect(recordRelativePath(link as never)).toBe('wordforge-desktop/releases/0.21.0.md')
  })

  test('project enters a scope and opens nothing', () => {
    expect(parseDeepLink('dtc://project/wordforge-desktop')).toEqual({
      verb: 'project',
      project: 'wordforge-desktop'
    })
  })

  test('thread addresses a thread id, because a thread is not a file', () => {
    expect(parseDeepLink('dtc://thread/tallyboard/divider-inference')).toEqual({
      verb: 'thread',
      project: 'tallyboard',
      thread: 'divider-inference'
    })
  })

  test('percent-encoding is accepted but never required', () => {
    expect(parseDeepLink('dtc://open/wordforge-desktop/a%20record.md')).toEqual({
      verb: 'open',
      project: 'wordforge-desktop',
      path: 'a record.md'
    })
  })

  test('there is no fourth verb', () => {
    for (const url of [
      'dtc://answer/wordforge-desktop/x.md',
      'dtc://delete/wordforge-desktop/x.md',
      'dtc://ship/wordforge-desktop/0.21.0.md',
      'dtc://opens/wordforge-desktop/x.md'
    ]) {
      expect(parseDeepLink(url), url).toBeNull()
    }
  })
})

describe('shapes that are not a link at all', () => {
  test.each([
    ['another scheme', 'https://open/wordforge-desktop/x.md'],
    ['a lookalike scheme', 'dtcx://open/wordforge-desktop/x.md'],
    ['no verb', 'dtc://'],
    ['a verb with nothing to address', 'dtc://open'],
    ['open with a project but no record', 'dtc://open/wordforge-desktop'],
    ['project with a trailing path', 'dtc://project/wordforge-desktop/x.md'],
    ['project with a fragment', 'dtc://project/wordforge-desktop#x'],
    ['thread with no id', 'dtc://thread/wordforge-desktop'],
    ['thread with two ids', 'dtc://thread/wordforge-desktop/a/b'],
    ['an empty string', '']
  ])('refuses %s', (_case, url) => {
    expect(parseDeepLink(url)).toBeNull()
  })
})

describe('hostile input', () => {
  test.each([
    ['plain traversal', 'dtc://open/../../../../Users/someone/.ssh/id_ed25519'],
    ['traversal below the project', 'dtc://open/wordforge-desktop/../../../etc/passwd'],
    ['traversal as the project segment', 'dtc://open/../etc/passwd'],
    ['a dot segment', 'dtc://open/wordforge-desktop/./../../etc/passwd'],
    ['percent-encoded traversal', 'dtc://open/%2e%2e/%2e%2e/etc/passwd'],
    ['upper-case percent-encoded traversal', 'dtc://open/%2E%2E/%2E%2E/etc/passwd'],
    ['an encoded separator inside a segment', 'dtc://open/wordforge-desktop/a%2F..%2F..%2Fetc'],
    ['an encoded backslash', 'dtc://open/wordforge-desktop/a%5C..%5Cetc'],
    ['a literal backslash', 'dtc://open/wordforge-desktop\\..\\..\\etc'],
    ['an absolute path', 'dtc://open//etc/passwd'],
    ['an empty segment mid-path', 'dtc://open/wordforge-desktop//passwd'],
    ['a NUL byte', 'dtc://open/wordforge-desktop/a%00.md'],
    ['malformed percent-encoding', 'dtc://open/wordforge-desktop/%zz.md'],
    ['a project segment that is a traversal', 'dtc://project/..'],
    ['a thread id that is a traversal', 'dtc://thread/wordforge-desktop/..'],
    ['fragment traversal', 'dtc://open/wordforge-desktop/x.md#../../../etc/passwd'],
    ['encoded fragment traversal', 'dtc://open/wordforge-desktop/x.md#%2e%2e%2fetc'],
    ['a fragment with a separator', 'dtc://open/wordforge-desktop/x.md#a/b']
  ])('refuses %s', (_case, url) => {
    expect(parseDeepLink(url)).toBeNull()
  })

  test('a refused link is refused whole — nothing is clamped into the root', () => {
    // The WHATWG URL parser would quietly turn this into `dtc://open/etc/passwd`
    // and hand back a path inside the root. Refusing is the contract.
    expect(new URL('dtc://open/wordforge/../../etc/passwd').pathname).toBe('/etc/passwd')
    expect(parseDeepLink('dtc://open/wordforge/../../etc/passwd')).toBeNull()
  })
})

describe('recognising a link without judging it', () => {
  test('the scheme is recognised case-insensitively, verb and path are not trusted', () => {
    expect(isDeepLinkUrl('DTC://open/wordforge-desktop/x.md')).toBe(true)
    expect(isDeepLinkUrl('dtc://../../etc/passwd')).toBe(true)
    expect(parseDeepLink('dtc://../../etc/passwd')).toBeNull()
    expect(isDeepLinkUrl('https://example.com')).toBe(false)
  })

  test('a link passed on a command line is found among other arguments', () => {
    expect(deepLinkFromArgv(['/Applications/DTC.app', '--flag', 'dtc://project/x'])).toBe(
      'dtc://project/x'
    )
    expect(deepLinkFromArgv(['/Applications/DTC.app', '--flag'])).toBeNull()
  })
})

describe('the link the app mints', () => {
  // Copy link to this project (mockup state 13). A minted link the parser then
  // refused would be a link that goes nowhere when he pastes it.
  test('a project link reads back as that project', () => {
    for (const slug of ['wordforge-desktop', 'dev-traffic-control', 'v0.2_x']) {
      expect(parseDeepLink(projectLink(slug))).toEqual({ verb: 'project', project: slug })
    }
    expect(projectLink('wordforge-desktop')).toBe('dtc://project/wordforge-desktop')
  })
})
