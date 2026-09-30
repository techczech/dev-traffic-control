import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const REVISED_DATA_URL = 'data:image/png;base64,cmV2aXNlZA=='

function request(path: string, bodyMarkdown: string): QaRequest {
  return {
    id: 'image-review',
    title: 'Image review',
    app: 'dev-traffic-control',
    labels: { kind: 'doc-review' },
    mode: 'doc-review',
    items: [],
    parked: [],
    degraded: false,
    document: { headings: [], bodyMarkdown },
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

describe('Reading document images', () => {
  test('a relative image beside the request renders with the resolved data URL', async () => {
    const path = '/records/project/2026-07-29-review.md'
    const readShot = installBridge()
    render(
      <Reading
        path={path}
        request={request(path, '![Command surfaces](command-surfaces.png)')}
        initialReport={report()}
      />
    )

    const image = await screen.findByRole('img', { name: 'Command surfaces' })
    await waitFor(() => expect(image.getAttribute('src')).toBe(DATA_URL))
    expect(readShot).toHaveBeenCalledWith(path, 'command-surfaces.png')
  })

  test('data, HTTP, and HTTPS image sources remain untouched', () => {
    const path = '/records/project/2026-07-29-remote-review.md'
    const readShot = installBridge()
    const inline = 'data:image/svg+xml,%20'
    const http = 'http://example.test/one.png'
    const https = 'https://example.test/two.webp'
    render(
      <Reading
        path={path}
        request={request(path, `![Inline](${inline})\n![HTTP](${http})\n![HTTPS](${https})`)}
        initialReport={report()}
      />
    )

    expect(screen.getByRole('img', { name: 'Inline' }).getAttribute('src')).toBe(inline)
    expect(screen.getByRole('img', { name: 'HTTP' }).getAttribute('src')).toBe(http)
    expect(screen.getByRole('img', { name: 'HTTPS' }).getAttribute('src')).toBe(https)
    expect(readShot).not.toHaveBeenCalled()
  })

  // 2026-09-26: "there should be a way to zoom in on images when included".
  test('clicking a document image opens it large, and clicking again closes it', () => {
    const path = '/records/project/2026-07-29-zoom-review.md'
    installBridge()
    const https = 'https://example.test/diagram.png'
    render(
      <Reading
        path={path}
        request={request(path, `![Diagram](${https})`)}
        initialReport={report()}
      />
    )

    fireEvent.click(screen.getByRole('img', { name: 'Diagram' }))
    const zoomed = screen.getByRole('dialog', { name: 'Image Diagram' })
    expect(zoomed.querySelector('img.zoomimg')?.getAttribute('src')).toBe(https)
    fireEvent.click(zoomed)
    expect(screen.queryByRole('dialog', { name: 'Image Diagram' })).toBeNull()
  })

  test('a percent-encoded local filename is decoded before it is read', async () => {
    const path = '/records/project/2026-07-29-encoded-review.md'
    const readShot = installBridge(
      vi.fn(async (...args: Parameters<Window['qa']['readShot']>): Promise<string> => {
        const imagePath = args[1]
        if (imagePath !== 'my shot.png') throw new Error('ENOENT')
        return DATA_URL
      })
    )
    render(
      <Reading
        path={path}
        request={request(path, '![Encoded filename](my%20shot.png)')}
        initialReport={report()}
      />
    )

    const image = await screen.findByRole('img', { name: 'Encoded filename' })
    expect(image.getAttribute('src')).toBe(DATA_URL)
    expect(readShot).toHaveBeenCalledWith(path, 'my shot.png')
  })

  test('a malformed percent escape keeps the raw local filename and surrounding document', async () => {
    const path = '/records/project/2026-07-29-percent-review.md'
    const readShot = installBridge()
    render(
      <Reading
        path={path}
        request={request(
          path,
          'Text before the image.\n\n![Percent filename](100%.png)\n\nText after the image.'
        )}
        initialReport={report()}
      />
    )

    const image = await screen.findByRole('img', { name: 'Percent filename' })
    expect(image.getAttribute('src')).toBe(DATA_URL)
    expect(readShot).toHaveBeenCalledWith(path, '100%.png')
    expect(screen.getByText('Text before the image.')).not.toBeNull()
    expect(screen.getByText('Text after the image.')).not.toBeNull()
  })

  test('the transient loading placeholder is not announced', async () => {
    const path = '/records/project/2026-07-29-loading-review.md'
    let resolveRead: ((dataUrl: string) => void) | undefined
    const pending = new Promise<string>((resolve) => {
      resolveRead = resolve
    })
    installBridge(vi.fn(() => pending))
    render(
      <Reading
        path={path}
        request={request(path, '![Loading diagram](loading.png)')}
        initialReport={report()}
      />
    )

    const loading = screen.getByText('Loading loading.png').closest('.docimg-state')
    expect(loading?.getAttribute('role')).toBeNull()

    await act(async () => {
      resolveRead?.(DATA_URL)
      await pending
    })
  })

  test('a missing file names the unavailable image without blanking the document', async () => {
    const path = '/records/project/2026-07-29-missing-review.md'
    installBridge(vi.fn(async () => Promise.reject(new Error('ENOENT: private path details'))))
    render(
      <Reading
        path={path}
        request={request(
          path,
          'Text before the image.\n\n![Missing diagram](screens/missing-diagram.jpg)\n\nText after the image.'
        )}
        initialReport={report()}
      />
    )

    const failure = await screen.findByRole('status')
    expect(failure.textContent).toBe('Could not load missing-diagram.jpg')
    expect(screen.queryByRole('img', { name: 'Missing diagram' })).toBeNull()
    expect(screen.getByText('Text before the image.')).not.toBeNull()
    expect(screen.getByText('Text after the image.')).not.toBeNull()
    expect(screen.queryByText(/ENOENT|private path details/)).toBeNull()
  })

  test('a failed read is tried again after the Reading surface remounts', async () => {
    const path = '/records/project/2026-07-29-late-review.md'
    const readShot = installBridge(
      vi
        .fn<(requestPath: string, imagePath: string) => Promise<string>>()
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(REVISED_DATA_URL)
    )
    const imageRequest = request(path, '![Late image](late.png)')
    const first = render(<Reading path={path} request={imageRequest} initialReport={report()} />)

    expect(await screen.findByText('Could not load late.png')).not.toBeNull()
    first.unmount()
    render(<Reading path={path} request={imageRequest} initialReport={report()} />)

    const recovered = await screen.findByRole('img', { name: 'Late image' })
    expect(recovered.getAttribute('src')).toBe(REVISED_DATA_URL)
    expect(readShot).toHaveBeenCalledTimes(2)
  })

  test('a later Reading mount reads revised bytes for the same image path', async () => {
    const path = '/records/project/2026-07-29-revised-review.md'
    const readShot = installBridge(
      vi
        .fn<(requestPath: string, imagePath: string) => Promise<string>>()
        .mockResolvedValueOnce(DATA_URL)
        .mockResolvedValueOnce(REVISED_DATA_URL)
    )
    const imageRequest = request(path, '![Revised image](stable-name.png)')
    const first = render(<Reading path={path} request={imageRequest} initialReport={report()} />)

    expect((await screen.findByRole('img', { name: 'Revised image' })).getAttribute('src')).toBe(
      DATA_URL
    )
    first.unmount()
    render(<Reading path={path} request={imageRequest} initialReport={report()} />)

    expect((await screen.findByRole('img', { name: 'Revised image' })).getAttribute('src')).toBe(
      REVISED_DATA_URL
    )
    expect(readShot).toHaveBeenCalledTimes(2)
  })

  test('a rejected cache entry can retry while the Reading surface remains mounted', async () => {
    const path = '/records/project/2026-07-29-retry-review.md'
    const readShot = installBridge(
      vi
        .fn<(requestPath: string, imagePath: string) => Promise<string>>()
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(REVISED_DATA_URL)
    )
    const imageRequest = request(path, '![Retry image](retry.png)')
    const view = render(<Reading path={path} request={imageRequest} initialReport={report()} />)

    expect(await screen.findByText('Could not load retry.png')).not.toBeNull()
    view.rerender(
      <Reading
        path={path}
        request={request(path, 'The image is temporarily absent.')}
        initialReport={report()}
      />
    )
    view.rerender(<Reading path={path} request={imageRequest} initialReport={report()} />)

    const recovered = await screen.findByRole('img', { name: 'Retry image' })
    expect(recovered.getAttribute('src')).toBe(REVISED_DATA_URL)
    expect(readShot).toHaveBeenCalledTimes(2)
  })

  test('an unrelated Reading re-render does not read the same source again', async () => {
    const path = '/records/project/2026-07-29-cache-review.md'
    const readShot = installBridge()
    const imageRequest = request(path, '![Cached image](cached.png)')
    const view = render(<Reading path={path} request={imageRequest} initialReport={report()} />)

    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Cached image' })?.getAttribute('src')).toBe(
        DATA_URL
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Disposition' }))
    view.rerender(
      <Reading
        path={path}
        request={{
          ...imageRequest,
          document: {
            headings: [],
            bodyMarkdown: 'Unrelated document text.\n\n![Cached image](cached.png)'
          }
        }}
        initialReport={{ ...report() }}
      />
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(readShot).toHaveBeenCalledTimes(1)
  })
})
