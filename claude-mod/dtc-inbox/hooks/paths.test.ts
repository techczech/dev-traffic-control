import { describe, expect, test } from 'claude-code/testing'

import { baseOf, classifyRecordPath, classifyRequestPath, expandHome, kindOfRel, linksTo, parseDtcLink, requestRefFromArg, resolvePath, resolveProject, scopeOf } from './paths'
import type { GitProbe } from './paths'

const ROOT = '/h/work/records'

describe('request path classification', () => {
  test('project and round requests', () => {
    expect(classifyRequestPath(`${ROOT}/example-app/2026-09-30-agent-icon.md`, ROOT)).toEqual({ project: 'example-app', rel: '2026-09-30-agent-icon.md' })
    expect(classifyRequestPath(`${ROOT}/other-app/round-2/2026-09-30-x.md`, ROOT)).toEqual({ project: 'other-app', rel: 'round-2/2026-09-30-x.md' })
  })
  test('not requests: reserved folders, markers, notes, entries, handoffs, other roots, deep paths', () => {
    for (const p of [
      'releases/0.21.0.md',
      'roadmap/2026-01-01-idea.md',
      'threads/2026-09-01-entry-a.md',
      'handoffs/2026-09-01-x-handoff.md',
      '_unfiled/2026-01-01-x.md',
      '2026-01-01-x.resolved.md',
      '2026-01-01-note-x.md',
      '2026-01-01-entry-x.md',
      'AGENTS.md',
      '2026-01-01-x.report.json',
      'a/b/2026-01-01-x.md',
      '.x/2026-01-01-x.md',
    ]) {
      expect(classifyRequestPath(`${ROOT}/proj/${p}`, ROOT)).toBe(null)
    }
    expect(classifyRequestPath(`${ROOT}/2026-01-01-x.md`, ROOT)).toBe(null)
    expect(classifyRequestPath('/elsewhere/proj/2026-01-01-x.md', ROOT)).toBe(null)
    expect(classifyRequestPath(`${ROOT}-copy/proj/2026-01-01-x.md`, ROOT)).toBe(null)
  })
})

describe('roadmap ideas and release records', () => {
  test('kind is read from where the record sits', () => {
    expect(kindOfRel('roadmap/export-keeps-filters.md')).toBe('idea')
    expect(kindOfRel('releases/0.4.0.md')).toBe('release')
    expect(kindOfRel('roadmap/order.md')).toBe('request')
    expect(kindOfRel('2026-01-01-a.md')).toBe('request')
    expect(kindOfRel('round-1/2026-01-01-a.md')).toBe('request')
  })
  test('classifyRecordPath takes requests, idea files and release records, and nothing else', () => {
    expect(classifyRecordPath(`${ROOT}/example-app/2026-01-01-a.md`, ROOT)).toEqual({ ref: { project: 'example-app', rel: '2026-01-01-a.md' }, kind: 'request' })
    expect(classifyRecordPath(`${ROOT}/example-app/roadmap/export-keeps-filters.md`, ROOT)).toEqual({ ref: { project: 'example-app', rel: 'roadmap/export-keeps-filters.md' }, kind: 'idea' })
    expect(classifyRecordPath(`${ROOT}/example-app/releases/0.4.0.md`, ROOT)).toEqual({ ref: { project: 'example-app', rel: 'releases/0.4.0.md' }, kind: 'release' })
    for (const p of [
      'example-app/roadmap/order.json',
      'example-app/roadmap/order.md',
      'example-app/releases/0.4.0.answers.json',
      'example-app/roadmap/deep/x.md',
      'example-app/roadmap/../releases/0.4.0.md',
      'example-app/roadmap/%2e%2e.md',
      'example-app/roadmap/a b.md',
      'example-app/threads/2026-01-01-entry-a.md',
      '_unfiled/roadmap/x.md',
      'roadmap/x.md',
    ]) {
      expect(classifyRecordPath(`${ROOT}/${p}`, ROOT)).toBe(null)
    }
    expect(classifyRecordPath('/elsewhere/example-app/roadmap/x.md', ROOT)).toBe(null)
    expect(classifyRecordPath(`${ROOT}-copy/example-app/roadmap/x.md`, ROOT)).toBe(null)
  })
  test('a tool argument may name the idea, the release record or its answers file', () => {
    expect(requestRefFromArg(`${ROOT}/example-app/roadmap/export-keeps-filters.md`, ROOT)).toEqual({ project: 'example-app', rel: 'roadmap/export-keeps-filters.md' })
    expect(requestRefFromArg(`${ROOT}/example-app/releases/0.4.0.answers.json`, ROOT)).toEqual({ project: 'example-app', rel: 'releases/0.4.0.md' })
    expect(requestRefFromArg(`${ROOT}/example-app/releases/../../x/0.4.0.answers.json`, ROOT)).toBe(null)
  })
})

