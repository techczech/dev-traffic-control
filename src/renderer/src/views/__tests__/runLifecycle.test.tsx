import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { QaReport, QaRequest, ReportItem } from '../../../../main/qa/types'
import type { QaSnapshot, ReportMutationResult } from '../../../../shared/ipc'
import { openRun, save } from '../../../../main/runnerIo'

const app = vi.hoisted(() => ({
  helpOpen: false,
  switcherOpen: false,
  navigate: vi.fn(),
  back: vi.fn(),
  showToast: vi.fn(),
  snapshot: null as QaSnapshot | null,
  runnerMode: 'focus' as 'focus' | 'list',
  setRunnerMode: vi.fn()
}))

vi.mock('../../state/app', () => ({
  useApp: () => app
}))

import { LightRun } from '../LightRun'
import { Runner } from '../Runner'

const PATH = '/qa/dev-traffic-control/light-request.md'
const FIRST_STAMP = '2026-07-26T12:00:00.000Z'
const SECOND_STAMP = '2026-07-26T13:00:00.000Z'

function reportItem(status: ReportItem['status'] = 'unanswered'): ReportItem {
  return {
    id: 'check-one',
    title: 'Check one',
    status,
    comment: '',
    flagged: [],
    quotes: [],
    screenshots: []
  }
}

function request(overrides: Partial<QaRequest> = {}): QaRequest {
  return {
    id: 'light-request',
    title: 'Light request',
    app: 'dev-traffic-control',
    version: 'v0.8.2',
    labels: { kind: 'recheck' },
    mode: 'light',
    items: [
      {
        id: 'check-one',
        title: 'Check one',
        context: 'The check appears inline.',
        steps: [],
        expected: [],
        notes: []
      }
    ],
    parked: [],
    degraded: false,
    raw: '',
    path: PATH,
    ...overrides
  }
}

function report(items: ReportItem[] = [reportItem()], overrides: Partial<QaReport> = {}): QaReport {
  return {
    id: 'light-request',
    title: 'Light request',
    app: 'dev-traffic-control',
    version: 'v0.8.2',
    startedAt: '2026-07-26T11:00:00.000Z',
    noteFiles: [],
    mode: 'light',
    items,
    ...overrides
  }
}

function cloneReport(value: QaReport): QaReport {
  return JSON.parse(JSON.stringify(value)) as QaReport
}

function stamp(value: QaReport, completedAt = SECOND_STAMP): QaReport {
  return { ...cloneReport(value), completedAt }
}

