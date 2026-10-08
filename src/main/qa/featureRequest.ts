/**
 * The optional frontmatter that turns a roadmap idea into a feature request.
 * The idea file stays the one record: an idea without these keys
 * parses as before, and a key with an odd value is dropped, never an error.
 */

export const REQUEST_FATES = [
  'waiting',
  'planned',
  'building',
  'built',
  'merged',
  'declined'
] as const
export type RequestFate = (typeof REQUEST_FATES)[number]

/** `reviewer` is the person who reviews; `agent` is an agent's own idea. */
export type RequestAuthor = 'reviewer' | 'agent'

export interface RequestSaid {
  where: string
  when: string
  link: string
}

export interface FeatureRequestFields {
  by?: RequestAuthor
  /** Where and when the reviewer said it; one entry per quote, in order. */
  said: RequestSaid[]
  /** The reviewer's exact words. */
  quotes: string[]
  context?: string
  plan?: string
  /** Absent when the file has none or names one this app does not know. */
  fate?: RequestFate
  fateNote?: string
  /** Record ids or `dtc://` links. */
  related: string[]
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10)
  if (typeof value === 'object') return undefined
  const trimmed = String(value).trim()
  return trimmed || undefined
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  )
}

function author(value: unknown): RequestAuthor | undefined {
  const by = text(value)?.toLowerCase()
  if (by === 'reviewer') return 'reviewer'
  if (by === 'agent') return 'agent'
  return undefined
}

function fate(value: unknown): RequestFate | undefined {
  const word = text(value)?.toLowerCase()
  return REQUEST_FATES.find((candidate) => candidate === word)
}

function said(value: unknown): RequestSaid[] {
  return list(value).flatMap((entry): RequestSaid[] => {
    if (!isRecord(entry)) return []
    const where = text(entry.where) ?? ''
    const when = text(entry.when) ?? ''
    const link = text(entry.link) ?? ''
    return where || when || link ? [{ where, when, link }] : []
  })
}

/**
 * The request fields of one idea's frontmatter, or `undefined` when it carries
 * none of them (a plain roadmap idea).
 */
export function parseFeatureRequest(
  frontmatter: Record<string, unknown>
): FeatureRequestFields | undefined {
  const request: FeatureRequestFields = {
    ...(author(frontmatter.by) ? { by: author(frontmatter.by) } : {}),
    said: said(frontmatter.said),
    quotes: list(frontmatter.quote).flatMap((quote) => text(quote) ?? []),
    ...(text(frontmatter.context) ? { context: text(frontmatter.context) } : {}),
    ...(text(frontmatter.plan) ? { plan: text(frontmatter.plan) } : {}),
    ...(fate(frontmatter.fate) ? { fate: fate(frontmatter.fate) } : {}),
    ...(text(frontmatter.fate_note) ? { fateNote: text(frontmatter.fate_note) } : {}),
    related: list(frontmatter.related).flatMap((entry) => text(entry) ?? [])
  }
  const declared = ['by', 'said', 'quote', 'context', 'plan', 'fate', 'fate_note', 'related'].some(
    (key) => frontmatter[key] !== undefined
  )
  return declared ? request : undefined
}

/** A feature request is an idea the reviewer said, not one an agent proposed. */
export function isFeatureRequest(request: FeatureRequestFields | undefined): boolean {
  return request?.by === 'reviewer'
}
