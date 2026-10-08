import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { QaReport, QaRequest } from '../../../../main/qa/types'

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

const DATA_URL = 'data:image/png;base64,cmVzb2x2ZWQ='

function request(
  path: string,
  bodyMarkdown: string,
  headings: { id: string; title: string; level: 2 | 3 }[] = []
): QaRequest {
  return {
    id: 'image-review',
    title: 'Image review',
    app: 'dev-traffic-control',
    labels: { kind: 'doc-review' },
    mode: 'doc-review',
    items: [],
    parked: [],
    degraded: false,
    document: { headings, bodyMarkdown },
    raw: bodyMarkdown,
    path
  }
}

function report(): QaReport {
  return {
    id: 'image-review',
    title: 'Image review',
    app: 'dev-traffic-control',
    startedAt: '2026-07-29T12:00:00.000Z',
    noteFiles: [],
    items: [
      {
        id: 'document',
        title: 'Image review',
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

function installBridge(
  readShot: Window['qa']['readShot'] = vi.fn(async (): Promise<string> => DATA_URL)
): Window['qa']['readShot'] {
  const bridge = {
    readShot,
    saveReport: vi.fn(),
    finishRun: vi.fn(),
    reopenRun: vi.fn(),
    addShot: vi.fn()
  } as unknown as Window['qa']
  Object.defineProperty(window, 'qa', { configurable: true, writable: true, value: bridge })
  return readShot
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

const BODY = [
  '## Home section',
  '```decision {#library-home}',
  'Library home: which direction?',
  '- OPT-A: shelf with a side rail ![](opt-a.png)',
  '- OPT-B: table over a bench ![](opt-b.png)',
  '- Neither: redraw',
  '```',
  '![Elsewhere](https://example.test/else.png)',
  '## Questions',
  '```decision {#dating}',
  'Which date?',
  '- Saved',
  '- Published',
  '```'
].join('\n')
const HEADINGS = [
  { id: 'home-section', title: 'Home section', level: 2 as const },
  { id: 'questions', title: 'Questions', level: 2 as const }
]

function mount(): { saveReport: ReturnType<typeof vi.fn> } {
  const path = '/records/project/2026-09-29-decisions.md'
  installBridge()
  render(<Reading path={path} request={request(path, BODY, HEADINGS)} initialReport={report()} />)
  return {
    saveReport: (window.qa as unknown as { saveReport: ReturnType<typeof vi.fn> }).saveReport
  }
}

describe('Reading decisions with pictures', () => {
  test('a decision with pictures renders side by side with a Choose button under each', async () => {
    mount()
    expect(await screen.findByRole('radio', { name: 'Choose OPT-A' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Choose OPT-B' })).toBeTruthy()
    // the option without a picture stays a plain button; the pictureless decision stays plain
    expect(screen.getByRole('radio', { name: 'Neither: redraw' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Saved' })).toBeTruthy()
    expect(screen.getByText(/Decision 1 of 2/)).toBeTruthy()
    // an unrelated image still renders in the document body
    expect(screen.getByRole('img', { name: 'Elsewhere' })).toBeTruthy()
  })

  test('choosing stores the exact option label and opens the comment under the pick', async () => {
    const { saveReport } = mount()
    fireEvent.click(await screen.findByRole('radio', { name: 'Choose OPT-B' }))
    expect(screen.getByRole('radio', { name: 'Chosen' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Comment on OPT-B'), { target: { value: 'keep it' } })
    await waitFor(() => expect(saveReport).toHaveBeenCalled())
    const saved = saveReport.mock.calls.at(-1)?.[1] as QaReport
    expect(saved.items[0].decisions).toEqual([
      {
        id: 'library-home',
        question: 'Library home: which direction?',
        choice: 'OPT-B: table over a bench',
        comment: 'keep it'
      }
    ])
  })

  test('the card settles when focus leaves it, and Change reopens it', async () => {
    mount()
    fireEvent.click(await screen.findByRole('radio', { name: 'Choose OPT-A' }))
    const box = screen.getByLabelText('Comment on OPT-A')
    fireEvent.change(box, { target: { value: 'ok' } })
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
    fireEvent.focusOut(box, { relatedTarget: null })
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy()
    expect(screen.getByText('not chosen', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('radio', { name: 'Chosen' })).toBeTruthy()
  })

  test('at narrow width the rail has a k/N button that opens the labelled list', async () => {
    mount()
    const button = await screen.findByRole('button', {
      name: 'Sections and decisions: 0 of 2 decided'
    })
    expect(button.textContent).toBe('0/2')
    fireEvent.click(screen.getByRole('radio', { name: 'Saved' }))
    expect(button.textContent).toBe('1/2')
    fireEvent.click(button)
    const list = screen.getByRole('dialog', { name: 'Sections and decisions' })
    expect(list.textContent).toContain('1 of 2 decided')
    expect(list.textContent).toContain('Home section')
    expect(within(list).getByText('Saved')).toBeTruthy()
    const row = within(list).getByText('Library home')
    expect(row).toBeTruthy()
  })

  test('Compare opens the big view, choosing there answers through the same path', async () => {
    const { saveReport } = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Compare 2 pictures' }))
    const view = screen.getByRole('dialog', { name: 'Compare pictures: Library home' })
    expect(view.textContent).toContain('Decision 1 of 2')
    fireEvent.click(within(view).getAllByRole('radio', { name: 'Choose this' })[0])
    expect(within(view).getByRole('radio', { name: 'Chosen' })).toBeTruthy()
    await waitFor(() => expect(saveReport).toHaveBeenCalled())
    const saved = saveReport.mock.calls.at(-1)?.[1] as QaReport
    expect(saved.items[0].decisions?.[0].choice).toBe('OPT-A: shelf with a side rail')
  })

  test('an enlarged picture steps between this decision only and can choose', async () => {
    mount()
    fireEvent.click((await screen.findAllByRole('button', { name: /^Enlarge OPT-A/ }))[0])
    const box = screen.getByRole('dialog', { name: 'Picture OPT-A' })
    expect(box.textContent).toContain('1 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Next picture' }))
    expect(screen.getByRole('dialog', { name: 'Picture OPT-B' }).textContent).toContain('2 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Next picture' }))
    expect(screen.getByRole('dialog', { name: 'Picture OPT-A' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Choose OPT-A' }))
    expect(screen.queryByRole('dialog', { name: 'Picture OPT-A' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Chosen' })).toBeTruthy()
  })
})
