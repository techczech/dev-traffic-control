/** Prompt, band and command text. Pure. */

import { plain, safeRef } from './guard'
import { dtcUrl, kindOfRel, linksTo } from './paths'
import type { RequestRef } from './paths'
import { PROMPT_MAX } from './sanitise'
import type { ScanEntry } from './scan'

export function dtcLink(ref: RequestRef, label?: string): string {
  return `[${label ?? `${ref.project}/${ref.rel.replace(/\.md$/, '')}`}](${dtcUrl(ref)})`
}

/**
 * The collect prompt: one fixed template per kind of record (a request, a roadmap idea, a release
 * record, told apart by the path alone) whose only variable is the record's dtc:// link, built
 * from the project and path (never a title, comment, entry or report text). Null when the ref
 * fails `safeRef`, or when the names are so long that the prompt would pass `PROMPT_MAX`
 * characters: such a record is never put into the prompt box.
 */
export function collectPrompt(ref: RequestRef): string | null {
  const safe = safeRef({ project: ref.project, rel: ref.rel })
  if (safe === null) return null
  const prompt = templateFor(safe)
  return prompt.length > PROMPT_MAX ? null : prompt
}

function templateFor(safe: RequestRef): string {
  // Each states what the record shows, never who wrote it: record files carry no proof of authorship.
  switch (kindOfRel(safe.rel)) {
    case 'idea':
      return `A reviewer entry was added to the Dev Traffic Control feature request ${dtcLink(safe)}. Read it with the dtc_answers tool and act on it per the Dev Traffic Control agent contract (AGENTS.md in the records folder), then add your "## Agent entry" section to the idea file and bring its fate and plan up to date.`
    case 'release':
      return `Release verdicts were recorded in Dev Traffic Control for ${dtcLink(safe)}. Read them with the dtc_answers tool, open every screenshot it names, and act on them per the Dev Traffic Control agent contract (AGENTS.md in the records folder).`
    default:
      return `A Dev Traffic Control report was completed for ${dtcLink(safe)}. Read it with the dtc_answers tool and act on it per the Dev Traffic Control agent contract (AGENTS.md in the records folder; decisions are under items[*].decisions), then write the .collected.json receipt.`
  }
}

/** What the band and the pane say when a scan put some reads off to later scans. */
export const MORE_NOT_READ = 'more not read yet'

/** The band line. `unread` is how many reads the last scan put off: the count may then still grow, and the band says so. */
export function bandText(count: number, unread = 0): string | null {
  const more = unread > 0 ? ` · ${MORE_NOT_READ}` : ''
  if (count < 1) return unread > 0 ? `DTC — ${MORE_NOT_READ} · /dtc to list` : null
  return `DTC — ${count} ${count === 1 ? 'answer' : 'answers'} waiting${more} · /dtc to list`
}

export function countsText(c: ScanEntry['counts'], d: ScanEntry['decisions']): string {
  const parts = (['pass', 'partial', 'fail', 'skip', 'unanswered'] as const).filter(k => c[k] > 0).map(k => `${c[k]} ${k}`)
  if (d.total > 0) parts.push(`decisions ${d.answered}/${d.total}`)
  return parts.length === 0 ? 'no verdicts' : parts.join(' · ')
}

export type CollectArgs = { kind: 'list' } | { kind: 'collect'; n: number } | { kind: 'bad'; message: string }

export function parseDtcArgs(args: string): CollectArgs {
  const words = args.trim().split(/\s+/).filter(w => w !== '')
  if (words.length === 0) return { kind: 'list' }
  if (words[0] !== 'collect') return { kind: 'bad', message: `Unknown argument "${words[0]}". Use /dtc or /dtc collect [n].` }
  if (words.length === 1) return { kind: 'collect', n: 1 }
  const n = Number(words[1])
  if (words.length > 2 || !Number.isInteger(n) || n < 1) return { kind: 'bad', message: 'Use /dtc collect [n], n a whole number from 1.' }
  return { kind: 'collect', n }
}

/** Requests the turn wrote whose path the last assistant message never links to. */
export function unlinkedRequests(written: readonly RequestRef[], answer: string): RequestRef[] {
  const seen = new Set<string>()
  const out: RequestRef[] = []
  for (const ref of written) {
    const key = `${ref.project}/${ref.rel}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!linksTo(answer, ref)) out.push(ref)
  }
  return out
}

export function linkToast(ref: RequestRef): string {
  return plain(`DTC request filed without its dtc:// link: ${ref.project}/${ref.rel.replace(/^.*\//, '')}`)
}