describe('links', () => {
  test('parse, with and without .md and inside markdown', () => {
    expect(parseDtcLink('[x](dtc://open/p/2026-01-01-a)')).toEqual({ project: 'p', rel: '2026-01-01-a.md' })
    expect(parseDtcLink('dtc://open/p/r/2026-01-01-a.md#sec')).toEqual({ project: 'p', rel: 'r/2026-01-01-a.md' })
    expect(parseDtcLink('no link')).toBe(null)
  })
  test('the verb-less shorthand reads exactly as the open form', () => {
    expect(parseDtcLink('dtc://example-app/2026-01-01-a')).toEqual({ project: 'example-app', rel: '2026-01-01-a.md' })
    expect(parseDtcLink('[x](dtc://example-app/round-2/2026-01-01-a.md)')).toEqual({ project: 'example-app', rel: 'round-2/2026-01-01-a.md' })
    expect(parseDtcLink('dtc://example-app/roadmap/export-keeps-filters.md')).toEqual({ project: 'example-app', rel: 'roadmap/export-keeps-filters.md' })
    expect(parseDtcLink('DTC://OPEN/p/2026-01-01-a')).toEqual({ project: 'p', rel: '2026-01-01-a.md' })
    expect(requestRefFromArg('dtc://example-app/releases/0.4.0', ROOT)).toEqual({ project: 'example-app', rel: 'releases/0.4.0.md' })
  })
  test('a verb keeps its meaning: project and thread links name no record, and a project called like a verb needs the open form', () => {
    for (const link of ['dtc://project/example-app', 'dtc://thread/example-app/some-thread', 'dtc://Thread/example-app/x', 'dtc://open/2026-01-01-a.md', 'dtc://example-app', 'dtc://example-app/', 'dtc://']) {
      expect(parseDtcLink(link)).toBe(null)
    }
    expect(parseDtcLink('dtc://open/thread/2026-01-01-a')).toEqual({ project: 'thread', rel: '2026-01-01-a.md' })
  })
  test('the shorthand meets the same refusals: .., absolute, encoded, control and bidirectional characters', () => {
    for (const link of [
      'dtc://../2026-01-01-a.md',
      'dtc://example-app/../other/2026-01-01-a.md',
      'dtc://example-app/../../etc/passwd',
      'dtc:///etc/passwd',
      'dtc://example-app//2026-01-01-a.md',
      'dtc://example-app/%2e%2e/2026-01-01-a.md',
      'dtc://%2e%2e/example-app/2026-01-01-a.md',
      'dtc://example-app/2026-01-01-a\u0001.md',
      'dtc://example-app/2026-01-01-\u202Edm.exe',
      'dtc://example-app/2026-01-01-a\u200B.md',
      'dtc://example\u0000-app/2026-01-01-a.md',
      'dtc://example-app/a\\b.md',
      'dtc://example-app/a:b.md',
      'dtc://.hidden/2026-01-01-a.md',
      'dtc://example-app/a/b/c.md',
    ]) {
      expect(parseDtcLink(link)).toBe(null)
      expect(requestRefFromArg(link, ROOT)).toBe(null)
    }
  })
  test('requestRefFromArg takes absolute request or report paths and links', () => {
    expect(requestRefFromArg(`${ROOT}/p/2026-01-01-a.report.json`, ROOT)).toEqual({ project: 'p', rel: '2026-01-01-a.md' })
    expect(requestRefFromArg('dtc://open/p/2026-01-01-a.md', ROOT)).toEqual({ project: 'p', rel: '2026-01-01-a.md' })
    expect(requestRefFromArg('/etc/passwd', ROOT)).toBe(null)
    expect(requestRefFromArg('relative.md', ROOT)).toBe(null)
  })
  test('linksTo matches the same request only', () => {
    const ref = { project: 'p', rel: '2026-01-01-a.md' }
    expect(linksTo('see [x](dtc://open/p/2026-01-01-a.md)', ref)).toBe(true)
    expect(linksTo('see dtc://open/p/2026-01-01-a', ref)).toBe(true)
    expect(linksTo('see dtc://open/p/2026-01-01-a-b.md', ref)).toBe(false)
    expect(linksTo('see dtc://open/q/2026-01-01-a.md', ref)).toBe(false)
    expect(linksTo('', ref)).toBe(false)
    expect(linksTo('see [x](dtc://p/2026-01-01-a.md)', ref)).toBe(true)
    expect(linksTo('see dtc://p/2026-01-01-a-b', ref)).toBe(false)
  })
  test('helpers', () => {
    expect(baseOf('/a/b.report.json')).toBe('/a/b')
    expect(baseOf('/a/b.resolved.md')).toBe('/a/b')
    expect(expandHome('~/x', '/h')).toBe('/h/x')
    expect(resolvePath('/a/b', '../c/./d')).toBe('/a/c/d')
  })
})

