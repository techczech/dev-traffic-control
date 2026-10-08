import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { SpecRowModel } from '../../lib/specs'
import { SpecRow } from '../SpecRow'

function row(overrides: Partial<SpecRowModel> = {}): SpecRowModel {
  return {
    requestPath: '/record/rivermill/review.md',
    requestKey: 'rivermill/review.md',
    app: 'Rivermill',
    title: 'Audiobook management',
    state: 'Needs your comment',
    openable: true,
    ageSource: '2026-08-07T00:00:00.000Z',
    sectionCount: 7,
    questionCount: 9,
    commentCount: 2,
    sectionMarkCount: 0,
    progress: { ratio: 2 / 7, phrase: 'Read to “Journey 2”', sectionSlug: 'journey-2' },
    ...overrides
  }
}

afterEach(cleanup)

test('renders app above title, the state once, counts, age and progress phrase', () => {
  const rendered = render(
    <SpecRow row={row()} focused now={new Date('2026-08-07T02:00:00.000Z')} onOpen={vi.fn()} />
  )

  const button = screen.getByRole('button', { name: /Open Audiobook management/ })
  expect(button.textContent?.match(/Needs your comment/g)).toHaveLength(1)
  expect(rendered.container.querySelector('.spec-row-app')?.textContent).toBe('Rivermill')
  expect(rendered.container.querySelector('.spec-row-title')?.textContent).toBe(
    'Audiobook management'
  )
  expect(button.textContent).toMatch(/asked \d\d:\d\d/)
  expect(button.textContent).toContain('7 sections · 9 open questions')
  expect(button.textContent).toContain('Read to “Journey 2” · 2 comments')
  expect(button.textContent).toContain('↵ open')
})

test('Being written is disabled and cannot invoke the open seam', () => {
  const onOpen = vi.fn()
  render(
    <SpecRow
      row={row({
        state: 'Being written',
        openable: false,
        questionCount: 0,
        progress: { ratio: 0, phrase: 'Not ready to read — it will appear here finished' }
      })}
      focused
      now={new Date('2026-08-07T02:00:00.000Z')}
      onOpen={onOpen}
    />
  )

  const button = screen.getByRole('button', { name: /Audiobook management/ })
  expect(button.hasAttribute('disabled')).toBe(true)
  fireEvent.click(button)
  expect(onOpen).not.toHaveBeenCalled()
  expect(button.textContent).not.toContain('↵ open')
})
