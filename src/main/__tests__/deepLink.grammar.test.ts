import { describe, expect, test } from 'vitest'
import {
  deepLinkFromArgv,
  isDeepLinkUrl,
  parseDeepLink,
  projectLink,
  inertLinkText,
  INERT_LINK_COPY_LIMIT,
  recordRelativePath
} from '../../shared/deepLink'

/**
 * The grammar is a security boundary: any web page can fire a custom-scheme
 * URL, so every string here is attacker-controllable input rather than
 * something an agent wrote. The hostile cases are the point of this file.
 */

describe('the three verbs', () => {
  test('open addresses a record by its record-root-relative path', () => {
    expect(parseDeepLink('dtc://open/windmill-desktop/2026-01-11-export-sheet.md')).toEqual({
      verb: 'open',
      project: 'windmill-desktop',
      path: '2026-01-11-export-sheet.md'
    })
  })

  test('open carries a nested path and an optional fragment', () => {
    const link = parseDeepLink('dtc://open/windmill-desktop/releases/0.4.0.md#export-sheet')
    expect(link).toEqual({
      verb: 'open',
      project: 'windmill-desktop',
      path: 'releases/0.4.0.md',
      fragment: 'export-sheet'
    })
    expect(recordRelativePath(link as never)).toBe('windmill-desktop/releases/0.4.0.md')
  })

  test('project enters a scope and opens nothing', () => {
    expect(parseDeepLink('dtc://project/windmill-desktop')).toEqual({
      verb: 'project',
      project: 'windmill-desktop'
    })
  })

  test('thread addresses a thread id, because a thread is not a file', () => {
    expect(parseDeepLink('dtc://thread/example-app/divider-inference')).toEqual({
      verb: 'thread',
      project: 'example-app',
      thread: 'divider-inference'
    })
  })

  test('percent-encoding is accepted but never required', () => {
    expect(parseDeepLink('dtc://open/windmill-desktop/a%20record.md')).toEqual({
      verb: 'open',
      project: 'windmill-desktop',
      path: 'a record.md'
    })
  })

  test('there is no fourth verb: an unknown first word is a project, and only ever opens', () => {
    // Since the verb-less shorthand, `answer/…` is read as the
    // project `answer`, never as an action. Nothing a link names can write.
    for (const [url, project] of [
      ['dtc://answer/windmill-desktop/x.md', 'answer'],
      ['dtc://delete/windmill-desktop/x.md', 'delete'],
      ['dtc://ship/windmill-desktop/0.21.0.md', 'ship'],
      ['dtc://opens/windmill-desktop/x.md', 'opens']
    ]) {
      expect(parseDeepLink(url), url).toMatchObject({ verb: 'open', project })
    }
  })
})

