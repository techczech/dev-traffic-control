import {
  ArrowRightLeft,
  FileText,
  Flag,
  Layers,
  MessageCircleQuestion,
  StickyNote
} from 'lucide-react'
import type { ChipTarget, RecordChip } from '../lib/recordChips'

const ICONS: Record<ChipTarget['kind'], typeof FileText> = {
  runner: FileText,
  thread: MessageCircleQuestion,
  note: StickyNote,
  handoffs: ArrowRightLeft,
  releases: Flag,
  roadmap: Layers,
  requests: Layers
}

/** A named record: its title, where it stands, and a way in (tickets 37 and 38). */
export function RecordChipButton({
  chip,
  onOpen
}: {
  chip: RecordChip
  onOpen: (target: ChipTarget) => void
}): React.JSX.Element {
  const Icon = ICONS[chip.target.kind]
  return (
    <button type="button" className={`rec ${chip.tone}`} onClick={() => onOpen(chip.target)}>
      <span className="rt">
        <Icon className="ic" strokeWidth={2} />
        {chip.title}
      </span>
      <span className="rs">{chip.state}</span>
    </button>
  )
}
