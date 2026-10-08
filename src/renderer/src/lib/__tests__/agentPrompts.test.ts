import { describe, expect, test } from 'vitest'
import { ideaLink, planThisPrompt, reviewAllPrompt } from '../agentPrompts'

describe('agent prompts', () => {
  test('the plan prompt names the idea file, its dtc link, the keys to fill and the reply', () => {
    const prompt = planThisPrompt({
      project: 'example-app',
      id: 'export-keeps-filters',
      title: 'Keep the export filters on'
    })
    const link = 'dtc://open/example-app/roadmap/export-keeps-filters.md'
    expect(ideaLink('example-app', 'export-keeps-filters')).toBe(link)
    expect(prompt).toContain('example-app/roadmap/export-keeps-filters.md')
    expect(prompt).toContain(link)
    for (const key of ['`context`', '`plan`', '`fate`', '`related`']) expect(prompt).toContain(key)
    expect(prompt).toContain('records-folder contract')
    expect(prompt).toMatch(/reply with the link/)
  })

  test('the review prompt asks for plans, fates, candidates and a doc-review, per scope', () => {
    const one = reviewAllPrompt({ kind: 'project', project: 'example-app', count: 9 })
    expect(one).toContain('in the project example-app')
    expect(one).toContain('9 listed')
    for (const phrase of ['`plan`', '`fate`', '`candidate: <version>`', 'doc-review']) {
      expect(one).toContain(phrase)
    }
    expect(one).toContain('never create a `releases/<next>.md`')
    const all = reviewAllPrompt({ kind: 'all', count: 31 })
    expect(all).toContain('every project under All projects')
    expect(all).not.toContain('in the project')
  })
})