function mutationResult(value: QaReport): ReportMutationResult {
  return { ok: true, report: value }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function installBridge(overrides: Partial<Window['qa']> = {}): {
  saveReport: ReturnType<typeof vi.fn>
  finishRun: ReturnType<typeof vi.fn>
  reopenRun: ReturnType<typeof vi.fn>
  copyCollectPrompt: ReturnType<typeof vi.fn>
} {
  const saveReport = vi.fn(async () => ({ ok: true as const, savedAt: SECOND_STAMP }))
  const finishRun = vi.fn(async (_path: string, value: QaReport) => mutationResult(stamp(value)))
  const reopenRun = vi.fn(async () => mutationResult(report([reportItem('pass')])))
  const copyCollectPrompt = vi.fn(async () => {})
  const bridge = {
    saveReport,
    finishRun,
    reopenRun,
    copyCollectPrompt,
    addShot: vi.fn(),
    readShot: vi.fn(),
    openRun: vi.fn(),
    getTicks: vi.fn(async () => ({})),
    setItemTicks: vi.fn(async () => {}),
    ...overrides
  } as unknown as Window['qa']
  Object.defineProperty(window, 'qa', { configurable: true, writable: true, value: bridge })
  return {
    saveReport: bridge.saveReport as ReturnType<typeof vi.fn>,
    finishRun: bridge.finishRun as ReturnType<typeof vi.fn>,
    reopenRun: bridge.reopenRun as ReturnType<typeof vi.fn>,
    copyCollectPrompt: bridge.copyCollectPrompt as ReturnType<typeof vi.fn>
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  app.helpOpen = false
  app.switcherOpen = false
  app.navigate.mockReset()
  app.back.mockReset()
  app.showToast.mockReset()
  app.snapshot = null
  app.runnerMode = 'focus'
  app.setRunnerMode.mockReset()

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
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('LightRun lifecycle', () => {
  test('Finish immediately shows that the live watcher is waiting to pick the run up', async () => {
    const watchNow = new Date().toISOString()
    app.snapshot = {
      root: '/qa',
      localMachine: 'laptop',
      rootMissing: false,
      runs: [
        {
          request: request(),
          report: null,
          status: 'in-progress',
          project: 'dev-traffic-control',
          round: null,
          watch: {
            agent: 'fable',
            machine: 'laptop',
            startedAt: watchNow,
            heartbeatAt: watchNow
          }
        }
      ],
      notes: [],
      entries: [],
      threads: [],
      handoffs: [],
      releases: [],
      pools: [],
      projects: ['dev-traffic-control'],
      scannedAt: watchNow,
      receiptsStartAt: '2026-07-26T00:00:00.000Z'
    }
    installBridge()
    render(
      <LightRun path={PATH} request={request()} initialReport={report([reportItem('pass')])} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await settle()

    expect(screen.getByText('Fable is watching — waiting to be picked up')).toBeTruthy()
  })

  // Finishing hands him the thing he needs next: the collect prompt, already
  // on the clipboard, with the toast confirming it.
  test('finishing puts the collect prompt on the clipboard and says so', async () => {
    const { copyCollectPrompt } = installBridge()
    render(
      <LightRun path={PATH} request={request()} initialReport={report([reportItem('pass')])} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await settle()

    expect(copyCollectPrompt).toHaveBeenCalledWith(PATH, 'Light request')
    expect(app.showToast).toHaveBeenCalledWith(
      'Collect prompt copied — paste it to the agent that asked.'
    )
  })

  test('a rejected clipboard copy costs the prompt, never the finish', async () => {
    const { finishRun, copyCollectPrompt } = installBridge({
      copyCollectPrompt: vi.fn(async () => {
        throw new Error('clipboard unavailable')
      })
    })
    render(
      <LightRun path={PATH} request={request()} initialReport={report([reportItem('pass')])} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await settle()

    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(copyCollectPrompt).toHaveBeenCalledTimes(1)
    expect(app.showToast).toHaveBeenCalledWith('Finished — the collect prompt could not be copied.')
    // The finished surface stands: the stamped pill, no save-error banner.
    expect(screen.getByText(/Finished/)).toBeTruthy()
    expect(screen.queryByText('Retry')).toBeNull()
  })

  // The button is gone (2026-09-26); its keyboard command, A, still finishes.
  test('Everything works (A) finishes once and never emits an unstamped save afterwards', async () => {
    vi.useFakeTimers()
    const sequence: Array<{ kind: 'save' | 'finish'; value: QaReport }> = []
    const { saveReport, finishRun } = installBridge({
      saveReport: vi.fn(async (_path: string, value: QaReport) => {
        sequence.push({ kind: 'save', value: cloneReport(value) })
        return { ok: true as const, savedAt: SECOND_STAMP }
      }),
      finishRun: vi.fn(async (_path: string, value: QaReport) => {
        sequence.push({ kind: 'finish', value: cloneReport(value) })
        return mutationResult(stamp(value))
      })
    })
    render(<LightRun path={PATH} request={request()} initialReport={report()} />)

    expect(screen.queryByRole('button', { name: 'Everything works' })).toBeNull()
    fireEvent.keyDown(window, { key: 'a' })
    await settle()
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(sequence).toHaveLength(1)
    expect(sequence[0].kind).toBe('finish')
    expect(sequence[0].value.completedAt).toBeUndefined()
    expect(sequence[0].value.items[0].status).toBe('pass')
    expect(saveReport).not.toHaveBeenCalled()
  })

  test('Finish is the one way out, and it comes after the observations', () => {
    installBridge()
    const { container } = render(
      <LightRun path={PATH} request={request()} initialReport={report()} />
    )
    const finish = screen.getByRole('button', { name: 'Finish' })
    const observations = container.querySelector('.lr-obs')!
    expect(
      observations.compareDocumentPosition(finish) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(finish.className).toContain('lr-finish-primary')
  })

  test('an ordinary verdict still reaches saveReport after the debounce', async () => {
    vi.useFakeTimers()
    const { saveReport, finishRun } = installBridge()
    render(<LightRun path={PATH} request={request()} initialReport={report()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Works' }))
    await act(async () => {
      vi.advanceTimersByTime(401)
      await Promise.resolve()
    })

    expect(saveReport).toHaveBeenCalledTimes(1)
    expect(saveReport.mock.calls[0][1].completedAt).toBeUndefined()
    expect(saveReport.mock.calls[0][1].items[0].status).toBe('pass')
    expect(finishRun).not.toHaveBeenCalled()
  })

  test('reopen, edit, and finish writes a second completion stamp', async () => {
    const reopened = report([reportItem('pass')])
    const { finishRun, reopenRun } = installBridge({
      reopenRun: vi.fn(async () => mutationResult(cloneReport(reopened))),
      finishRun: vi.fn(async (_path: string, value: QaReport) =>
        mutationResult(stamp(value, SECOND_STAMP))
      )
    })
    render(
      <LightRun
        path={PATH}
        request={request()}
        initialReport={report([reportItem('pass')], { completedAt: FIRST_STAMP })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: "⚑ Something's off" }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await settle()

    expect(reopenRun).toHaveBeenCalledTimes(1)
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][1].items[0].status).toBe('fail')
    expect(screen.getByText(/Finished/).textContent).toContain('Finished')
  })

  test('a verdict clicked during the finish round-trip is visibly inert', async () => {
    vi.useFakeTimers()
    const pending = deferred<ReportMutationResult>()
    let submitted: QaReport | null = null
    const { saveReport, finishRun } = installBridge({
      finishRun: vi.fn((_path: string, value: QaReport) => {
        submitted = cloneReport(value)
        return pending.promise
      })
    })
    render(
      <LightRun path={PATH} request={request()} initialReport={report([reportItem('pass')])} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    const problem = screen.getByRole('button', { name: "⚑ Something's off" })
    expect((problem as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(problem)

    pending.resolve(mutationResult(stamp(submitted ?? report([reportItem('pass')]))))
    await settle()
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(finishRun).toHaveBeenCalledTimes(1)
    expect((submitted as QaReport | null)?.items[0].status).toBe('pass')
    expect(saveReport).not.toHaveBeenCalled()
  })

  test('unmounting inside the debounce window flushes the latest verdict', async () => {
    vi.useFakeTimers()
    const { saveReport } = installBridge()
    const rendered = render(<LightRun path={PATH} request={request()} initialReport={report()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Works' }))
    rendered.unmount()
    await settle()

    expect(saveReport).toHaveBeenCalledTimes(1)
    expect(saveReport.mock.calls[0][1].items[0].status).toBe('pass')
  })

  test('a failed finish stays dirty so immediate navigation flushes the report', async () => {
    vi.useFakeTimers()
    const { saveReport } = installBridge({
      finishRun: vi.fn(async () => {
        throw new Error('disk unavailable')
      })
    })
    const rendered = render(
      <LightRun path={PATH} request={request()} initialReport={report([reportItem('pass')])} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await settle()
    rendered.unmount()
    await settle()

    expect(saveReport).toHaveBeenCalledTimes(1)
    expect(saveReport.mock.calls[0][1].items[0].status).toBe('pass')
    expect(saveReport.mock.calls[0][1].completedAt).toBeUndefined()
  })

  test('button focus suppresses only Space while bare verdict keys still work', async () => {
    vi.useFakeTimers()
    const { saveReport } = installBridge()
    const rendered = render(<LightRun path={PATH} request={request()} initialReport={report()} />)
    const works = screen.getByRole('button', { name: 'Works' })
    works.focus()

    fireEvent.keyDown(works, { key: ' ' })
    expect(rendered.container.querySelector('.lr-check')?.classList.contains('lr-ok')).toBe(false)

    fireEvent.keyDown(works, { key: 'f' })
    expect(rendered.container.querySelector('.lr-check')?.classList.contains('lr-bad')).toBe(true)

    fireEvent.keyDown(document.body, { key: ' ' })
    await act(async () => {
      vi.advanceTimersByTime(401)
      await Promise.resolve()
    })
    expect(saveReport.mock.calls.at(-1)?.[1].items[0].status).toBe('pass')
  })

  test('the problem note is a one-row textarea rather than a single-line input', () => {
    installBridge()
    const rendered = render(<LightRun path={PATH} request={request()} initialReport={report()} />)

    fireEvent.click(screen.getByRole('button', { name: "⚑ Something's off" }))
    const note = screen.getByRole('textbox', { name: 'Problem note for The check appears inline.' })

    expect(note.tagName).toBe('TEXTAREA')
    expect(note.getAttribute('rows')).toBe('1')
    expect(rendered.container.querySelector('input.lr-note')).toBeNull()
  })

  test('typing a long problem note grows it without a nowrap or single-line constraint', () => {
    installBridge()
    render(<LightRun path={PATH} request={request()} initialReport={report()} />)

    fireEvent.click(screen.getByRole('button', { name: "⚑ Something's off" }))
    const note = screen.getByRole('textbox', {
      name: 'Problem note for The check appears inline.'
    }) as HTMLTextAreaElement
    const longNote =
      'The exported image becomes a grey placeholder and the caption moves beyond the visible edge.'
    Object.defineProperty(note, 'scrollHeight', { configurable: true, value: 72 })

    fireEvent.input(note, { target: { value: longNote } })

    expect(note.value).toBe(longNote)
    expect(note.style.height).toBe('72px')
    expect(note.style.whiteSpace).not.toBe('nowrap')
  })

  test('Escape in the focused problem-note textarea does not navigate away', () => {
    installBridge()
    render(<LightRun path={PATH} request={request()} initialReport={report()} />)

    fireEvent.click(screen.getByRole('button', { name: "⚑ Something's off" }))
    const note = screen.getByRole('textbox', { name: 'Problem note for The check appears inline.' })
    note.focus()
    fireEvent.keyDown(note, { key: 'Escape' })

    expect(app.navigate).not.toHaveBeenCalled()
  })

  test('Escape in a focused observation textarea does not navigate away', () => {
    installBridge()
    render(<LightRun path={PATH} request={request()} initialReport={report()} />)

    fireEvent.click(screen.getByRole('button', { name: /Add an observation/i }))
    const observation = screen.getByRole('textbox', { name: 'Observation obs-1' })
    observation.focus()
    fireEvent.keyDown(observation, { key: 'Escape' })

    expect(app.navigate).not.toHaveBeenCalled()
  })

  test('a parked-only light request hides the empty card-walk hatch', () => {
    installBridge()
    render(
      <LightRun
        path={PATH}
        request={request({
          items: [],
          parked: [{ id: 'also-export', text: 'Try the export sheet' }]
        })}
        initialReport={report([])}
      />
    )

    expect(screen.queryByRole('button', { name: 'Detailed view' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Everything works' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Finish' })).not.toBeNull()
  })

  test('a pending detailed write is visible as a neutral verdict after switching to light', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'qa-light-switch-'))
    const requestPath = path.join(dir, 'switch.md')
    await writeFile(
      requestPath,
      `---
id: switch
title: Surface switch
mode: light
---
## Check one
The check appears inline.
`
    )
    const opened = await openRun(requestPath, () => '2026-07-26T11:00:00.000Z')
    const partial = {
      ...opened.report,
      items: opened.report.items.map((item) => ({ ...item, status: 'partial' as const }))
    }

    const pendingWrite = save(requestPath, partial)
    const switched = await openRun(requestPath, () => '2026-07-26T11:00:00.000Z')
    await pendingWrite
    installBridge()
    const rendered = render(
      <LightRun path={requestPath} request={switched.request} initialReport={switched.report} />
    )

    const row = rendered.container.querySelector('.lr-check')
    expect(row?.classList.contains('lr-neutral')).toBe(true)
    expect(screen.getByText('partial')).not.toBeNull()
  })
})

describe('Runner lifecycle and legal empty data', () => {
  test('a finish refusal immediately keeps the structured recovery actions', async () => {
    const refusal = {
      kind: 'invalid-on-disk' as const,
      path: '/qa/dev-traffic-control/light-request.report.json',
      message: 'Refusing to change the invalid report. Use “Set aside and start fresh”.'
    }
    installBridge({
      openRun: vi.fn(async () => ({
        request: request({ mode: 'test' }),
        report: report([reportItem('pass')], { mode: undefined }),
        exists: true
      })),
      finishRun: vi.fn(async () => ({ ok: false as const, refusal }))
    })
    render(<Runner path={PATH} />)
    await settle()

    const finish = screen
      .getAllByRole('button', { name: 'Finish run' })
      .find((button) => button.classList.contains('outbtn'))
    if (!finish) throw new Error('header Finish run button missing')
    fireEvent.click(finish)
    await settle()

    expect(screen.getByRole('alert').textContent).toContain(refusal.message)
    expect(screen.getByRole('button', { name: 'Reveal in Finder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Set aside and start fresh' })).toBeTruthy()
  })

  test('a reopen refusal immediately keeps the structured recovery actions', async () => {
    const refusal = {
      kind: 'invalid-on-disk' as const,
      path: '/qa/dev-traffic-control/light-request.report.json',
      message: 'Refusing to change the invalid report. Use “Set aside and start fresh”.'
    }
    installBridge({
      openRun: vi.fn(async () => ({
        request: request({ mode: 'test' }),
        report: report([reportItem('pass')], {
          completedAt: FIRST_STAMP,
          mode: undefined
        }),
        exists: true
      })),
      reopenRun: vi.fn(async () => ({ ok: false as const, refusal }))
    })
    render(<Runner path={PATH} />)
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await settle()

    expect(screen.getByRole('alert').textContent).toContain(refusal.message)
    expect(screen.getByRole('button', { name: 'Reveal in Finder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Set aside and start fresh' })).toBeTruthy()
  })

  test('pressing P on a corrupt report never reaches autosave after the debounce', async () => {
    vi.useFakeTimers()
    const fresh = {
      request: request({ mode: 'test' }),
      report: report([reportItem()], { mode: undefined }),
      exists: false
    }
    const { saveReport } = installBridge({
      openRun: vi.fn(async () => ({
        ...fresh,
        exists: true,
        corruptReport: {
          path: '/qa/dev-traffic-control/light-request.report.json',
          message: 'Could not read the report: the file is not valid JSON'
        }
      }))
    })
    render(<Runner path={PATH} />)
    await settle()

    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP' })
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(saveReport).not.toHaveBeenCalled()
  })

  test('a corrupt report names the file and provides keyboard-reachable recovery without saving it', async () => {
    const fresh = { request: request({ mode: 'test' }), report: report(), exists: false }
    const setAside = vi.fn(async () => fresh)
    const reveal = vi.fn(async () => true)
    const { saveReport } = installBridge({
      openRun: vi.fn(async () => ({
        ...fresh,
        exists: true,
        corruptReport: {
          path: '/qa/dev-traffic-control/light-request.report.json',
          message: 'Could not read the report: the file is not valid JSON'
        }
      })),
      setAsideCorruptReport: setAside,
      revealPath: reveal
    })
    render(<Runner path={PATH} />)
    await settle()

    expect(screen.getByText('This run’s report cannot be opened')).toBeTruthy()
    expect(screen.getByText('/qa/dev-traffic-control/light-request.report.json')).toBeTruthy()
    const revealButton = screen.getByRole('button', { name: 'Reveal in Finder' })
    revealButton.focus()
    fireEvent.keyDown(revealButton, { key: 'Enter' })
    fireEvent.click(revealButton)
    expect(reveal).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Set aside and start fresh' }))
    await settle()
    expect(setAside).toHaveBeenCalledWith(PATH)
    expect(saveReport).not.toHaveBeenCalled()
  })

  test('mid-run corruption shows the refusal and preserves the in-memory report during recovery', async () => {
    vi.useFakeTimers()
    const opened = { request: request({ mode: 'test' }), report: report(), exists: true }
    const recovered = cloneReport(opened.report)
    recovered.items[0].status = 'pass'
    const setAside = vi.fn(async () => ({ ...opened, report: recovered }))
    installBridge({
      openRun: vi.fn(async () => opened),
      saveReport: vi.fn(async () => ({
        ok: false as const,
        refusal: {
          kind: 'invalid-on-disk' as const,
          path: '/qa/dev-traffic-control/light-request.report.json',
          message: 'Refusing to change the invalid report. Use “Set aside and start fresh”.'
        }
      })),
      setAsideCorruptReport: setAside,
      revealPath: vi.fn(async () => true)
    })
    render(<Runner path={PATH} />)
    await settle()

    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(screen.getByRole('alert').textContent).toContain('Refusing to change the invalid report')
    fireEvent.click(screen.getByRole('button', { name: 'Set aside and start fresh' }))
    await settle()

    expect(setAside).toHaveBeenCalledWith(
      PATH,
      expect.objectContaining({ items: [expect.objectContaining({ status: 'pass' })] })
    )
  })

  test('the detailed parked-only route renders an honest empty state and remains keyboard-safe', async () => {
    const parkedRequest = request({
      items: [],
      parked: [{ id: 'also-export', text: 'Try the export sheet' }]
    })
    installBridge({
      openRun: vi.fn(async () => ({
        request: parkedRequest,
        report: report([]),
        exists: false
      }))
    })
    const rendered = render(<Runner path={PATH} detailed />)
    await settle()

    expect(screen.getByText('Light request')).not.toBeNull()
    expect(rendered.container.querySelector('.lr-run-empty-chips')).not.toBeNull()
    expect(screen.getByText('dev-traffic-control')).not.toBeNull()
    expect(screen.getByText('v0.8.2')).not.toBeNull()
    expect(screen.getByText('recheck')).not.toBeNull()
    expect(screen.getByText(/nothing to walk here/i)).not.toBeNull()

    fireEvent.keyDown(document.body, { key: ' ' })
    fireEvent.keyDown(document.body, { key: 'j' })
    fireEvent.keyDown(document.body, { key: 'f' })

    fireEvent.click(screen.getByRole('button', { name: 'Light view' }))
    expect(app.navigate).toHaveBeenCalledWith({ kind: 'runner', path: PATH })
  })

  test('Details uses the request-check denominator in its summary and card headers', async () => {
    app.runnerMode = 'list'
    const required = reportItem('pass')
    const optional = {
      ...reportItem(),
      id: 'also-export',
      title: 'Try the export sheet'
    }
    const { finishRun } = installBridge({
      openRun: vi.fn(async () => ({
        request: request({
          mode: 'test',
          parked: [{ id: 'also-export', text: 'Try the export sheet' }]
        }),
        report: report([required, optional], { mode: undefined }),
        exists: true
      }))
    })

    render(<Runner path={PATH} detailed />)
    await settle()

    expect(screen.getByText(/1 \/ 1 answered/)).toBeTruthy()
    expect(screen.getByText('Item 1 of 1')).toBeTruthy()
    expect(screen.getByText('Optional check')).toBeTruthy()
    expect(screen.queryByText('Item 1 of 2')).toBeNull()
    expect(screen.queryByText('Item 2 of 2')).toBeNull()
    const finish = screen
      .getAllByRole('button', { name: 'Finish run' })
      .find((button) => button.classList.contains('outbtn'))
    if (!finish) throw new Error('header Finish run button missing')
    fireEvent.click(finish)
    await settle()
    expect(finishRun).toHaveBeenCalledTimes(1)
  })

  test('focus mode labels a materialised parked item without introducing a second denominator', async () => {
    const required = reportItem('pass')
    const optional = {
      ...reportItem(),
      id: 'also-export',
      title: 'Try the export sheet'
    }
    installBridge({
      openRun: vi.fn(async () => ({
        request: request({
          mode: 'test',
          parked: [{ id: 'also-export', text: 'Try the export sheet' }]
        }),
        report: report([required, optional], { mode: undefined }),
        exists: true
      }))
    })

    render(<Runner path={PATH} detailed />)
    await settle()

    expect(screen.getByText('Optional check')).toBeTruthy()
    expect(screen.getByText(/Optional check · 1 \/ 1 answered/)).toBeTruthy()
    expect(screen.queryByText(/2 \/ 2 · 1 answered/)).toBeNull()
  })

  test('the item-list overlay labels materialised optional checks', async () => {
    const required = reportItem('pass')
    const optional = {
      ...reportItem(),
      id: 'also-export',
      title: 'Try the export sheet'
    }
    installBridge({
      openRun: vi.fn(async () => ({
        request: request({
          mode: 'test',
          parked: [{ id: 'also-export', text: 'Try the export sheet' }]
        }),
        report: report([required, optional], { mode: undefined }),
        exists: true
      }))
    })

    render(<Runner path={PATH} detailed />)
    await settle()

    fireEvent.click(screen.getByTitle('Item list (L)'))
    const itemList = screen.getByRole('dialog', { name: 'Item list' })
    const optionalRow = within(itemList).getByText('Try the export sheet').closest('.il-row')

    expect(optionalRow?.textContent).toContain('optional')
  })

  test('Runner disables verdicts during finish and preserves the submitted stamp', async () => {
    vi.useFakeTimers()
    const pending = deferred<ReportMutationResult>()
    let submitted: QaReport | null = null
    const { saveReport, finishRun } = installBridge({
      openRun: vi.fn(async () => ({
        request: request({ mode: 'test' }),
        report: report([reportItem('pass')], { mode: undefined }),
        exists: true
      })),
      finishRun: vi.fn((_path: string, value: QaReport) => {
        submitted = cloneReport(value)
        return pending.promise
      })
    })
    render(<Runner path={PATH} />)
    await settle()

    const finish = screen
      .getAllByRole('button', { name: 'Finish run' })
      .find((button) => button.classList.contains('outbtn'))
    if (!finish) throw new Error('header Finish run button missing')
    fireEvent.click(finish)

    const fail = screen.getByRole('button', { name: /Fail/ })
    expect((fail as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(fail)

    pending.resolve(mutationResult(stamp(submitted ?? report([reportItem('pass')]))))
    await settle()
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(finishRun).toHaveBeenCalledTimes(1)
    expect((submitted as QaReport | null)?.items[0].status).toBe('pass')
    expect(saveReport).not.toHaveBeenCalled()
  })

  test('a finished Runner run leaves the collect prompt on the clipboard', async () => {
    const { finishRun, copyCollectPrompt } = installBridge({
      openRun: vi.fn(async () => ({
        request: request({ mode: 'test' }),
        report: report([reportItem('pass')], { mode: undefined }),
        exists: true
      }))
    })
    render(<Runner path={PATH} />)
    await settle()

    const finish = screen
      .getAllByRole('button', { name: 'Finish run' })
      .find((button) => button.classList.contains('outbtn'))
    if (!finish) throw new Error('header Finish run button missing')
    fireEvent.click(finish)
    await settle()

    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(copyCollectPrompt).toHaveBeenCalledWith(PATH, 'Light request')
    expect(app.showToast).toHaveBeenCalledWith(
      'Collect prompt copied — paste it to the agent that asked.'
    )
  })

  test('Runner reopens, edits, and finishes again without a later unstamped save', async () => {
    vi.useFakeTimers()
    const calls: Array<{
      kind: 'save' | 'finish' | 'reopen'
      path: string
      report?: QaReport
    }> = []
    const reopened = report([reportItem('pass')])
    const { saveReport, finishRun, reopenRun } = installBridge({
      openRun: vi.fn(async () => ({
        request: request({ mode: 'test' }),
        report: report([reportItem('pass')], { completedAt: FIRST_STAMP, mode: undefined }),
        exists: true
      })),
      saveReport: vi.fn(async (requestPath: string, value: QaReport) => {
        calls.push({ kind: 'save', path: requestPath, report: cloneReport(value) })
        return { ok: true as const, savedAt: SECOND_STAMP }
      }),
      reopenRun: vi.fn(async (requestPath: string) => {
        calls.push({ kind: 'reopen', path: requestPath })
        return mutationResult(cloneReport(reopened))
      }),
      finishRun: vi.fn(async (requestPath: string, value: QaReport) => {
        calls.push({ kind: 'finish', path: requestPath, report: cloneReport(value) })
        return mutationResult(stamp(value, SECOND_STAMP))
      })
    })
    render(<Runner path={PATH} />)
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Fail/ }))
    const finish = screen
      .getAllByRole('button', { name: 'Finish run' })
      .find((button) => button.classList.contains('outbtn'))
    if (!finish) throw new Error('header Finish run button missing')
    fireEvent.click(finish)
    await settle()
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(calls.map((call) => call.kind)).toEqual(['reopen', 'finish'])
    expect(calls.every((call) => call.path === PATH)).toBe(true)
    expect(calls[1].report?.completedAt).toBeUndefined()
    expect(calls[1].report?.items[0].status).toBe('fail')
    expect(reopenRun).toHaveBeenCalledTimes(1)
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(saveReport).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reopen' })).not.toBeNull()
  })

  test('Runner keeps bare keys live on buttons while reserving Space for native activation', async () => {
    const detailedRequest = request({
      mode: 'test',
      items: [
        {
          id: 'check-one',
          title: 'Check one',
          context: 'Walk both steps.',
          steps: ['First step', 'Second step'],
          expected: [],
          notes: []
        }
      ]
    })
    installBridge({
      openRun: vi.fn(async () => ({
        request: detailedRequest,
        report: report([reportItem()], { mode: undefined }),
        exists: true
      }))
    })
    render(<Runner path={PATH} />)
    await settle()

    const firstTick = screen.getByRole('button', { name: 'Tick step 1' })
    fireEvent.click(firstTick)
    firstTick.focus()
    const tickWrites = window.qa.setItemTicks as ReturnType<typeof vi.fn>
    expect(tickWrites).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(firstTick, { key: ' ' })
    expect(tickWrites).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(firstTick, { key: 'p' })
    expect(screen.getByRole('button', { name: /Pass/ }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.keyDown(document.body, { key: ' ' })
    expect(tickWrites).toHaveBeenCalledTimes(2)
    expect(tickWrites.mock.calls[1][2].steps).toEqual([0, 1])
  })

  test('Escape in the focused Runner comment textarea does not navigate back', async () => {
    installBridge({
      openRun: vi.fn(async () => ({
        request: request({ mode: 'test' }),
        report: report([reportItem()], { mode: undefined }),
        exists: true
      }))
    })
    render(<Runner path={PATH} />)
    await settle()

    const comment = screen.getByPlaceholderText('Add a comment…')
    comment.focus()
    fireEvent.keyDown(comment, { key: 'Escape' })

    expect(app.back).not.toHaveBeenCalled()
  })

  test('the degraded view omits YAML frontmatter and renders only the request body', async () => {
    const raw = `---
id: broken
title: Broken request
mode: light
---
This is the body Dominik needs to read.
`
    installBridge({
      openRun: vi.fn(async () => ({
        request: request({
          title: 'Broken request',
          mode: 'light',
          items: [],
          parked: [],
          degraded: true,
          raw
        }),
        report: report([]),
        exists: false
      }))
    })
    const rendered = render(<Runner path={PATH} />)
    await settle()

    const plain = rendered.container.querySelector('.plainraw')
    expect(plain?.textContent).toBe('This is the body Dominik needs to read.\n')
    expect(plain?.textContent).not.toContain('mode: light')
  })
})
