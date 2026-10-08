import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ReportItem } from '../../../../main/qa/types'
import { QuoteBlocks } from '../QuoteBlocks'

function item(): ReportItem {
  return {
    id: 'export-image',
    title: 'Export image',
    status: 'fail',
    comment: '',
    flagged: [{ expectedIndex: 0, text: 'The image remains visible', comment: '' }],
    quotes: [{ text: 'The caption remains aligned', comment: '' }],
    screenshots: []
  }
}

afterEach(cleanup)

test('the flagged-bullet sentence comment uses an auto-growing textarea', () => {
  const onFlagComment = vi.fn()
  render(
    <QuoteBlocks
      item={item()}
      flaggable
      readOnly={false}
      onUnflag={vi.fn()}
      onFlagComment={onFlagComment}
      onUnquote={vi.fn()}
      onQuoteComment={vi.fn()}
    />
  )

  const comment = screen.getByRole('textbox', {
    name: 'Comment on flagged bullet 1'
  }) as HTMLTextAreaElement
  Object.defineProperty(comment, 'scrollHeight', { configurable: true, value: 68 })

  fireEvent.input(comment, {
    target: {
      value: 'The image is replaced by a placeholder after export and cannot be inspected.'
    }
  })

  expect(comment.tagName).toBe('TEXTAREA')
  expect(comment.rows).toBe(1)
  expect(comment.style.height).toBe('68px')
  expect(onFlagComment).toHaveBeenCalledWith(
    0,
    'The image is replaced by a placeholder after export and cannot be inspected.'
  )
})

test('the selected-quote sentence comment uses an auto-growing textarea', () => {
  const onQuoteComment = vi.fn()
  render(
    <QuoteBlocks
      item={item()}
      flaggable
      readOnly={false}
      onUnflag={vi.fn()}
      onFlagComment={vi.fn()}
      onUnquote={vi.fn()}
      onQuoteComment={onQuoteComment}
    />
  )

  const comment = screen.getByRole('textbox', {
    name: 'Comment on this quote'
  }) as HTMLTextAreaElement
  Object.defineProperty(comment, 'scrollHeight', { configurable: true, value: 68 })

  fireEvent.input(comment, {
    target: { value: 'The alignment changes after the second line wraps in the exported document.' }
  })

  expect(comment.tagName).toBe('TEXTAREA')
  expect(comment.rows).toBe(1)
  expect(comment.style.height).toBe('68px')
  expect(onQuoteComment).toHaveBeenCalledWith(
    0,
    'The alignment changes after the second line wraps in the exported document.'
  )
})
