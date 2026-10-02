import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { isFeatureRequest, parseFeatureRequest } from '../featureRequest'
import { editProjectPoolIdea, readProjectPool } from '../pool'
import { ROOT_AGENTS_MD } from '../templates'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const FILE = `---
id: export-keeps-filters
title: Export keeps the active filters
tier: functionality
added: 2026-01-15
by: reviewer
said:
  where: a test request (preview.2)
  when: 2026-01-15
  link: dtc://open/example-app/x
quote: "the export ignores my filters"
context: Exporting a filtered list wrote every row.
plan: Apply the active filters when exporting.
fate: building
fate_note: in 0.4.0-preview.3
related: [ticket-12, release-0.4.0, 0.4]
candidate: 0.4.0
---

Free text body.
`

async function recordWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dtc-requests-'))
  directories.push(root)
  await mkdir(path.join(root, 'app', 'roadmap'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, 'app', 'roadmap', name), content)
  }
  return root
}

describe('feature request frontmatter', () => {
  test('an idea file with the new keys reads back every field', async () => {
    const root = await recordWith({ 'export-keeps-filters.md': FILE })
    const [idea] = (await readProjectPool(root, 'app')).ideas
    expect(idea.request).toEqual({
      by: 'reviewer',
      said: [
        {
          where: 'a test request (preview.2)',
          when: '2026-01-15',
          link: 'dtc://open/example-app/x'
        }
      ],
      quotes: ['the export ignores my filters'],
      context: 'Exporting a filtered list wrote every row.',
      plan: 'Apply the active filters when exporting.',
      fate: 'building',
      fateNote: 'in 0.4.0-preview.3',
      related: ['ticket-12', 'release-0.4.0', '0.4']
    })
    expect(idea.candidateRelease).toBe('0.4.0')
    expect(isFeatureRequest(idea.request)).toBe(true)
  })

  test('an idea without the keys loads as before, with no request', async () => {
    const root = await recordWith({
      'plain.md': '---\nid: plain\ntitle: Plain\ntier: delight\n---\n\nBody.\n'
    })
    const [idea] = (await readProjectPool(root, 'app')).ideas
    expect(idea.request).toBeUndefined()
    expect(idea.title).toBe('Plain')
  })

  test('unknown or odd values are tolerated, and an unknown fate reads as no fate', () => {
    const request = parseFeatureRequest({
      by: 'somebody',
      fate: 'shelved',
      said: 'chat',
      quote: ['one', 'two'],
      related: 'ticket-1',
      plan: { nested: true }
    })
    expect(request).toEqual({
      said: [],
      quotes: ['one', 'two'],
      related: ['ticket-1']
    })
    expect(isFeatureRequest(request)).toBe(false)
  })

  test('by: dominik is the reviewer, by: agent is not a request', () => {
    expect(isFeatureRequest(parseFeatureRequest({ by: 'Dominik' }))).toBe(true)
    expect(isFeatureRequest(parseFeatureRequest({ by: 'agent' }))).toBe(false)
  })

  test('an app edit of the body keeps every new frontmatter key byte for byte', async () => {
    const root = await recordWith({ 'export-keeps-filters.md': FILE })
    await editProjectPoolIdea(root, 'app', 'export-keeps-filters', {
      bodyMarkdown: 'Free text body.\n\n## Reviewer entry · 2026-10-01 · Not now\n'
    })
    const after = await readFile(
      path.join(root, 'app', 'roadmap', 'export-keeps-filters.md'),
      'utf8'
    )
    expect(after.slice(0, after.indexOf('\n---\n') + 5)).toBe(
      FILE.slice(0, FILE.indexOf('\n---\n') + 5)
    )
    const [idea] = (await readProjectPool(root, 'app')).ideas
    expect(idea.request?.fate).toBe('building')
    expect(idea.bodyMarkdown).toContain('Reviewer entry')
    expect(parseYaml(after.split('---')[1]).fate).toBe('building')
  })
})

describe('root contract — feature requests', () => {
  test('documents the keys, the fates, the entries and the duty to keep fate current', () => {
    expect(ROOT_AGENTS_MD).toContain('### Feature requests')
    for (const key of [
      'by:',
      'said:',
      'quote:',
      'context:',
      'plan:',
      'fate:',
      'fate_note:',
      'related:'
    ]) {
      expect(ROOT_AGENTS_MD).toContain(key)
    }
    expect(ROOT_AGENTS_MD).toContain('waiting | planned | building | built | merged | declined')
    expect(ROOT_AGENTS_MD).toContain('Reviewer entry')
    expect(ROOT_AGENTS_MD).toMatch(/Keep \S*fate\S* current/)
  })
})
