import { Check, MinusCircle, StepForward, X } from 'lucide-react'
import type { Verdict } from '../../../main/qa/types'

/**
 * The Disposition vocabulary in one place: display labels over the standard
 * wire enum (ADR-0007 §2), in the locked order with their letter keys and
 * icons (ADR-0008 §7). Reading's chip flyout and the Finish-review sheet both
 * render from this list — one list, one order, one set of keys, never a
 * duplicate that can drift.
 */
export interface DispositionDef {
  v: Verdict
  label: string
  key: string
  Icon: typeof Check
}

export const DISPOSITIONS: DispositionDef[] = [
  { v: 'pass', label: 'Approve', key: 'P', Icon: Check },
  { v: 'partial', label: 'Approve with changes', key: 'N', Icon: MinusCircle },
  { v: 'fail', label: 'Needs rework', key: 'F', Icon: X },
  { v: 'skip', label: 'Not reviewed', key: 'S', Icon: StepForward }
]
