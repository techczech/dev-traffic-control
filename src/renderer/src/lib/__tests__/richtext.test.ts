import { expect, test } from 'vitest'
import { isValidElement } from 'react'
import { parseDocBlocks, renderBold, renderRuns, runsText, tokenizeInline } from '../richtext'
import { parseRequest } from '../../../../main/qa/parseRequest'

test('plain text with no markup yields a single string node', () => {
  const nodes = renderBold('just plain text')
  expect(nodes).toEqual(['just plain text'])
})

test('renders **bold** as a strong element between text runs', () => {
  const nodes = renderBold('a **b** c')
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toBe('a ')
  expect(nodes[2]).toBe(' c')
  const strong = nodes[1]
  expect(isValidElement(strong)).toBe(true)
  expect((strong as React.ReactElement).type).toBe('strong')
  expect((strong as React.ReactElement<{ children: string }>).props.children).toBe('b')
})

test('multiple bold spans each become their own strong element', () => {
  const nodes = renderBold('**one** and **two**')
  const strongs = nodes.filter((n) => isValidElement(n))
  expect(strongs).toHaveLength(2)
})

test('an unclosed ** is left as literal text', () => {
  const nodes = renderBold('unmatched ** stays')
  expect(nodes).toEqual(['unmatched ** stays'])
})

test('the strong content is not HTML — React escapes it, no dangerous markup', () => {
  const nodes = renderBold('x **<img src=x>** y')
  const strong = nodes.find((n) => isValidElement(n)) as React.ReactElement<{ children: string }>
  // The angle-bracket text is carried as a plain string child, never raw HTML.
  expect(strong.props.children).toBe('<img src=x>')
})

// ---------------------------------------------------------------------------
// Reading-surface block parser (M7 T2)

test('tokenizeInline: code, links, bold and italic each become styled runs', () => {
  const runs = tokenizeInline('a `code` [link](https://x.test) **bold** *it* _u_ z')
  expect(runs).toEqual([
    { text: 'a ', style: 'plain' },
    { text: 'code', style: 'code' },
    { text: ' ', style: 'plain' },
    { text: 'link', style: 'plain', href: 'https://x.test' },
    { text: ' ', style: 'plain' },
    { text: 'bold', style: 'bold' },
    { text: ' ', style: 'plain' },
    { text: 'it', style: 'italic' },
    { text: ' ', style: 'plain' },
    { text: 'u', style: 'italic' },
    { text: ' z', style: 'plain' }
  ])
})

test('tokenizeInline: intra-word underscores and unmatched markers stay literal', () => {
  expect(runsText(tokenizeInline('file_names_like_this and 2 ** 3'))).toBe(
    'file_names_like_this and 2 ** 3'
  )
  expect(tokenizeInline('file_names_like_this').every((r) => r.style === 'plain')).toBe(true)
})

test('parseDocBlocks: headings, paragraphs, lists and code blocks', () => {
  const blocks = parseDocBlocks(
    [
      '# Title',
      '',
      '## Context',
      '',
      'One paragraph',
      'joined across lines.',
      '',
      '- first',
      '- second',
      '  - nested',
      '',
      '1. one',
      '2. two',
      '',
      '### Deeper {#pin}',
      '',
      '```',
      '## not-a-heading',
      'verbatim   spacing',
      '```'
    ].join('\n')
  )
  expect(blocks.map((b) => b.kind)).toEqual([
    'title',
    'heading',
    'para',
    'list',
    'list',
    'heading',
    'code'
  ])
  const h2 = blocks[1] as Extract<(typeof blocks)[number], { kind: 'heading' }>
  expect(h2.level).toBe(2)
  expect(h2.id).toBe('context')
  const para = blocks[2] as Extract<(typeof blocks)[number], { kind: 'para' }>
  expect(runsText(para.runs)).toBe('One paragraph joined across lines.')
  const ul = blocks[3] as Extract<(typeof blocks)[number], { kind: 'list' }>
  expect(ul.ordered).toBe(false)
  expect(ul.items).toHaveLength(2)
  expect(ul.items[1].sub?.items.map(runsText)).toEqual(['nested'])
  const ol = blocks[4] as Extract<(typeof blocks)[number], { kind: 'list' }>
  expect(ol.ordered).toBe(true)
  const h3 = blocks[5] as Extract<(typeof blocks)[number], { kind: 'heading' }>
  expect(h3.id).toBe('pin')
  const code = blocks[6] as Extract<(typeof blocks)[number], { kind: 'code' }>
  // Fenced content is verbatim — the "## not-a-heading" never becomes a heading.
  expect(code.text).toBe('## not-a-heading\nverbatim   spacing')
})

