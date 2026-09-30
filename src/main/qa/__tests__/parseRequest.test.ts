import { describe, expect, test } from 'vitest'
import { parseRequest } from '../parseRequest'

const GOOD = `---
id: title-padding-01813
title: Title padding fixes
app: TallyBoard
version: 0.18.13
gate: 4
kind: recheck
intro: Recheck after the 0.18.12 padding fail.
---

## Title slide 30% sidebar

ADR-0015 moved the negative space left.

**Steps**
- Open **TallyBoard** → talk **York AI Teaching** → press **⌘P**
- Arrow to the title slide

**Expected**
- Title occupies the **right 70%**, no text clipped
- Sidebar keeps **30% width** at every size

**Notes**
- Compare at narrow and full width

## QR overlap fix {#qr-fix}

**Steps**
1. Show the closing slide

**Expected**
- QR sits clear of the title block
`

describe('parseRequest', () => {
  test('parses frontmatter into fields and labels', () => {
    const r = parseRequest(GOOD, '/qa/tallyboard/2026-07-18-title-padding-0.18.13.md')
    expect(r.id).toBe('title-padding-01813')
    expect(r.app).toBe('TallyBoard')
    expect(r.labels.gate).toBe('4')
    expect(r.labels.kind).toBe('recheck')
    expect(r.degraded).toBe(false)
  })

  test('one item per ## heading with sections', () => {
    const r = parseRequest(GOOD, '/x.md')
    expect(r.items).toHaveLength(2)
    expect(r.items[0].id).toBe('title-slide-30-sidebar')
    expect(r.items[0].context).toContain('ADR-0015')
    expect(r.items[0].steps).toHaveLength(2)
    expect(r.items[0].expected[0]).toContain('right 70%')
    expect(r.items[0].notes).toHaveLength(1)
  })

  test('explicit {#id} wins and is stripped from title', () => {
    const r = parseRequest(GOOD, '/x.md')
    expect(r.items[1].id).toBe('qr-fix')
    expect(r.items[1].title).toBe('QR overlap fix')
  })

  test('numbered lists parse as steps too', () => {
    const r = parseRequest(GOOD, '/x.md')
    expect(r.items[1].steps).toEqual(['Show the closing slide'])
  })

  test('duplicate heading slugs get -2 suffix', () => {
    const dup = GOOD + '\n## QR overlap fix\n\n**Steps**\n- again\n'
    const r = parseRequest(dup, '/x.md')
    expect(r.items[2].id).toBe('qr-overlap-fix')
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

  // Pre-M6 this expected degraded: true; T1 salvage means broken YAML with
  // parseable items is no longer degraded (tolerant path: parseRequest.tolerant.test.ts).
  test('broken YAML → salvaged, not thrown', () => {
    const r = parseRequest('---\n:{ nope\n---\n## A\n**Steps**\n- s\n', '/x.md')
    expect(r.degraded).toBe(false)
    expect(r.fmSalvaged).toBe(true)
    expect(r.items).toHaveLength(1)
  })
})
