import { describe, expect, test } from 'vitest'
import { parseRequest } from '../parseRequest'

const GOOD = `---
id: title-spacing-042
title: Title spacing fixes
app: Tangram
version: 0.4.2
stage: 4
kind: recheck
intro: Recheck after the 0.4.1 spacing fail.
---

## Cover page 30% sidebar

The layout moved the empty space to the left.

**Steps**
- Open **Tangram** → document **Sample Project** → press **⌘P**
- Go to the cover page

**Expected**
- Title occupies the **right 70%**, no text clipped
- Sidebar keeps **30% width** at any window size

**Notes**
- Compare at narrow and full width

## Footer overlap fix {#footer-fix}

**Steps**
1. Show the last page

**Expected**
- The footer sits clear of the title block
`

describe('parseRequest', () => {
  test('parses frontmatter into fields and labels', () => {
    const r = parseRequest(GOOD, '/qa/tangram/2026-07-18-title-spacing-0.4.2.md')
    expect(r.id).toBe('title-spacing-042')
    expect(r.app).toBe('Tangram')
    expect(r.labels.stage).toBe('4')
    expect(r.labels.kind).toBe('recheck')
    expect(r.degraded).toBe(false)
  })

  test('one item per ## heading with sections', () => {
    const r = parseRequest(GOOD, '/x.md')
    expect(r.items).toHaveLength(2)
    expect(r.items[0].id).toBe('cover-page-30-sidebar')
    expect(r.items[0].context).toContain('empty space')
    expect(r.items[0].steps).toHaveLength(2)
    expect(r.items[0].expected[0]).toContain('right 70%')
    expect(r.items[0].notes).toHaveLength(1)
  })

  test('explicit {#id} wins and is stripped from title', () => {
    const r = parseRequest(GOOD, '/x.md')
    expect(r.items[1].id).toBe('footer-fix')
    expect(r.items[1].title).toBe('Footer overlap fix')
  })

  test('numbered lists parse as steps too', () => {
    const r = parseRequest(GOOD, '/x.md')
    expect(r.items[1].steps).toEqual(['Show the last page'])
  })

  test('duplicate heading slugs get -2 suffix', () => {
    const dup = GOOD + '\n## Footer overlap fix\n\n**Steps**\n- again\n'
    const r = parseRequest(dup, '/x.md')
    expect(r.items[2].id).toBe('footer-overlap-fix')
  })

  test('missing frontmatter → degraded, id from basename, never throws', () => {
    const r = parseRequest('# just prose\nhello', '/qa/p/2026-07-18-loose.md')
    expect(r.degraded).toBe(true)
    expect(r.items).toEqual([])
    expect(r.id).toBe('2026-07-18-loose')
    expect(r.raw).toContain('hello')
  })

  test('frontmatter present but no ## items → degraded', () => {
    const r = parseRequest('---\nid: x\ntitle: T\n---\nprose only', '/x.md')
    expect(r.degraded).toBe(true)
  })

  // Broken YAML with parseable items is salvaged, not degraded.
  test('broken YAML → salvaged, not thrown', () => {
    const r = parseRequest('---\n:{ nope\n---\n## A\n**Steps**\n- s\n', '/x.md')
    expect(r.degraded).toBe(false)
    expect(r.fmSalvaged).toBe(true)
    expect(r.items).toHaveLength(1)
  })
})
