import { describe, expect, it } from 'vitest'
import { isNoteFileName } from '../scan'

describe('isNoteFileName: only files the app named as notes', () => {
  it('accepts the names createNote writes', () => {
    expect(isNoteFileName('2026-07-18-note-ideas.md')).toBe(true)
    expect(isNoteFileName('2026-09-28-note-title-ideas-2.md')).toBe(true)
  })

  it('refuses requests that merely contain -note- in their name', () => {
    expect(isNoteFileName('2026-09-28-new-note-dates-verdict-shots-0.21.0-alpha.25.md')).toBe(false)
    expect(isNoteFileName('2026-07-28-row-history-and-note-typing.md')).toBe(false)
    expect(isNoteFileName('2026-09-28-new-note-dates-and-verdict-screenshots.resolved.md')).toBe(false)
  })

  it('refuses sidecars and other extensions', () => {
    expect(isNoteFileName('2026-07-18-note-ideas.resolved.md')).toBe(false)
    expect(isNoteFileName('2026-07-18-note-ideas.txt')).toBe(false)
  })
})
