import { describe, expect, test } from 'vitest'
import { ROOT_AGENTS_MD, ROOT_TEMPLATE_VERSION, templateVersion } from '../templates'
import { parseRequest } from '../parseRequest'

describe('root contract — review requests section', () => {
  test('carries its own template version marker, parsed back verbatim', () => {
    expect(templateVersion(ROOT_AGENTS_MD)).toBe(ROOT_TEMPLATE_VERSION)
  })

  test('an unmarked (pre-marker) file reads as version 1', () => {
    expect(templateVersion('# Records — Test-Feedback Contract\n\nold contents')).toBe(1)
    expect(ROOT_TEMPLATE_VERSION).toBeGreaterThan(1)
  })

  test('the request contract is LIGHT BY DEFAULT with hard caps', () => {
    expect(ROOT_AGENTS_MD).toContain('LIGHT BY DEFAULT')
    // The numeric caps: <= 4 checks, <= 3 things each
    expect(ROOT_AGENTS_MD).toContain('≤ 4 checks. ≤ 3 things to look at per check')
    // No Steps/Expected split by default; that is the exception
    expect(ROOT_AGENTS_MD).toMatch(/One flat list. NO/)
    expect(ROOT_AGENTS_MD).toContain('ONLY when the reviewer explicitly asks')
    // State incidentals, do not test them
    expect(ROOT_AGENTS_MD).toContain('State incidental facts; never test them')
    // Park the rest for a later sweep / automated tests
    expect(ROOT_AGENTS_MD).toContain('## Also worth checking')
    expect(ROOT_AGENTS_MD).toContain('Prefer writing these as automated tests')
  })

  test('documents the review-request contract', () => {
    expect(ROOT_AGENTS_MD).toContain('## Review requests')
    expect(ROOT_AGENTS_MD).toContain('kind: doc-review')
    expect(ROOT_AGENTS_MD).toContain('YYYY-MM-DD-review-<slug>.md')
    // Provenance + snapshot rules
    expect(ROOT_AGENTS_MD).toContain('`source`')
    expect(ROOT_AGENTS_MD).toContain('`commit`')
    expect(ROOT_AGENTS_MD).toContain('Strip any source YAML frontmatter')
    // Light-facing review contract: distilled, not the whole doc verbatim
    expect(ROOT_AGENTS_MD).toContain('never the whole PRD/ADR verbatim')
    // Report semantics: one item, disposition enum reading, quotes/sectionMarks
    expect(ROOT_AGENTS_MD).toContain('id: "document"')
    expect(ROOT_AGENTS_MD).toContain('approved with changes')
    expect(ROOT_AGENTS_MD).toContain('sectionMarks')
    expect(ROOT_AGENTS_MD).toMatch(/quotes.*text, comment, section, number/)
    // Immutability: rework = a new snapshot request
    expect(ROOT_AGENTS_MD).toContain('NEW snapshot request')
  })

  test('the worked review example parses as a healthy doc-review request', () => {
    const section = ROOT_AGENTS_MD.slice(ROOT_AGENTS_MD.indexOf('## Review requests'))
    const fence = section.match(/```markdown\n([\s\S]*?)```/)
    expect(fence).not.toBeNull()
    const req = parseRequest(fence![1], '/qa/example-app/2026-01-15-review-quick-capture-prd.md')
    expect(req.labels.kind).toBe('doc-review')
    expect(req.labels.source).toBe('plans/2026-01-15-quick-capture-PRD.md')
    expect(req.labels.commit).toBe('4f2c9ab')
    expect(req.degraded).toBe(false)
    expect(req.fmSalvaged).toBeUndefined() // frontmatter must be valid YAML
    expect(req.document?.headings.map((h) => h.id)).toEqual(['goals', 'open-questions'])
    expect(req.items).toEqual([]) // never item-parsed
  })
})