describe('the verb-less shorthand', () => {
  // Agents write the project
  // first and leave out `open/`, and sometimes `.md` too.
  test.each([
    [
      'dtc://example-app/2026-01-15-review-sign-in-journeys',
      'example-app',
      '2026-01-15-review-sign-in-journeys'
    ],
    [
      'dtc://example-app/2026-01-15-example-app-0.4.0-preview.2-check',
      'example-app',
      '2026-01-15-example-app-0.4.0-preview.2-check'
    ],
    [
      'dtc://example-app/2026-01-16-review-export-directions.md',
      'example-app',
      '2026-01-16-review-export-directions.md'
    ]
  ])('%s opens as open/<project>/<rest>', (url, project, path) => {
    expect(parseDeepLink(url)).toEqual({ verb: 'open', project, path })
    expect(parseDeepLink(url)).toEqual(parseDeepLink(url.replace('dtc://', 'dtc://open/')))
  })

  test('the shorthand carries a nested path and a fragment exactly as open does', () => {
    expect(parseDeepLink('dtc://example-app/releases/0.4.0.md#handout-fix')).toEqual({
      verb: 'open',
      project: 'example-app',
      path: 'releases/0.4.0.md',
      fragment: 'handout-fix'
    })
  })

  test('a first segment that is a verb keeps the verb, whatever its case', () => {
    expect(parseDeepLink('dtc://project/example-app')).toEqual({
      verb: 'project',
      project: 'example-app'
    })
    expect(parseDeepLink('dtc://thread/example-app/x')).toEqual({
      verb: 'thread',
      project: 'example-app',
      thread: 'x'
    })
    expect(parseDeepLink('dtc://Thread/example-app/x')).toMatchObject({ verb: 'thread' })
    // A project literally called `project` or `thread` is not reachable by the
    // shorthand: these keep the verb and its stricter shape, so they refuse.
    expect(parseDeepLink('dtc://project/x/record.md')).toBeNull()
    expect(parseDeepLink('dtc://thread/x/a/b.md')).toBeNull()
    // An explicit `open` names them fine.
    expect(parseDeepLink('dtc://open/thread/record.md')).toEqual({
      verb: 'open',
      project: 'thread',
      path: 'record.md'
    })
  })

  test.each([
    ['a bare project with nothing to open', 'dtc://example-app'],
    ['a bare project with a trailing slash', 'dtc://example-app/'],
    ['a project that is not a slug', 'dtc://-example-app/x.md'],
    ['a project with a space', 'dtc://example%20app/x.md'],
    ['a traversal below the project', 'dtc://example-app/../x'],
    ['a deep traversal below the project', 'dtc://example-app/../../../../etc/passwd'],
    ['a traversal as the project', 'dtc://../x'],
    ['an encoded traversal as the project', 'dtc://%2e%2e/x'],
    ['an encoded traversal below the project', 'dtc://example-app/%2e%2e/%2e%2e/x'],
    ['an upper-case encoded traversal', 'dtc://example-app/%2E%2E/x'],
    ['an encoded separator', 'dtc://example-app/a%2f..%2f..%2fx'],
    ['an encoded separator in the project', 'dtc://..%2f..%2fetc/passwd'],
    ['an absolute path', 'dtc:///etc/passwd'],
    ['a dot segment', 'dtc://example-app/./x.md'],
    ['a NUL byte', 'dtc://example-app/x%00.md'],
    ['a backslash', 'dtc://example-app/..\\..\\x'],
    ['fragment traversal', 'dtc://example-app/x.md#../../etc/passwd']
  ])('still refuses %s', (_case, url) => {
    expect(parseDeepLink(url)).toBeNull()
  })
})

describe('shapes that are not a link at all', () => {
  test.each([
    ['another scheme', 'https://open/windmill-desktop/x.md'],
    ['a lookalike scheme', 'dtcx://open/windmill-desktop/x.md'],
    ['no verb', 'dtc://'],
    ['a verb with nothing to address', 'dtc://open'],
    ['open with a project but no record', 'dtc://open/windmill-desktop'],
    ['project with a trailing path', 'dtc://project/windmill-desktop/x.md'],
    ['project with a fragment', 'dtc://project/windmill-desktop#x'],
    ['thread with no id', 'dtc://thread/windmill-desktop'],
    ['thread with two ids', 'dtc://thread/windmill-desktop/a/b'],
    ['an empty string', '']
  ])('refuses %s', (_case, url) => {
    expect(parseDeepLink(url)).toBeNull()
  })
})

