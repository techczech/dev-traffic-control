import { useEffect } from 'react'
import type { SearchLanding as Landing } from '../state/app'

function scrollToQuery(root: Element, query: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if ((node.textContent ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
      node.parentElement?.scrollIntoView({ block: 'center' })
      node.parentElement?.classList.add('search-landed')
      setTimeout(() => node?.parentElement?.classList.remove('search-landed'), 1800)
      return
    }
    node = walker.nextNode()
  }
}

export function SearchLanding({ landing }: { landing?: Landing }): null {
  useEffect(() => {
    if (!landing) return
    const frame = requestAnimationFrame(() => {
      const exact = document.querySelector(`[data-source-file="${CSS.escape(landing.file)}"]`)
      const root = exact ?? document.querySelector('[data-find-scope]')
      const textarea = document.querySelector<HTMLTextAreaElement>(
        `textarea[data-source-file="${CSS.escape(landing.file)}"]`
      )
      if (textarea) {
        const lines = textarea.value.split(/\r?\n/)
        const start = lines.slice(0, Math.max(0, landing.line - 1)).join('\n').length
        const at = textarea.value
          .toLocaleLowerCase()
          .indexOf(landing.query.toLocaleLowerCase(), start)
        textarea.focus()
        if (at >= 0) textarea.setSelectionRange(at, at + landing.query.length)
      } else if (root) scrollToQuery(root, landing.query)
    })
    return () => cancelAnimationFrame(frame)
  }, [landing])
  return null
}