function probe(files: Record<string, string | 'dir'>): GitProbe {
  return {
    kind: async p => (files[p] === undefined ? null : files[p] === 'dir' ? 'dir' : 'file'),
    read: async p => {
      const v = files[p]
      return v === undefined || v === 'dir' ? null : v
    },
  }
}

describe('project resolution', () => {
  test('plain repository and a subfolder of it', async () => {
    const p = probe({ '/g/appx/.git': 'dir' })
    expect(await resolveProject('/g/appx', p)).toBe('appx')
    expect(await resolveProject('/g/appx/src/deep', p)).toBe('appx')
  })
  test('linked worktree resolves to the main repository name through commondir', async () => {
    const p = probe({
      '/w/feature-branch/.git': 'gitdir: /g/appx/.git/worktrees/feature-branch\n',
      '/g/appx/.git/worktrees/feature-branch/commondir': '../..\n',
    })
    expect(await resolveProject('/w/feature-branch', p)).toBe('appx')
    expect(await resolveProject('/w/feature-branch/sub', p)).toBe('appx')
  })
  test('worktree without a commondir file falls back to the worktrees path', async () => {
    const p = probe({ '/w/t/.git': 'gitdir: /g/appx/.git/worktrees/t' })
    expect(await resolveProject('/w/t', p)).toBe('appx')
  })
  test('no repository: the folder name', async () => {
    expect(await resolveProject('/tmp/scratch', probe({}))).toBe('scratch')
  })
})

describe('scope', () => {
  test('hub directory and its worktrees see everything; others see their project', () => {
    expect(scopeOf('/h/work/all-projects', 'all-projects', '/h/work/all-projects')).toEqual({ kind: 'hub' })
    expect(scopeOf('/h/work/all-projects/x', 'all-projects', '/h/work/all-projects/')).toEqual({ kind: 'hub' })
    expect(scopeOf('/w/hub-wt', 'all-projects', '/h/work/all-projects')).toEqual({ kind: 'hub' })
    expect(scopeOf('/h/work/appx', 'appx', '/h/work/all-projects')).toEqual({ kind: 'project', project: 'appx' })
  })
  test('with no all-projects folder set, every session is scoped to its project', () => {
    expect(scopeOf('/h/work/appx', 'appx', '')).toEqual({ kind: 'project', project: 'appx' })
    expect(scopeOf('/', '', '')).toEqual({ kind: 'project', project: '' })
  })
})

describe('tool argument canonicalisation', () => {
  test('.., encoded traversal, NUL, backslash and sibling-prefix roots are refused', () => {
    for (const arg of [
      `${ROOT}/p/../../../etc/passwd.report.json`,
      `${ROOT}/../records/p/2026-01-01-a.md`,
      `${ROOT}/p/round/../2026-01-01-a.md`,
      `${ROOT}/%2e%2e/%2e%2e/etc/2026-01-01-a.md`,
      `${ROOT}/p/%2E%2E/2026-01-01-a.md`,
      `${ROOT}/p/2026-01-01-a.md\u0000.png`,
      `${ROOT}\\..\\x/2026-01-01-a.md`,
      '/h/work/records-evil/p/2026-01-01-a.md',
      'dtc://open/../2026-01-01-a.md',
      'dtc://open/p/../../etc/passwd',
      'dtc://open/p/%2e%2e/%2e%2e/etc/passwd',
      'dtc://open/p/a b.md',
      'dtc://open/p/"x".md',
      'dtc://open/p/a/b/c.md',
      '[x](dtc://open/../etc/passwd)',
    ]) {
      expect(requestRefFromArg(arg, ROOT)).toBe(null)
    }
  })
  test('a query string is refused, as the app refuses it; a fragment is dropped', () => {
    expect(requestRefFromArg('dtc://open/p/2026-01-01-a?x=1', ROOT)).toBe(null)
    expect(requestRefFromArg('dtc://p/2026-01-01-a?x=1', ROOT)).toBe(null)
    expect(requestRefFromArg('dtc://open/p/2026-01-01-a#item-2', ROOT)).toEqual({ project: 'p', rel: '2026-01-01-a.md' })
    expect(parseDtcLink('dtc://open/p/a\'b.md')).toBe(null)
  })
  test('registry paths read back from the store with traversal do not classify', () => {
    expect(classifyRequestPath(`${ROOT}/p/../2026-01-01-x.md`, ROOT)).toBe(null)
    expect(classifyRequestPath(`${ROOT}/p/%2e%2e/2026-01-01-x.md`, ROOT)).toBe(null)
    expect(classifyRequestPath(`${ROOT}/p/2026-01-01-x\u0000.md`, ROOT)).toBe(null)
  })
})