describe('hostile input', () => {
  test.each([
    ['plain traversal', 'dtc://open/../../../../Users/someone/.ssh/id_ed25519'],
    ['traversal below the project', 'dtc://open/windmill-desktop/../../../etc/passwd'],
    [
      'a real probe: traversal to an ssh key',
      'dtc://open/../../../../Users/someone/.ssh/id_ed25519'
    ],
    ['a real probe: traversal out of a project', 'dtc://open/dev-traffic-control/../../x'],
    ['encoded traversal out of a project', 'dtc://open/dev-traffic-control/%2e%2e/%2e%2e/x'],
    ['encoded separators out of a project', 'dtc://open/dev-traffic-control/..%2f..%2fx'],
    ['traversal as the project segment', 'dtc://open/../etc/passwd'],
    ['a dot segment', 'dtc://open/windmill-desktop/./../../etc/passwd'],
    ['percent-encoded traversal', 'dtc://open/%2e%2e/%2e%2e/etc/passwd'],
    ['upper-case percent-encoded traversal', 'dtc://open/%2E%2E/%2E%2E/etc/passwd'],
    ['an encoded separator inside a segment', 'dtc://open/windmill-desktop/a%2F..%2F..%2Fetc'],
    ['an encoded backslash', 'dtc://open/windmill-desktop/a%5C..%5Cetc'],
    ['a literal backslash', 'dtc://open/windmill-desktop\\..\\..\\etc'],
    ['an absolute path', 'dtc://open//etc/passwd'],
    ['an empty segment mid-path', 'dtc://open/windmill-desktop//passwd'],
    ['a NUL byte', 'dtc://open/windmill-desktop/a%00.md'],
    ['malformed percent-encoding', 'dtc://open/windmill-desktop/%zz.md'],
    ['a project segment that is a traversal', 'dtc://project/..'],
    ['a thread id that is a traversal', 'dtc://thread/windmill-desktop/..'],
    ['fragment traversal', 'dtc://open/windmill-desktop/x.md#../../../etc/passwd'],
    ['encoded fragment traversal', 'dtc://open/windmill-desktop/x.md#%2e%2e%2fetc'],
    ['a fragment with a separator', 'dtc://open/windmill-desktop/x.md#a/b']
  ])('refuses %s', (_case, url) => {
    expect(parseDeepLink(url)).toBeNull()
  })

  test('a refused link is refused whole — nothing is clamped into the root', () => {
    // The WHATWG URL parser would quietly turn this into `dtc://open/etc/passwd`
    // and hand back a path inside the root. Refusing is the contract.
    expect(new URL('dtc://open/windmill/../../etc/passwd').pathname).toBe('/etc/passwd')
    expect(parseDeepLink('dtc://open/windmill/../../etc/passwd')).toBeNull()
  })
})

describe('invisible and reordering characters in a segment', () => {
  test.each([
    ['a bidi override', 'dtc://example-app/\u202Edm.exe.md'],
    ['a zero-width space', 'dtc://example-app/x\u200B.md'],
    ['a C1 next-line', 'dtc://example-app/\u0085x'],
    ['a BOM', 'dtc://example-app/\uFEFFx'],
    ['a line separator', 'dtc://example-app/\u2028x'],
    ['a paragraph separator', 'dtc://example-app/x\u2029'],
    ['an interlinear anchor', 'dtc://example-app/\uFFF9x.md'],
    ['a percent-encoded bidi override', 'dtc://example-app/%E2%80%AEdm.exe.md']
  ])('refuses %s', (_case, url) => {
    expect(parseDeepLink(url)).toBeNull()
  })

  test('ordinary Unicode letters are still accepted', () => {
    expect(parseDeepLink('dtc://example-app/příliš-žluťoučký.md')).not.toBeNull()
  })
})

describe('inertLinkText on huge input', () => {
  test('a 1,000,000-character input completes and caps', () => {
    const { display, copy } = inertLinkText('a'.repeat(1_000_000))
    expect(Array.from(copy)).toHaveLength(INERT_LINK_COPY_LIMIT)
    expect(display.length).toBeLessThan(300)
  })
})

describe('recognising a link without judging it', () => {
  test('the scheme is recognised case-insensitively, verb and path are not trusted', () => {
    expect(isDeepLinkUrl('DTC://open/windmill-desktop/x.md')).toBe(true)
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
  // Copy link to this project. A minted link the parser then
  // refused would be a link that goes nowhere when the reviewer pastes it.
  test('a project link reads back as that project', () => {
    for (const slug of ['windmill-desktop', 'dev-traffic-control', 'v0.2_x']) {
      expect(parseDeepLink(projectLink(slug))).toEqual({ verb: 'project', project: slug })
    }
    expect(projectLink('windmill-desktop')).toBe('dtc://project/windmill-desktop')
  })
})
