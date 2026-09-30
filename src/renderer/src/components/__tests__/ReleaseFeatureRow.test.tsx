import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ReleaseFeatureRow } from '../ReleaseFeatureRow'
import type { ReleaseBoardFeatureRow } from '../../lib/releases'

/**
 * Ticket 25 on the Releases rows: the date after the state is the day the
 * feature reached it, and an answered feature's pictures show under its
 * comment, read through the verdict-picture reader.
 */

afterEach(cleanup)

const NOW = new Date(2026, 8, 28, 12)

function row(item: Partial<ReleaseBoardFeatureRow>, readShot = vi.fn()): HTMLElement {
  const { container } = render(
    <ReleaseFeatureRow
      item={{
        kind: 'feature',
        id: 'links',
        title: 'Links open',
        state: 'Waiting on you',
        status: 'you',
        answerable: true,
        ...item
      }}
      focused={false}
      now={NOW}
      readShot={readShot}
      howToOpen={false}
      pending={false}
      comment={item.answer?.comment ?? ''}
      onFocus={() => {}}
      onToggleHowTo={() => {}}
      onWorks={() => {}}
      onFlag={() => {}}
      onCommentChange={() => {}}
      onCommentCommit={() => {}}
    />
  )
  return container
}

test('the date is since when set, else the answer, else none', () => {
  let container = row({ since: '2026-09-20' })
  expect(container.querySelector('.release-feature-state')!.textContent).toBe(
    'Waiting on you•20 Sep'
  )
  cleanup()
  container = row({
    status: 'done',
    state: 'Done',
    answer: { verdict: 'works', comment: '', at: new Date(2026, 8, 26, 9).toISOString() }
  })
  expect(container.querySelector('.release-feature-state')!.textContent).toBe('Done•26 Sep')
  cleanup()
  container = row({})
  expect(container.querySelector('.release-feature-state')!.textContent).toBe('Waiting on you')
})

test('an answered feature shows its pictures under the comment, and one zooms', async () => {
  const readShot = vi.fn().mockResolvedValue('data:image/png;base64,UE5H')
  const container = row(
    {
      status: 'building',
      state: 'Being built',
      answer: {
        verdict: 'off',
        comment: 'The thread link landed on the project.',
        at: '2026-09-27T10:00:00Z',
        screenshots: ['releases/0.21.0.shots/links-1.png']
      }
    },
    readShot
  )
  const zoom = await screen.findByRole('button', { name: 'Zoom links-1.png' })
  expect(readShot).toHaveBeenCalledWith('releases/0.21.0.shots/links-1.png')
  // Under the comment, and read-only: no ✕, no paste tile.
  const comment = container.querySelector('.release-problem-note')!
  const pictures = container.querySelector('.release-verdict-pictures')!
  expect(comment.compareDocumentPosition(pictures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Paste a screenshot' })).toBeNull()
  await vi.waitFor(() => expect(zoom.querySelector('img')).not.toBeNull())
  fireEvent.click(zoom)
  expect(screen.getByRole('dialog', { name: 'Screenshot links-1.png' })).toBeTruthy()
})
