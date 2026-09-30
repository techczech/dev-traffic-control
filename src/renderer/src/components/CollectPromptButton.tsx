import { useCallback, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useCommandScope } from '../commands/provider'

export function CollectPromptButton({
  requestPath,
  title,
  finished,
  onError
}: {
  requestPath: string
  title: string
  finished: boolean
  onError?: () => void
}): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      await window.qa.copyCollectPrompt(requestPath, title)
      setCopied(true)
    } catch {
      onError?.()
    }
  }, [onError, requestPath, title])

  useCommandScope({
    'run.copy-collect-prompt': { enabled: finished, handler: () => void copy() }
  })

  if (!finished) return null
  return (
    <button
      type="button"
      className="collect-prompt-button"
      aria-label={copied ? 'Copied' : 'Copy collect prompt'}
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="ic s" aria-hidden="true" />
      ) : (
        <Copy className="ic s" aria-hidden="true" />
      )}
      {copied ? 'Copied' : 'Copy collect prompt'}
    </button>
  )
}
