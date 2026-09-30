import { describe, expect, test } from 'vitest'
import { isEntry, parseEntry } from '../entry'

const FB = '2026-01-01T00:00:00.000Z' // fallback mtime

describe('parseEntry', () => {
  test('by: reviewer is read as the human author', () => {
    const raw = '---\nthread: t\nby: reviewer\nat: 2026-07-23T09:56:00.000Z\n---\nText\n'
    expect(parseEntry(raw, '/qa/p/2026-07-23-0956-entry-x.md', FB).by).toBe('reviewer')
  })

  test('reads a full frontmatter block', () => {
    const raw = `---
thread: roadmap-in-dev-traffic-control
by: dominik
written_by: agent
at: 2026-07-23T09:56:00.000Z
title: Roadmaps across projects
projects: [dev-traffic-control, backlog]
parents: [dev-traffic-control-spine]
move: agent
form: graft
state: open
dictation: true
---
Body line one.
`
    const e = parseEntry(raw, '/qa/dev-traffic-control/threads/2026-07-23-0956-entry-x.md', FB)
    expect(e.thread).toBe('roadmap-in-dev-traffic-control')
    expect(e.by).toBe('dominik')
    expect(e.writtenBy).toBe('agent')
    expect(e.at).toBe('2026-07-23T09:56:00.000Z')
    expect(e.title).toBe('Roadmaps across projects')
    expect(e.projects).toEqual(['dev-traffic-control', 'backlog'])
    expect(e.parents).toEqual(['dev-traffic-control-spine'])
    expect(e.move).toBe('agent')
    expect(e.form).toBe('graft')
    expect(e.state).toBe('open')
    expect(e.dictation).toBe(true)
    expect(e.body.trim()).toBe('Body line one.')
  })

  test('a bare thread key defaults everything else', () => {
    const raw = `---
thread: t1
---
Hi.`
    const e = parseEntry(raw, '/qa/p/2026-07-24-1200-entry-a.md', FB)
    expect(e.thread).toBe('t1')
    expect(e.by).toBe('agent')
    expect(e.writtenBy).toBe('agent')
    expect(e.move).toBeUndefined()
    expect(e.form).toBeUndefined()
    expect(e.projects).toEqual([])
    expect(e.parents).toEqual([])
  })

  test('no thread key derives the thread from the filename', () => {
    const raw = `Just a body, no frontmatter.`
    const e = parseEntry(raw, '/qa/p/2026-07-24-1200-entry-rename-the-app.md', FB)
    expect(e.thread).toBe('rename-the-app')
  })

  test('garbled YAML is salvaged, not abandoned (dictation fixture)', () => {
    const raw = `---
thread: dictated-thought
by: dominik
dictation: true
title: this one has an unquoted: colon that breaks yaml
---
Rambly dictated body.`
    const e = parseEntry(raw, '/qa/p/2026-07-24-1200-entry-d.md', FB)
    expect(e.fmSalvaged).toBe(true)
    expect(e.thread).toBe('dictated-thought')
    expect(e.by).toBe('dominik')
    expect(e.dictation).toBe(true)
  })

  test('projects accept a comma-separated string as well as a list', () => {
    const raw = `---
thread: t
projects: dev-traffic-control, bramble , tallyboard
---
x`
    expect(parseEntry(raw, '/qa/p/2026-07-24-1200-entry-t.md', FB).projects).toEqual([
      'dev-traffic-control',
      'bramble',
      'tallyboard'
    ])
  })

  test('an order list with a project sibling becomes a rank assertion', () => {
    const raw = `---
thread: order-holder
project: dev-traffic-control
order: [a, b, c]
---
x`
    const e = parseEntry(raw, '/qa/p/2026-07-24-1200-entry-o.md', FB)
    expect(e.order).toEqual({ project: 'dev-traffic-control', threads: ['a', 'b', 'c'] })
    expect(e.labels.project).toBeUndefined() // consumed, not leaked to labels
  })

  test('at resolves frontmatter → filename → fallback', () => {
    const fmAt = parseEntry(
      `---\nthread: t\nat: 2026-07-01T08:00:00.000Z\n---\nx`,
      '/p/2026-07-24-1200-entry-t.md',
      FB
    )
    expect(fmAt.at).toBe('2026-07-01T08:00:00.000Z')
    const fileAt = parseEntry(`---\nthread: t\n---\nx`, '/p/2026-07-24-1330-entry-t.md', FB)
    expect(fileAt.at).toBe('2026-07-24T13:30:00.000Z')
    const fbAt = parseEntry(`---\nthread: t\n---\nx`, '/p/no-date-entry-t.md', FB)
    expect(fbAt.at).toBe(FB)
  })

  test('unknown keys fall to labels', () => {
    const e = parseEntry(
      `---\nthread: t\nversion: 0.5.0\n---\nx`,
      '/p/2026-07-24-1200-entry-t.md',
      FB
    )
    expect(e.labels.version).toBe('0.5.0')
  })
})

describe('isEntry', () => {
  test('true on an -entry- filename marker', () => {
    expect(isEntry('2026-07-24-1200-entry-x.md', 'no frontmatter here')).toBe(true)
  })
  test('true on a thread: frontmatter key even without the marker', () => {
    expect(isEntry('2026-07-24-seed.md', '---\nthread: t\n---\nbody')).toBe(true)
  })
  test('false on an ordinary request', () => {
    expect(isEntry('2026-07-18-title-padding.md', '---\ngate: 4\n---\n## Item\n')).toBe(false)
  })
})
