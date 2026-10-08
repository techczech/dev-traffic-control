import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { QaReport, QaRequest } from '../../../../main/qa/types'
import { CommandProvider } from '../../commands/provider'

const app = vi.hoisted(() => ({
  navigate: vi.fn(),
  snapshot: null,
  helpOpen: false,
  switcherOpen: false,
  settings: undefined,
  changeSetting: vi.fn(),
  showToast: vi.fn()
}))

vi.mock('../../state/app', () => ({
  useApp: () => app
}))

import { Reading } from '../Reading'

/**
 * The Finish-review sheet is Reading's key handler's territory: Enter
 * confirms, Esc cancels, and P/N/F/S set the disposition on the sheet —
 * except inside the final-comments box, where letters must type and Enter
 * must stay a newline (a comment lost mid-sentence to a confirm is the one
 * unforgivable outcome). These tests drive the real CommandProvider dispatch,
 * the same path the app's keydowns take.
 */

const PATH = '/records/dev-traffic-control/2026-07-29-review.md'

function request(): QaRequest {
  return {
    id: 'finish-sheet-review',
    title: 'Finish-sheet review',
    app: 'dev-traffic-control',
    labels: { kind: 'doc-review' },
    mode: 'doc-review',
    items: [],
    parked: [],
    degraded: false,
    document: { headings: [], bodyMarkdown: 'Paragraph one.' },
    raw: 'Paragraph one.',
    path: PATH
  }
}

function report(): QaReport {
  return {
    id: 'finish-sheet-review',
    title: 'Finish-sheet review',
    app: 'dev-traffic-control',
    startedAt: '2026-07-29T12:00:00.000Z',
    noteFiles: [],
    items: [
      {
        id: 'document',
        title: 'Finish-sheet review',
        status: 'unanswered',
        comment: '',
        flagged: [],
        quotes: [],
        screenshots: [],
        sectionMarks: [],
        decisions: []
      }
    ]
  }
}

function installBridge(): { finishRun: ReturnType<typeof vi.fn> } {
  const finishRun = vi.fn((_path: string, snap: QaReport) =>
    Promise.resolve({ ok: true, report: { ...snap, completedAt: '2026-07-29T13:00:00.000Z' } })
  )
  const bridge = {
    readShot: vi.fn(async (): Promise<string> => ''),
    saveReport: vi.fn(async () => ({ ok: true, savedAt: '2026-07-29T12:30:00.000Z' })),
    finishRun,
    reopenRun: vi.fn(),
    addShot: vi.fn(),
    copyCollectPrompt: vi.fn(async () => ({ ok: true }))
  } as unknown as Window['qa']
  Object.defineProperty(window, 'qa', { configurable: true, writable: true, value: bridge })
  return { finishRun }
}

