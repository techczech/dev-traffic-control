import { describe, expect, test } from 'claude-code/testing'

import { resolveConfig } from './config'
import { classifyRecordPath, requestRefFromArg, scopeOf } from './paths'

describe('options', () => {
  test('defaults: the app\'s own records folder, no all-projects folder', () => {
    expect(resolveConfig({}, '/Users/someone')).toEqual({ root: '/Users/someone/Documents/Dev Traffic Control', hubDir: '', bandMs: 60_000 })
  })
  test('an empty or blank all-projects folder stays unset, and every session is then scoped to its project', () => {
    for (const hubDir of ['', '   ', undefined, 7]) {
      const cfg = resolveConfig({ hubDir }, '/Users/someone')
      expect(cfg.hubDir).toBe('')
      expect(scopeOf('/Users/someone/code/example-app', 'example-app', cfg.hubDir)).toEqual({ kind: 'project', project: 'example-app' })
    }
  })
  test('set options are used, ~ expanded, trailing slashes dropped, intervals under five seconds refused', () => {
    expect(resolveConfig({ dtcRoot: '~/records/', hubDir: '~/code/overview/', livePollSeconds: 10, bandRefreshSeconds: 1 }, '/Users/someone')).toEqual({
      root: '/Users/someone/records',
      hubDir: '/Users/someone/code/overview',
      bandMs: 60_000,
    })
  })
  test('options the mod does not have are ignored: there is no delivery setting to turn on', () => {
    const cfg = resolveConfig({ delivery: 'auto', livePollSeconds: 5 }, '/Users/someone')
    expect(Object.keys(cfg).sort()).toEqual(['bandMs', 'hubDir', 'root'])
  })
  test('the default folder has spaces in its name: paths under it still classify, and its siblings do not', () => {
    const root = resolveConfig({}, '/Users/someone').root
    expect(classifyRecordPath(`${root}/example-app/2026-01-01-a.md`, root)?.kind).toBe('request')
    expect(requestRefFromArg(`${root}/example-app/roadmap/export-keeps-filters.md`, root)).toEqual({ project: 'example-app', rel: 'roadmap/export-keeps-filters.md' })
    expect(requestRefFromArg(`${root} copy/example-app/2026-01-01-a.md`, root)).toBe(null)
  })
})