test('parseDocBlocks: unknown constructs render as plain paragraph text, nothing dropped', () => {
  const blocks = parseDocBlocks('#### deep heading\n\n> a quote\n\n| a | b |')
  expect(blocks.map((b) => b.kind)).toEqual(['para', 'para', 'para'])
  expect(
    blocks.map((b) => runsText((b as Extract<(typeof blocks)[number], { kind: 'para' }>).runs))
  ).toEqual(['#### deep heading', '> a quote', '| a | b |'])
})

test('parseDocBlocks: an unclosed fence keeps its content', () => {
  const blocks = parseDocBlocks('```\nstill here')
  expect(blocks).toEqual([{ kind: 'code', text: 'still here' }])
})

test('parseDocBlocks heading ids match parseDocument TOC ids exactly (shared slug logic)', () => {
  const body = [
    '## Context',
    '## Context', // dedup → context-2
    '### Pinned {#roles}',
    '```',
    '## fenced-not-a-heading',
    '```',
    '## Consequences & risks'
  ].join('\n')
  const request = parseRequest(`---\nkind: doc-review\n---\n${body}\n`, '/tmp/x.md')
  const tocIds = request.document?.headings.map((h) => h.id)
  const renderedIds = parseDocBlocks(body).flatMap((b) => (b.kind === 'heading' ? [b.id] : []))
  expect(renderedIds).toEqual(['context', 'context-2', 'roles', 'consequences-risks'])
  expect(renderedIds).toEqual(tocIds)
})

test('renderRuns: links render as external anchors, styles map to elements', () => {
  const nodes = renderRuns(tokenizeInline('[docs](https://x.test) `c` **b** *i*'))
  const link = nodes[0] as React.ReactElement<{ href: string; target: string }>
  expect(link.type).toBe('a')
  expect(link.props.href).toBe('https://x.test')
  expect(link.props.target).toBe('_blank')
  expect((nodes[2] as React.ReactElement).type).toBe('code')
  expect((nodes[4] as React.ReactElement).type).toBe('strong')
  expect((nodes[6] as React.ReactElement).type).toBe('em')
})

test('markdown tables parse into a table block with header + rows', () => {
  const md = `Intro line.

| Key | Default |
| --- | --- |
| \`⌘⇧P\` | Palette |
| \`⌘K\` | Actions |

After.`
  const blocks = parseDocBlocks(md)
  const table = blocks.find((b) => b.kind === 'table')
  expect(table).toBeTruthy()
  if (table?.kind === 'table') {
    expect(runsText(table.header[0])).toBe('Key')
    expect(runsText(table.header[1])).toBe('Default')
    expect(table.rows).toHaveLength(2)
    expect(runsText(table.rows[0][0])).toBe('⌘⇧P')
    expect(runsText(table.rows[1][1])).toBe('Actions')
  }
  // The surrounding prose still parses as paragraphs.
  expect(blocks.filter((b) => b.kind === 'para')).toHaveLength(2)
})

test('a pipe line without a separator is NOT a table (stays prose)', () => {
  const blocks = parseDocBlocks('this | that | other')
  expect(blocks.some((b) => b.kind === 'table')).toBe(false)
  expect(blocks[0].kind).toBe('para')
})

test('block image parses into an image block', () => {
  const blocks = parseDocBlocks('![a mockup](https://x.test/m.png)')
  expect(blocks[0]).toEqual({ kind: 'image', alt: 'a mockup', src: 'https://x.test/m.png' })
})

test('an ```html or ```svg fence becomes an embed; other fences stay code', () => {
  const html = parseDocBlocks('```html\n<button>Go</button>\n```')
  expect(html[0]).toEqual({ kind: 'embed', lang: 'html', code: '<button>Go</button>' })
  const svg = parseDocBlocks('```svg\n<svg><rect/></svg>\n```')
  expect(svg[0].kind).toBe('embed')
  const code = parseDocBlocks('```ts\nconst x = 1\n```')
  expect(code[0].kind).toBe('code')
})

test('a ```decision fence with options becomes a decision block', () => {
  const md = '```decision\nWhich sidebar placement?\n- Left\n- Right\n- Neither\n```'
  const blocks = parseDocBlocks(md)
  const d = blocks.find((b) => b.kind === 'decision')
  expect(d).toBeTruthy()
  if (d?.kind === 'decision') {
    expect(runsText(d.question)).toBe('Which sidebar placement?')
    expect(d.options).toEqual(['Left', 'Right', 'Neither'])
    expect(d.id).toBe('which-sidebar-placement')
  }
})

test('a decision fence with no options gets the default verdict trio', () => {
  const blocks = parseDocBlocks('```decision\nAdopt the 70/30 layout?\n```')
  const d = blocks[0]
  expect(d.kind).toBe('decision')
  if (d.kind === 'decision') {
    expect(d.options).toEqual(['Approve', 'Needs change', 'Reject'])
  }
})

