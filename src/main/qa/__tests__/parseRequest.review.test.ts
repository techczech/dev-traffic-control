import { describe, expect, test } from 'vitest'
import { parseRequest } from '../parseRequest'

const BODY = `
Opening paragraph before any heading.

## Motivation

Why the skills layer exists.

## Roles and responsibilities {#roles}

Who does what during a review.

### Escalation path

When implementers must stop and report.

## Open questions

- storage of factory skills
- palette door ordering
`

const REVIEW = `---
id: review-skills-prd
title: Skills layer PRD
app: WordForge
date: 2026-07-19
kind: doc-review
source: docs/plans/skills-prd.md
commit: 346dbcc
intro: Review before the 0.7b build.
---
${BODY}`

describe('parseRequest doc-review', () => {
  test('kind: doc-review switches to document parsing — headings as TOC, no items', () => {
    const r = parseRequest(REVIEW, '/qa/wordforge-desktop/2026-07-19-review-skills-prd.md')
    expect(r.items).toEqual([])
    expect(r.degraded).toBe(false)
    expect(r.labels.kind).toBe('doc-review')
    // provenance stays in labels — no special fields
    expect(r.labels.source).toBe('docs/plans/skills-prd.md')
    expect(r.labels.commit).toBe('346dbcc')
    expect(r.document?.headings).toEqual([
      { id: 'motivation', title: 'Motivation', level: 2 },
      { id: 'roles', title: 'Roles and responsibilities', level: 2 },
      { id: 'escalation-path', title: 'Escalation path', level: 3 },
      { id: 'open-questions', title: 'Open questions', level: 2 }
    ])
  })

  test('mode: doc-review switches to document parsing without a kind label', () => {
    const review = parseRequest(
      `---
id: review-by-mode
title: Review by mode
mode: doc-review
---
${BODY}`,
      '/qa/wordforge-desktop/2026-07-27-review-by-mode.md'
    )

    expect(review.mode).toBe('doc-review')
    expect(review.items).toEqual([])
    expect(review.degraded).toBe(false)
    expect(review.document?.headings.map((heading) => heading.id)).toContain('motivation')
  })

  test('bodyMarkdown round-trips the Snapshot verbatim (single leading newline stripped)', () => {
    const r = parseRequest(REVIEW, '/x.md')
    expect(r.document?.bodyMarkdown).toBe(BODY.replace(/^\n/, ''))
  })

  test('a doc-review with broken YAML (kind salvaged) still takes the review path', () => {
    const broken = `---
title: Skills layer PRD — the one the grill produced
and this line breaks the YAML
kind: doc-review
---
${BODY}`
    const r = parseRequest(broken, '/qa/wordforge-desktop/2026-07-19-review-skills-prd.md')
    expect(r.fmSalvaged).toBe(true)
    expect(r.items).toEqual([])
    expect(r.degraded).toBe(false)
    expect(r.document?.headings.map((h) => h.id)).toEqual([
      'motivation',
      'roles',
      'escalation-path',
      'open-questions'
    ])
  })

  test('a "## heading" quoted inside a code fence never becomes a TOC entry', () => {
    const fenced = `---
id: fence-review
kind: doc-review
---
## Real section

The contract quotes the request format:

\`\`\`markdown
## Fresh install shows 0.7.0 {#install}
**Steps**
\`\`\`

## Another real section

~~~
## also not a heading
~~~
`
    const r = parseRequest(fenced, '/x.md')
    expect(r.document?.headings.map((h) => h.id)).toEqual(['real-section', 'another-real-section'])
    // The fenced examples stay verbatim in the Snapshot body.
    expect(r.document?.bodyMarkdown).toContain('## Fresh install shows 0.7.0 {#install}')
  })
})