beforeEach(() => {
  app.navigate.mockReset()
  app.changeSetting.mockReset()
  app.showToast.mockReset()

  class TestResizeObserver {
    observe(): void {
      return
    }

    disconnect(): void {
      return
    }

    unobserve(): void {
      return
    }
  }

  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Mount a live review, open the Finish sheet, hand back its handles. */
function openSheet(): { finishRun: ReturnType<typeof vi.fn>; sheet: HTMLElement } {
  const { finishRun } = installBridge()
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <Reading path={PATH} request={request()} initialReport={report()} />
    </CommandProvider>
  )
  // The footer button is the only "Finish review" until the sheet is up.
  fireEvent.click(screen.getByRole('button', { name: 'Finish review' }))
  return { finishRun, sheet: screen.getByRole('dialog', { name: 'Finish review' }) }
}

/**
 * The four disposition rows in the shared list's order:
 * Approve · Approve with changes · Needs rework · Not reviewed.
 */
function rows(sheet: HTMLElement): HTMLButtonElement[] {
  const group = within(sheet).getByRole('group', { name: 'Disposition' })
  return within(group).getAllByRole('button') as HTMLButtonElement[]
}

describe('Reading finish sheet — the disposition moves onto the sheet', () => {
  test('picking a row sets the verdict, marks it, and the sheet stays open', () => {
    const { finishRun, sheet } = openSheet()
    const needsRework = rows(sheet)[2]
    expect(needsRework.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(needsRework)
    // The reviewer sees what the reviewer chose before confirming — the sheet is still up.
    expect(needsRework.getAttribute('aria-pressed')).toBe('true')
    expect(needsRework.className).toContain('sel-fail')
    expect(screen.getByRole('dialog', { name: 'Finish review' })).toBeTruthy()
    expect(finishRun).not.toHaveBeenCalled()
  })

  test('a letter typed in the comments box types, never toggles a disposition', () => {
    const { finishRun, sheet } = openSheet()
    const box = within(sheet).getByLabelText('Final comments') as HTMLTextAreaElement
    box.focus()
    fireEvent.keyDown(box, { key: 'p', code: 'KeyP' })
    // P must not reach review.approve — nothing gets marked, nothing finishes.
    expect(rows(sheet)[0].getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('dialog', { name: 'Finish review' })).toBeTruthy()
    expect(finishRun).not.toHaveBeenCalled()
  })

  test('Enter in the comments box never finishes the review', () => {
    const { finishRun, sheet } = openSheet()
    const box = within(sheet).getByLabelText('Final comments') as HTMLTextAreaElement
    box.focus()
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' })
    expect(finishRun).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Finish review' })).toBeTruthy()
  })

  test('outside the box the letter keys still land on the sheet pick', () => {
    const { finishRun, sheet } = openSheet()
    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP' })
    const approve = rows(sheet)[0]
    expect(approve.getAttribute('aria-pressed')).toBe('true')
    expect(approve.className).toContain('sel-pass')
    // The sheet stays open; the chip pulse stays hidden behind the overlay.
    expect(screen.getByRole('dialog', { name: 'Finish review' })).toBeTruthy()
    expect(finishRun).not.toHaveBeenCalled()
  })

  test('Esc in the comments box blurs it first; the second Esc cancels the sheet', () => {
    const { sheet } = openSheet()
    const box = within(sheet).getByLabelText('Final comments') as HTMLTextAreaElement
    box.focus()
    fireEvent.keyDown(box, { key: 'Escape', code: 'Escape' })
    // A stray Esc while typing must not throw the sheet away mid-sentence.
    expect(document.activeElement).not.toBe(box)
    expect(screen.getByRole('dialog', { name: 'Finish review' })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Finish review' })).toBeNull()
  })

  test('Enter on a focused row picks that row instead of finishing', () => {
    const { finishRun, sheet } = openSheet()
    const approveChanges = rows(sheet)[1]
    approveChanges.focus()
    fireEvent.keyDown(approveChanges, { key: 'Enter', code: 'Enter' })
    expect(approveChanges.getAttribute('aria-pressed')).toBe('true')
    expect(approveChanges.className).toContain('sel-partial')
    expect(screen.getByRole('dialog', { name: 'Finish review' })).toBeTruthy()
    expect(finishRun).not.toHaveBeenCalled()
  })

  test('Enter with nothing on the sheet focused still confirms the finish', async () => {
    const { finishRun } = openSheet()
    fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(finishRun).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog', { name: 'Finish review' })).toBeNull()
  })

  test('a typed final comment survives the confirm, and none picked records Not reviewed', async () => {
    const { finishRun, sheet } = openSheet()
    const box = within(sheet).getByLabelText('Final comments') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Gate the rollout behind the design lock.' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Finish review' }))
    await waitFor(() => expect(finishRun).toHaveBeenCalledTimes(1))
    const snap = finishRun.mock.calls[0][1] as QaReport
    const doc = snap.items[0]
    expect(doc.comment).toBe('Gate the rollout behind the design lock.')
    // Nothing was picked, so the wire still carries Not reviewed.
    expect(doc.status).toBe('skip')
  })
})
