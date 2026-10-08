import { BadgeCheck } from 'lucide-react'
import type { ItemStatus } from '../../../main/qa/types'

/** The spine restated as a compact row of verdict cells. */
export function MiniSpine({
  cells,
  small,
  done
}: {
  cells: ItemStatus[]
  small?: boolean
  done?: boolean
}): React.JSX.Element {
  return (
    <span className={`mini${small ? ' sm' : ''}`} aria-hidden="true">
      {cells.map((cell, i) => (
        <i key={i} className={cell !== 'unanswered' ? `v-${cell}` : ''} />
      ))}
      {done && <BadgeCheck className="ic" strokeWidth={2} />}
    </span>
  )
}
