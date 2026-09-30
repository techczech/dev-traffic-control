/** Resize a one-row prose field to the height of its wrapped content. */
export function growTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

/** Keep a prose field fitted when its width changes and the text re-wraps. */
export function observeTextareaGrowth(textarea: HTMLTextAreaElement): () => void {
  growTextarea(textarea)
  if (typeof ResizeObserver === 'undefined') return () => undefined

  const observer = new ResizeObserver(() => growTextarea(textarea))
  observer.observe(textarea)
  return () => observer.disconnect()
}
