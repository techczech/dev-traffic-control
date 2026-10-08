import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SearchEverything } from '../SearchEverything'

const navigate = vi.fn()
const close = vi.fn()

vi.mock('../../state/app', () => ({
  useApp: () => ({ navigate, closeSearchEverything: close })
}))

beforeEach(() => {
  navigate.mockReset()
  close.mockReset()
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: {
      searchRecord: vi.fn(async () => ({
        hits: [
          {
            file: '/record/project/threads/entry.md',
            line: 8,
            column: 4,
            snippet: 'an autosave detail',
            kind: 'entry',
            title: 'Why autosave matters',
            project: 'project',
            thread: 'autosave-thread'
          }
        ],
        total: 31,
        files: 12,
        cap: 1,
        capped: true
      }))
    }
  })
})

afterEach(cleanup)

test('shows body hits and a pinned cap disclosure, then navigates and closes', async () => {
  render(<SearchEverything open />)
  const input = screen.getByRole('textbox', { name: 'Search requests, notes and thread entries' })
  fireEvent.change(input, { target: { value: 'autosave' } })

  expect(await screen.findByText('Why autosave matters')).toBeTruthy()
  expect(document.querySelector('.capped')?.textContent).toContain(
    'Showing the first 1 of 31 matches across 12 files'
  )
  fireEvent.click(screen.getByRole('option'))

  expect(navigate).toHaveBeenCalledWith({
    kind: 'thread',
    project: 'project',
    thread: 'autosave-thread',
    search: { file: '/record/project/threads/entry.md', line: 8, query: 'autosave' }
  })
  expect(close).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(window.qa.searchRecord).toHaveBeenCalledWith('autosave'))
})
