import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DISPOSITIONS } from '../../lib/dispositions'
import { ReviewFinishConfirm } from '../ReviewFinishConfirm'

/**
 * The Finish-review sheet is where the disposition choice lives now: the four
 * options render from the shared list, the current one is marked, and a pick
 * only calls back — keeping the sheet open is Reading's business. The
 * final-comments box is a write-through to the document item's `comment`
 * field, so it must pre-fill rather than open empty over an existing comment.
 */

afterEach(cleanup)

function renderSheet(props: Partial<Parameters<typeof ReviewFinishConfirm>[0]> = {}): {
  container: HTMLElement
  onPick: ReturnType<typeof vi.fn>
  onCommentChange: ReturnType<typeof vi.fn>
  onConfirm: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
} {
  const onPick = vi.fn()
  const onCommentChange = vi.fn()
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const view = render(
    <ReviewFinishConfirm
      dispositionLabel={null}
      current={null}
      comment=""
      comments={2}
      sectionMarks={1}
      onPick={onPick}
      onCommentChange={onCommentChange}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  )
  return { container: view.container, onPick, onCommentChange, onConfirm, onCancel }
}

describe('ReviewFinishConfirm — the sheet asks for the disposition', () => {
  test('the four options render from the shared list, the current one marked', () => {
    renderSheet({ current: 'partial' })
    const group = screen.getByRole('group', { name: 'Disposition' })
    const rows = within(group).getAllByRole('button')
    expect(rows.map((row) => row.querySelector('.grow')?.textContent)).toEqual(
      DISPOSITIONS.map((d) => d.label)
    )
    expect(rows.map((row) => row.querySelector('kbd')?.textContent)).toEqual(
      DISPOSITIONS.map((d) => d.key)
    )
    // The current verdict is the one pressed row; nothing else is.
    expect(rows.map((row) => row.getAttribute('aria-pressed'))).toEqual(
      DISPOSITIONS.map((d) => String(d.v === 'partial'))
    )
    expect(rows[1].className).toContain('sel-partial')
  })

  test('picking a row calls back with its verdict and leaves the closing to Reading', () => {
    const { onPick, onConfirm, onCancel } = renderSheet({ current: null })
    fireEvent.click(screen.getByRole('button', { name: /Needs rework/ }))
    expect(onPick).toHaveBeenCalledWith('fail')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  test('the final-comments box pre-fills, writes through, and confirm keeps the text', () => {
    const { onCommentChange, onConfirm } = renderSheet({ comment: 'already noted' })
    const box = screen.getByLabelText('Final comments') as HTMLTextAreaElement
    expect(box.value).toBe('already noted')
    fireEvent.change(box, { target: { value: 'already noted, plus the gate' } })
    expect(onCommentChange).toHaveBeenCalledWith('already noted, plus the gate')
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }))
    // Confirm is a plain callback — the text survives because the sheet
    // wrote it through on every change, never holding it locally.
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test('no amber warn: an absent disposition is an offered choice, not a complaint', () => {
    const { container } = renderSheet({ current: null, comments: 0, sectionMarks: 0 })
    // The choice sits on the sheet now, so finishing with none picked must
    // not be framed as missing (finish is never blocked).
    expect(container.querySelector('.warn')).toBeNull()
    expect(screen.getByRole('group', { name: 'Disposition' }).children).toHaveLength(4)
  })
})
