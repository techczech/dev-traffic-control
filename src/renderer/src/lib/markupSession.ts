import type { Mark, PictureMarkup } from '../../../main/qa/types'

/**
 * What a host (a review's decision, a run's screenshot strip) hands the
 * mark-up view. The view reads the original picture, lets him draw, and on
 * Done writes the marked-up copy through the confined screenshot writer
 * (`window.qa.addShot`) and gives the host the record to store. Esc discards.
 */
export interface MarkupSession {
  eyebrow: string // "AS-3A", or the screenshot's name
  title: string // the decision's question, or the check's title
  requestPath: string
  picture: string // the original, relative to the request folder; never written
  itemId: string // the screenshot target the marked copy is stored under
  option?: string
  marks: Mark[] // marks to start from (Edit marks), or []
  onSaved: (markup: PictureMarkup | null) => void
}

export type NotesMode = 'picture' | 'list'
const NOTES_KEY = 'dtc.markup.notes'

/** His last choice between words on the picture and the numbered list. */
export function readNotesMode(): NotesMode {
  try {
    return localStorage.getItem(NOTES_KEY) === 'list' ? 'list' : 'picture'
  } catch {
    return 'picture'
  }
}

export function writeNotesMode(mode: NotesMode): void {
  try {
    localStorage.setItem(NOTES_KEY, mode)
  } catch {
    /* a blocked store only forgets the choice */
  }
}

/** A mark-up session for a pasted screenshot: the marked copy is stored beside it. */
export function screenshotSession(input: {
  requestPath: string
  itemId: string
  rel: string
  title: string
  existing: PictureMarkup | undefined
  onSaved: (markup: PictureMarkup | null) => void
}): MarkupSession {
  return {
    eyebrow: input.rel.split('/').pop() ?? input.rel,
    title: input.title,
    requestPath: input.requestPath,
    picture: input.rel,
    itemId: input.itemId,
    marks: input.existing?.marks ?? [],
    onSaved: input.onSaved
  }
}
