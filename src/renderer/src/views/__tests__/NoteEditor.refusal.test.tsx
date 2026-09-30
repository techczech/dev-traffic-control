import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { NoteDoc } from '../../../../shared/ipc'

const showToast = vi.fn()
const openNote = vi.fn()
const createNote = vi.fn()
const saveNote = vi.fn()
const handOverNote = vi.fn()
const reopenNote = vi.fn()
const addNoteShot = vi.fn()
const linkNoteToReport = vi.fn()

vi.mock('../../state/app', () => ({
  useApp: () => ({
    back: vi.fn(),
    snapshot: null,
    showToast,
    helpOpen: false,
    switcherOpen: false,
    openLinkSwitcher: vi.fn()
  })
}))

import { NoteEditor } from '../NoteEditor'

const NOTE = '/record/demo/2026-09-28-note-existing.md'
const existing: NoteDoc = { path: NOTE, title: 'Existing', body: 'body', shots: [] }

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: {
      openNote,
      createNote,
      saveNote,
      handOverNote,
      reopenNote,
      addNoteShot,
      linkNoteToReport,
      readShot: vi.fn()
    }
  })
  openNote.mockResolvedValue(existing)
  saveNote.mockResolvedValue({ savedAt: '2026-09-28T10:00:00.000Z' })
  handOverNote.mockResolvedValue({ ...existing, handedOverAt: '2026-09-28T10:00:00.000Z' })
})

afterEach(() => cleanup())

test('a note main refuses to open says so and never shows the editor', async () => {
  openNote.mockResolvedValue(null)
  render(<NoteEditor existingPath={NOTE} />)
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not open this note'))
  expect(screen.queryByLabelText('Note body')).toBeNull()
})

test('a refused save shows the save failure, never an autosave time', async () => {
  saveNote.mockResolvedValue(null)
  render(<NoteEditor existingPath={NOTE} />)
  fireEvent.change(await screen.findByLabelText('Note body'), { target: { value: 'edited' } })
  await waitFor(() => expect(screen.getByText('Could not save the note')).toBeTruthy(), {
    timeout: 2000
  })
  expect(screen.getByText('draft · autosaved —')).toBeTruthy()
})

test('a refused create leaves the new note unsaved, shows the failure, and a later edit tries again', async () => {
  createNote.mockResolvedValue(null)
  render(<NoteEditor newIn="/somewhere/else" />)
  fireEvent.change(screen.getByLabelText('Note body'), { target: { value: 'first words' } })
  await waitFor(() => expect(screen.getByText('Could not save the note')).toBeTruthy(), {
    timeout: 2000
  })
  expect(saveNote).not.toHaveBeenCalled()

  fireEvent.change(screen.getByLabelText('Note body'), { target: { value: 'more words' } })
  await waitFor(() => expect(createNote).toHaveBeenCalledTimes(2), { timeout: 2000 })
  expect(saveNote).not.toHaveBeenCalled()
})

test('a refused flush before hand-over stops the hand-over', async () => {
  saveNote.mockResolvedValue(null)
  render(<NoteEditor existingPath={NOTE} />)
  await screen.findByLabelText('Note body')
  fireEvent.click(screen.getByRole('button', { name: /Hand over/ }))
  await waitFor(() => expect(screen.getByText('Could not save the note')).toBeTruthy())
  expect(handOverNote).not.toHaveBeenCalled()
  expect(screen.queryByText('Handed over')).toBeNull()
})

test('a refused hand-over is not shown as handed over', async () => {
  handOverNote.mockResolvedValue(null)
  render(<NoteEditor existingPath={NOTE} />)
  await screen.findByLabelText('Note body')
  fireEvent.click(screen.getByRole('button', { name: /Hand over/ }))
  await waitFor(() => expect(screen.getByText('Could not save the note')).toBeTruthy())
  expect(screen.queryByText('Handed over')).toBeNull()
})
