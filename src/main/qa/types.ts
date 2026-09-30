export type Verdict = 'pass' | 'partial' | 'fail' | 'skip'
export type ItemStatus = Verdict | 'unanswered'
export type RunStatus = 'waiting' | 'in-progress' | 'done'
export type NoteStatus = 'draft' | 'handed-over'
export type RequestMode = 'light' | 'test' | 'doc-review'

export interface AgentWatchClaim {
  agent: string
  machine: string
  startedAt: string
  heartbeatAt: string
}

export interface CollectionReceipt {
  agent: string
  machine: string
  collectedAt: string
  note?: string
}

// Thread record (roadmap graft, ADR-0009). A thread is a durable, project-scoped
// topic identified by a virtual `thread:` id, not a folder; its state derives
// from the latest entry that asserts each field.
export type Move = 'me' | 'agent' | 'nobody'
export type Form = 'idea' | 'branch' | 'sidequest' | 'graft' | 'strut'
export type Outcome = 'fused' | 'delivered' | 'abandoned'
export type Author = 'dominik' | 'reviewer' | 'agent'

/** One immutable Markdown contribution to a thread (append-only, ADR-0009). */
export interface ThreadEntry {
  path: string // absolute
  thread: string // the virtual thread id — the only required field
  by: Author // whose content (default 'agent')
  writtenBy: Author // who created the file (default = by)
  at: string // ISO, resolved: frontmatter at → filename → mtime
  title?: string // a title assertion
  projects: string[] // 0..n — membership lives HERE, never in the folder
  parents: string[] // 0..n — zero is legal, not degenerate
  move?: Move
  form?: Form
  state?: 'open' | 'retired'
  outcome?: Outcome
  order?: { project: string; threads: string[] } // a rank assertion
  dictation: boolean // true → read for intent, never pattern-match
  body: string // markdown after the frontmatter block
  labels: Record<string, string> // unrecognised frontmatter keys
  fmSalvaged?: boolean // frontmatter recovered leniently after a YAML failure
}

/** A thread, derived from its entries (never stored mutably, ADR-0009 rule 3). */
export interface Thread {
  id: string
  title: string
  projects: string[] // union across entries, first-assertion order
  parents: string[] // union
  move: Move // latest asserting entry, else 'nobody'
  form: Form // latest asserting entry, else 'idea'
  state: 'open' | 'retired'
  outcome?: Outcome
  entries: ThreadEntry[] // chronological, oldest first
  firstAt: string
  lastAt: string
  ageDays: number // now − lastAt
  cold: boolean // ageDays >= 7
  dictated: boolean // any entry dictated
}

export interface RequestItem {
  id: string // slug of heading, or explicit {#id}
  title: string
  context?: string // prose between heading and first subsection
  steps: string[]
  expected: string[]
  notes: string[]
}

export interface ParkedItem {
  id: string
  text: string
}

export interface DocumentHeading {
  id: string // slug of heading, or explicit {#id} pin
  title: string
  level: 2 | 3 // ## → 2, ### → 3
}

export interface QaRequest {
  id: string // frontmatter id, else file basename
  title: string // frontmatter title, else first H1/H2, else basename
  app?: string
  version?: string
  build?: string
  date?: string
  intro?: string
  labels: Record<string, string> // gate, kind, and any other frontmatter keys
  mode: RequestMode
  items: RequestItem[]
  parked: ParkedItem[]
  degraded: boolean // true → render raw markdown, no cards (ADR-0001)
  fmSalvaged?: boolean // frontmatter recovered by the lenient scanner after a YAML failure
  // Review request (kind: doc-review): the Snapshot for the Reading surface,
  // headings as TOC (ADR-0007). Absent on test requests.
  document?: { headings: DocumentHeading[]; bodyMarkdown: string }
  raw: string
  path: string // absolute path of the .md
}

export interface FlagEntry {
  expectedIndex: number
  text: string
  comment: string
}
export interface QuoteEntry {
  text: string
  comment: string
  section?: string // heading slug the selection falls under (reviews, ADR-0007)
  number?: number // stable Marker number (reviews, ADR-0008 §3) — stored, never derived:
  // removal must not renumber survivors, so order alone cannot carry it
}
export interface SectionMark {
  section: string
  comment: string
}
/**
 * An answered decision toggle (reviews). Agents embed a ```decision block —
 * a question with clickable options — so Dominik answers with a click instead
 * of a comment. The pick lands here as structured data, kept separate from
 * `quotes[]`/`comment` (which stay reserved for actual text).
 */
export interface DecisionAnswer {
  id: string // the block's {#id} or a slug of the question — stable across regen
  question: string // plain-text snapshot of what was asked
  choice: string // the option label picked; '' once toggled back off (unanswered)
  comment?: string // optional free-text note alongside the pick
  markups?: PictureMarkup[] // option pictures he marked up (ticket 30); absent when none
}

/**
 * A mark drawn on a picture (ticket 30). Every coordinate is a fraction of the
 * original picture, 0 to 1 from its top-left, so it holds at any display size.
 * `n` is the number on the pin (1, 2, 3… in drawing order); `text` is exactly
 * what he typed (may be empty). An arrow's `to` is the point he pressed on
 * (the head); `from` is the tail, where the pin sits.
 */
export interface MarkPoint {
  x: number
  y: number
}
export interface MarkBox {
  x: number
  y: number
  w: number
  h: number
}
export type Mark =
  | { n: number; shape: 'box'; box: MarkBox; text: string }
  | { n: number; shape: 'arrow'; from: MarkPoint; to: MarkPoint; text: string }
  | { n: number; shape: 'text'; at: MarkPoint; text: string }
export type MarkShape = Mark['shape']

/**
 * One marked-up picture. The original (`picture`) is never altered; `marked`
 * is a separate PNG with the shapes and pins (and, when he kept the words on
 * the picture, the labels) drawn in. Both paths are relative to the request's
 * folder; `marked` lives in the request's `.shots/` folder.
 */
export interface PictureMarkup {
  picture: string // the original picture, as the document or screenshot list names it
  marked: string // the marked-up copy: "<request>.shots/<item>-<n>.png"
  marks: Mark[]
  notes?: 'picture' | 'list' // 'list': the PNG carries number pins and the words are in the list; 'picture': labels drawn on it, no numbers. Absent (older records): pins
  option?: string // decisions only: the option label the picture belongs to
}

export interface ReportItem {
  id: string
  title: string
  status: ItemStatus
  comment: string
  flagged: FlagEntry[]
  quotes: QuoteEntry[]
  screenshots: string[] // paths relative to the request's folder
  sectionMarks?: SectionMark[] // whole-section needs-work marks (reviews, ADR-0007)
  decisions?: DecisionAnswer[] // answered decision toggles (reviews)
  markups?: PictureMarkup[] // marked-up screenshots of this item; `picture` is one of `screenshots` (ticket 30)
  removed?: boolean // item vanished from a regenerated request (ADR reconcile rule)
}

export interface Observation {
  id: string
  text: string
  screenshots: string[]
  markups?: PictureMarkup[] // marked-up screenshots of this observation (ticket 30)
}

export interface QaReport {
  id: string
  title: string
  app?: string
  version?: string
  build?: string
  startedAt: string // ISO
  completedAt?: string // ISO — the Finish-run stamp (ADR-0003)
  noteFiles: string[] // linked in-run notes, relative paths
  mode?: 'light'
  observations?: Observation[]
  observationSeq?: number // high-water mark; observation ids are never reused
  items: ReportItem[]
}
