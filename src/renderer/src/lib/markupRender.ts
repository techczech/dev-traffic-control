import type { Mark } from '../../../main/qa/types'
import { arrowHeadCorners, labelAnchor, labelOrigin, pinPoint } from './markup'

/**
 * Draw the marked-up copy of a picture: the original at its own
 * size, then the shapes and — in On picture mode — each mark's label joined
 * to it directly, with no numbers; in List mode the number pins instead, the
 * words living in the list. Returns the PNG as base64 for the confined screenshot
 * writer. The original image is only read, never changed.
 */

export const MARK_RED = '#d93a2f'

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = word
      } else line = candidate
    }
    lines.push(line)
  }
  return lines
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, s: number): void {
  const r = 11 * s
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = MARK_RED
  ctx.fill()
  ctx.lineWidth = 2 * s
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${12 * s}px -apple-system, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(n), x, y + 0.5 * s)
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  mark: Mark,
  W: number,
  H: number,
  s: number
): void {
  if (!mark.text.trim()) return
  const anchor = labelAnchor(mark)
  ctx.font = `500 ${13 * s}px -apple-system, system-ui, sans-serif`
  const lines = wrap(ctx, mark.text, 240 * s)
  const lineH = 17 * s
  const padX = 10 * s
  const padY = 6 * s
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const w = textW + padX * 2
  const h = lines.length * lineH + padY * 2
  const o = labelOrigin({ ...anchor, at: { x: anchor.at.x * W, y: anchor.at.y * H } }, w, h)
  const x = Math.max(2 * s, Math.min(W - w - 2 * s, o.x))
  const y = Math.max(2 * s, Math.min(H - h - 2 * s, o.y))
  roundRect(ctx, x, y, w, h, 7 * s)
  ctx.fillStyle = 'rgba(255,255,255,0.97)'
  ctx.fill()
  ctx.lineWidth = 1.5 * s
  ctx.strokeStyle = MARK_RED
  ctx.stroke()
  ctx.fillStyle = '#1f2328'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  lines.forEach((line, i) => ctx.fillText(line, x + padX, y + padY + lineH * (i + 0.5)))
}

/** Draw the marks onto a canvas already holding the picture at W×H. */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: Mark[],
  W: number,
  H: number,
  withLabels: boolean
): void {
  // Sized so the marks look as they did on screen for a typical screenshot.
  const s = Math.max(1, W / 1100)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const mark of marks) {
    ctx.strokeStyle = MARK_RED
    ctx.lineWidth = 3 * s
    if (mark.shape === 'box') {
      const { x, y, w, h } = mark.box
      roundRect(ctx, x * W, y * H, w * W, h * H, 8 * s)
      ctx.fillStyle = 'rgba(217,58,47,0.08)'
      ctx.fill()
      ctx.stroke()
    } else if (mark.shape === 'arrow') {
      const from = { x: mark.from.x * W, y: mark.from.y * H }
      const to = { x: mark.to.x * W, y: mark.to.y * H }
      const [a, b] = arrowHeadCorners(from, to, 16 * s)
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(to.x, to.y)
      ctx.lineTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.closePath()
      ctx.fillStyle = MARK_RED
      ctx.fill()
    }
  }
  if (withLabels) {
    for (const mark of marks) drawLabel(ctx, mark, W, H, s)
  } else {
    for (const mark of marks) {
      const p = pinPoint(mark)
      drawPin(ctx, p.x * W, p.y * H, mark.n, s)
    }
  }
}

/** The marked-up copy as base64 PNG (no `data:` prefix). */
export async function renderMarkedPng(
  image: HTMLImageElement,
  marks: Mark[],
  withLabels: boolean
): Promise<string> {
  const W = image.naturalWidth
  const H = image.naturalHeight
  if (!W || !H) throw new Error('the picture has not loaded')
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no drawing surface')
  ctx.drawImage(image, 0, 0, W, H)
  drawMarks(ctx, marks, W, H, withLabels)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('the picture could not be encoded')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
