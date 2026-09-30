import { describe, expect, test } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { ROOT_AGENTS_MD, ROOT_TEMPLATE_VERSION } from '../templates'

describe('root contract — handoffs', () => {
  test('documents the reserved record-folder layout and ownership split', () => {
    expect(ROOT_TEMPLATE_VERSION).toBe(20)
    expect(ROOT_AGENTS_MD).toContain('handoffs/')
    expect(ROOT_AGENTS_MD).toContain('YYYY-MM-DD-<slug>-handoff.md')
    expect(ROOT_AGENTS_MD).toContain('YYYY-MM-DD-<slug>-handoff.state.json')
    expect(ROOT_AGENTS_MD).toMatch(/handoffs.*reserved.*never rounds/is)
    expect(ROOT_AGENTS_MD).toMatch(/agents.*read.*sidecar/is)
    expect(ROOT_AGENTS_MD).toMatch(/app.*writes.*sidecar/is)
    expect(ROOT_AGENTS_MD).toMatch(/app.*never edits.*handoff/is)
    expect(ROOT_AGENTS_MD).toMatch(/delete.*sidecar.*resurrect/is)
  })

  test('contains one handoff document example with the declared frontmatter contract', () => {
    const section = ROOT_AGENTS_MD.slice(ROOT_AGENTS_MD.indexOf('## Handoffs'))
    const fence = section.match(/```markdown\n([\s\S]*?)```/)

    expect(fence).not.toBeNull()
    const frontmatter = fence![1].match(/^---\n([\s\S]*?)\n---/)
    expect(frontmatter).not.toBeNull()
    const meta = parseYaml(frontmatter![1])
    expect(meta).toMatchObject({
      title: expect.any(String),
      domain: 'utilities',
      repo: 'example-app',
      move: 'agent',
      state: 'live',
      updated: '2026-01-15',
      resume: expect.any(String)
    })
    expect(meta).not.toHaveProperty('project')
  })
})
