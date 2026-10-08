import { Check, MinusCircle, StepForward, X } from 'lucide-react'
import type { ItemStatus, Verdict } from '../../../main/qa/types'

interface VerdictDef {
  v: Verdict
  label: string
  key: string
  Icon: typeof Check
}

// Order and keys are fixed: P / N / F / S.
const VERDICTS: VerdictDef[] = [
  { v: 'pass', label: 'Pass', key: 'P', Icon: Check },
  { v: 'partial', label: 'Partial pass', key: 'N', Icon: MinusCircle },
  { v: 'fail', label: 'Fail', key: 'F', Icon: X },
  { v: 'skip', label: 'Skip', key: 'S', Icon: StepForward }
]

/** The four-verdict grid — Pass / Partial pass / Fail / Skip. */
export function VerdictRow({
  status,
  disabled,
  onVerdict
}: {
  status: ItemStatus
  disabled?: boolean
  onVerdict: (v: Verdict) => void
}): React.JSX.Element {
  return (
    <div className="verdicts">
      {VERDICTS.map(({ v, label, key, Icon }) => (
        <button
          key={v}
          className={`vbtn${status === v ? ` sel-${v}` : ''}`}
          aria-pressed={status === v}
          disabled={disabled}
          onClick={() => onVerdict(v)}
        >
          <Icon className="ic" strokeWidth={2} />
          {label}
          <kbd>{key}</kbd>
        </button>
      ))}
    </div>
  )
}
