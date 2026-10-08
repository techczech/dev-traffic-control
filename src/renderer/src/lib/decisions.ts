import { slugify } from '../../../main/qa/slug'
import { optionShortLabel, runsText } from './richtext'
import type { DocBlock, OptionPicture } from './richtext'

/** One decision as the rail, the card and the big view all describe it. */
export interface DecisionInfo {
  id: string
  question: string
  /** The rail's name: the humanised `{#id}`. */
  name: string
  section: string | null
  sectionTitle: string | null
  number: number // 1-based position in the document
  total: number
  options: string[]
  pictures: OptionPicture[][]
  /** Indexes of options that carry at least one picture. */
  pictured: number[]
}

/**
 * `library-home` -> `Library home`. Words that the question or section title
 * writes in capitals (`QS`) keep that spelling. An id that is only the slug of
 * the question falls back to the question itself.
 */
export function humaniseDecisionId(id: string, hints: string[]): string {
  const caps = new Map<string, string>()
  for (const hint of hints) {
    for (const w of hint.match(/[A-Za-z][A-Za-z0-9]+/g) ?? []) {
      if (w.length > 1 && w === w.toUpperCase()) caps.set(w.toLowerCase(), w)
    }
  }
  const words = id.split(/[-_\s]+/).filter(Boolean)
  const text = words.map((w, i) => caps.get(w.toLowerCase()) ?? (i === 0 ? cap(w) : w)).join(' ')
  return text
}

function cap(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** Every decision in document order, with its section and number. */
export function listDecisions(
  blocks: DocBlock[],
  headings: { id: string; title: string }[]
): DecisionInfo[] {
  const titles = new Map(headings.map((h) => [h.id, h.title]))
  const found = blocks.filter((b): b is Extract<DocBlock, { kind: 'decision' }> => {
    return b.kind === 'decision'
  })
  return found.map((b, i) => {
    const question = runsText(b.question)
    const sectionTitle = b.section ? (titles.get(b.section) ?? null) : null
    // An id that is only the question's own slug was never pinned: use the question.
    const slug = slugify(question)
    const derived = !!slug && (b.id === slug || b.id.startsWith(`${slug}-`))
    const name = derived ? question : humaniseDecisionId(b.id, [question, sectionTitle ?? ''])
    return {
      id: b.id,
      question,
      name: name || question,
      section: b.section,
      sectionTitle,
      number: i + 1,
      total: found.length,
      options: b.options,
      pictures: b.pictures,
      pictured: b.pictures.flatMap((p, o) => (p.length > 0 ? [o] : []))
    }
  })
}

/** The rail chip for an answer: the pick's short label, `''` when undecided. */
export function pickChip(choice: string): string {
  return choice ? optionShortLabel(choice) : ''
}

/** How many decisions have a pick. */
export function decidedCount(
  decisions: DecisionInfo[],
  answers: Map<string, { choice: string }>
): number {
  return decisions.filter((d) => !!answers.get(d.id)?.choice).length
}
