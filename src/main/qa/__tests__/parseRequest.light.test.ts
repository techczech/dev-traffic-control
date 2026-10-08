import { describe, expect, test } from 'vitest'
import { parseRequest } from '../parseRequest'
import { ROOT_AGENTS_MD } from '../templates'

function lightWorkedExample(extraFrontmatter = ''): string {
  const section = ROOT_AGENTS_MD.slice(ROOT_AGENTS_MD.indexOf('### Worked example — light'))
  const fence = section.match(/```markdown\n([\s\S]*?)```/)
  if (!fence) throw new Error('light worked example missing from root template')
  if (!extraFrontmatter) return fence[1]
  return fence[1].replace(/^---\n/, `---\n${extraFrontmatter}`)
}

describe('parseRequest light requests', () => {
  test('flat worked example auto-detects light with three checks and three parked items', () => {
    const r = parseRequest(lightWorkedExample(), '/qa/windmill/2026-07-26-images.md')

    expect(r.mode).toBe('light')
    expect(r.items).toHaveLength(3)
    expect(r.parked).toHaveLength(3)
    expect(r.items.every((item) => item.steps.length === 0 && item.expected.length === 0)).toBe(true)
  })

  test('carried Steps declines auto-detection but explicit mode light wins', () => {
    const withSteps = lightWorkedExample().replace(
      'Copy any picture, **⌘V** into a piece — it appears **inline**, not a broken box.',
      `Copy any picture, **⌘V** into a piece — it appears **inline**, not a broken box.

**Steps**
- Copy a picture
- Paste it into a piece`
    )

    expect(parseRequest(withSteps, '/x.md').mode).toBe('test')
    expect(parseRequest(withSteps.replace(/^---\n/, '---\nmode: light\n'), '/x.md').mode).toBe(
      'light'
    )
  })

  test('the v6 detailed shape resolves to test mode', () => {
    const detailed = `---
id: detailed
title: Detailed request
---
## Cover page 30% sidebar
The layout moved the empty space to the left.

**Steps**
- Open the cover page

**Expected**
- The sidebar keeps 30% width
`
    expect(parseRequest(detailed, '/x.md').mode).toBe('test')
  })

  test('explicit mode detailed keeps a flat request in the detailed Runner', () => {
    const r = parseRequest(lightWorkedExample('mode: detailed\n'), '/x.md')
    expect(r.mode).toBe('test')
    expect(r.labels.mode).toBeUndefined()
  })

  test('kind doc-review wins over mode light', () => {
    const review = `---
id: review
title: Review
kind: doc-review
mode: light
---
## Snapshot section

Read this.
`
    const r = parseRequest(review, '/x.md')
    expect(r.mode).toBe('doc-review')
    expect(r.document?.headings).toHaveLength(1)
    expect(r.items).toEqual([])
  })

  test('parked ids are also-prefixed, unique, and share the item id namespace', () => {
    const raw = `---
id: parked-ids
title: Parked ids
---
## Also same wording
This is the check.

## Also worth checking
- Same wording
- Same wording
`
    const r = parseRequest(raw, '/x.md')
    const allIds = [...r.items.map((item) => item.id), ...r.parked.map((item) => item.id)]

    expect(r.parked.map((item) => item.id)).toEqual([
      'also-same-wording-2',
      'also-same-wording-3'
    ])
    expect(r.parked.every((item) => item.id.startsWith('also-'))).toBe(true)
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  test('a parked-only request is legal, light, and not degraded', () => {
    const raw = `---
id: parked-only
title: Parked only
---
## Also worth checking
- Try the export sheet
`
    const r = parseRequest(raw, '/x.md')

    expect(r.mode).toBe('light')
    expect(r.degraded).toBe(false)
    expect(r.items).toEqual([])
    expect(r.parked).toEqual([{ id: 'also-try-the-export-sheet', text: 'Try the export sheet' }])
  })

  test('an explicit id on the parked heading is stripped before matching', () => {
    const raw = `---
id: parked-pin
title: Parked pin
---
## Also worth checking {#pin}
- Check the fallback
`
    const r = parseRequest(raw, '/x.md')

    expect(r.mode).toBe('light')
    expect(r.items).toEqual([])
    expect(r.parked).toEqual([{ id: 'also-check-the-fallback', text: 'Check the fallback' }])
  })

  test('explicit light mode does not make a prose-only degraded request actionable', () => {
    const raw = `---
id: degraded-light
title: Degraded light
mode: light
---
This request contains prose but no check headings.
`
    const r = parseRequest(raw, '/x.md')

    expect(r.mode).toBe('light')
    expect(r.degraded).toBe(true)
    expect(r.items).toEqual([])
    expect(r.parked).toEqual([])
  })

  test.each([
    '## Also worth checking:',
    '## Also worth checking (optional)',
    '## Also worth checking.'
  ])('%s is recognised as the reserved parked heading', (heading) => {
    const r = parseRequest(
      `---
id: loose-parked-heading
title: Loose parked heading
---
${heading}
- Try the export sheet
`,
      '/x.md'
    )

    expect(r.mode).toBe('light')
    expect(r.items).toEqual([])
    expect(r.parked).toEqual([
      { id: 'also-try-the-export-sheet', text: 'Try the export sheet' }
    ])
  })

  test('a heading that merely starts with the parked phrase remains an ordinary check', () => {
    const r = parseRequest(
      `---
id: ordinary-check
title: Ordinary check
---
## Also worth checking the export sheet
It reopens in the folder you last used.
`,
      '/x.md'
    )

    expect(r.mode).toBe('light')
    expect(r.parked).toEqual([])
    expect(r.items).toEqual([
      {
        id: 'also-worth-checking-the-export-sheet',
        title: 'Also worth checking the export sheet',
        context: 'It reopens in the folder you last used.',
        steps: [],
        expected: [],
        notes: []
      }
    ])
  })

  test.each([
    {
      label: 'a soft-wrapped single paragraph',
      body: `It appears inline and survives a save and reopen, and the
thumbnail is not blank.`,
      mode: 'light'
    },
    {
      label: 'two prose paragraphs',
      body: `It appears inline.

The thumbnail is not blank.`,
      mode: 'test'
    },
    {
      label: 'a bold procedure label followed by bullets',
      body: `**Steps:**
- Open the export sheet
- Choose Word`,
      mode: 'test'
    }
  ])('auto-detection treats $label as $mode', ({ body, mode }) => {
    const r = parseRequest(
      `---
id: paragraph-shape
title: Paragraph shape
---
## Export keeps the picture
${body}
`,
      '/x.md'
    )

    expect(r.mode).toBe(mode)
  })

  test('a fully bolded single sentence stays light', () => {
    const r = parseRequest(
      `---
id: bold-flat-shape
title: Bold flat shape
---
## Export keeps the picture
**It appears inline, not a broken box.**
`,
      '/x.md'
    )

    expect(r.mode).toBe('light')
  })

  test.each([
    {
      label: 'a Steps label with its colon inside the bold text',
      body: `**Steps:**
- Open the export sheet`
    },
    {
      label: 'a differently worded bold-only procedure label',
      body: `**How to check**
- Open the export sheet`
    },
    {
      label: 'plain numbered steps with no label',
      body: `1. Open the export sheet
2. Choose Word`
    }
  ])('auto-detection keeps $label in detailed test mode', ({ body }) => {
    const r = parseRequest(
      `---
id: detailed-near-miss
title: Detailed near miss
---
## Export keeps the picture
The image should survive export.

${body}
`,
      '/x.md'
    )

    expect(r.mode).toBe('test')
  })
})
