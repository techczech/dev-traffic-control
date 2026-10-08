import type { SerializableRun } from '../../../shared/ipc'

interface Chip {
  text: string
  warn: boolean
}

/**
 * Chips are labels rendered from request frontmatter — meaning lives in
 * labels, structure lives in folders. `gate` and the version
 * read verbatim; `kind: recheck` warns.
 */
export function deriveChips(run: SerializableRun): Chip[] {
  const req = run.request
  const chips: Chip[] = []
  if (req.labels.gate !== undefined) chips.push({ text: `gate ${req.labels.gate}`, warn: false })
  if (req.version) chips.push({ text: req.version, warn: false })
  for (const [key, value] of Object.entries(req.labels)) {
    if (key === 'gate') continue
    if (key === 'kind') chips.push({ text: value, warn: value === 'recheck' })
    else chips.push({ text: value, warn: false })
  }
  return chips
}

export function Chips({ run }: { run: SerializableRun }): React.JSX.Element {
  return (
    <>
      {deriveChips(run).map((chip, i) => (
        <span key={i} className={`chip${chip.warn ? ' warn' : ''}`}>
          {chip.text}
        </span>
      ))}
    </>
  )
}