test('a decision fence honours a {#id} pin and strips a Q: prefix', () => {
  const blocks = parseDocBlocks('```decision {#layout}\nQ: Adopt the layout?\n- Yes\n- No\n```')
  const d = blocks[0]
  expect(d.kind).toBe('decision')
  if (d.kind === 'decision') {
    expect(d.id).toBe('layout')
    expect(runsText(d.question)).toBe('Adopt the layout?')
    expect(d.options).toEqual(['Yes', 'No'])
  }
})

test('a data-URL image with spaces and raw markup still parses as an image', () => {
  const line =
    '![tick](data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120"><rect width="120" height="60"/></svg>)'
  const blocks = parseDocBlocks(line)
  expect(blocks[0].kind).toBe('image')
  if (blocks[0].kind === 'image') {
    expect(blocks[0].alt).toBe('tick')
    expect(blocks[0].src).toContain('<svg xmlns=')
    expect(blocks[0].src.endsWith('</svg>')).toBe(true)
  }
})

// ---- decisions linked to pictures (ticket 29) -------------------------------

function decisionOf(
  md: string
): Extract<ReturnType<typeof parseDocBlocks>[number], { kind: 'decision' }> {
  const d = parseDocBlocks(md).find((b) => b.kind === 'decision')
  if (!d || d.kind !== 'decision') throw new Error('no decision')
  return d
}

test('a picture on an option line links to that option and leaves its label', () => {
  const d = decisionOf(
    '```decision {#shelf}\nWhich?\n- AS-3A: shelf with a cleaning rail ![](as-3a.png)\n- AS-3B: bench ![the bench](as-3b.png) ![](as-3b-2.png)\n- Neither: redraw\n```'
  )
  expect(d.options).toEqual([
    'AS-3A: shelf with a cleaning rail',
    'AS-3B: bench',
    'Neither: redraw'
  ])
  expect(d.pictures[0]).toEqual([{ src: 'as-3a.png', alt: '' }])
  expect(d.pictures[1]).toEqual([
    { src: 'as-3b.png', alt: 'the bench' },
    { src: 'as-3b-2.png', alt: '' }
  ])
  expect(d.pictures[2]).toEqual([])
})

test('with no inline picture, same-section images whose alt starts with the short label and a colon link', () => {
  const blocks = parseDocBlocks(
    [
      '## Home',
      '```decision {#home}',
      'Which?',
      '- AS-3A: one card',
      '- AS-3B: a table',
      '- Neither: redraw',
      '```',
      '![AS-3A: one card per corpus](a.png)',
      '![AS-3B: a compact table](b.png)',
      '![unrelated](c.png)'
    ].join('\n')
  )
  const d = blocks.find((b) => b.kind === 'decision')
  if (d?.kind !== 'decision') throw new Error('no decision')
  expect(d.section).toBe('home')
  expect(d.pictures[0]).toEqual([{ src: 'a.png', alt: 'AS-3A: one card per corpus' }])
  expect(d.pictures[1]).toEqual([{ src: 'b.png', alt: 'AS-3B: a compact table' }])
  expect(d.pictures[2]).toEqual([])
  // linked images are not repeated in the body; the unrelated one stays
  const images = blocks.filter((b) => b.kind === 'image')
  expect(images).toHaveLength(1)
  expect(images[0].kind === 'image' && images[0].src).toBe('c.png')
})

test('fallback matching is exact: `A:` does not match option `AS-3A`, and other sections do not count', () => {
  const blocks = parseDocBlocks(
    [
      '## One',
      '```decision {#one}',
      'Which?',
      '- AS-3A',
      '- AS-3B',
      '```',
      '![A: old style alt](a.png)',
      '![AS-3A shelf](b.png)',
      '## Two',
      '![AS-3A: in another section](c.png)'
    ].join('\n')
  )
  const d = blocks.find((b) => b.kind === 'decision')
  if (d?.kind !== 'decision') throw new Error('no decision')
  expect(d.pictures).toEqual([[], []])
  expect(blocks.filter((b) => b.kind === 'image')).toHaveLength(3)
})

test('a decision with an inline picture ignores the alt-text fallback', () => {
  const d = decisionOf(
    '## S\n```decision {#s}\nWhich?\n- AS-3A: one ![](inline.png)\n- AS-3B: two\n```\n![AS-3B: two](alt.png)'
  )
  expect(d.pictures[0]).toHaveLength(1)
  expect(d.pictures[1]).toEqual([])
})

test('an old record with no linkage parses as before: no pictures, images stay in the body', () => {
  const blocks = parseDocBlocks(
    '## S\n```decision {#s}\nWhich?\n- Left\n- Right\n```\n![A: left](a.png)'
  )
  const d = blocks.find((b) => b.kind === 'decision')
  if (d?.kind !== 'decision') throw new Error('no decision')
  expect(d.options).toEqual(['Left', 'Right'])
  expect(d.pictures).toEqual([[], []])
  expect(blocks.some((b) => b.kind === 'image')).toBe(true)
})
