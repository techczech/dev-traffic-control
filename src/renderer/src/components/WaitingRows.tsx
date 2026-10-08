import {
  ArrowRight,
  ArrowRightLeft,
  Bot,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ClipboardCheck,
  FileText,
  Flag,
  MessageCircleQuestion
} from 'lucide-react'
import { exactTime } from '../lib/dateVocabulary'
import type { HomeList, HomeRow, HomeTarget, HomeWaitingRow } from '../lib/projectHome'
import {
  WAITING_LAYOUTS,
  WAITING_LAYOUT_LABELS,
  arrangeWaiting,
  type WaitingIcon,
  type WaitingLayout,
  type WaitingMeta
} from '../lib/waitingRows'

/**
 * *Waiting on you* rows: a kind tag, the title, a count line and
 * the button that does the action. The Project Dash card and the DTC Dash
 * handoffs panel draw rows through here, so a row looks alike wherever the reviewer is
 * asked to do something.
 */

const ICONS: Record<WaitingIcon, typeof ClipboardCheck> = {
  check: ClipboardCheck,
  release: Flag,
  review: FileText,
  thread: MessageCircleQuestion,
  handoff: ArrowRightLeft
}

/** Up to this many dots; a longer list is counted in words only. */
const MAX_DOTS = 12

/** The data a row needs, whoever built it. */
export interface WaitingRowData {
  key: string
  title: string
  at: string
  age: string
  wait: WaitingMeta
  target: HomeTarget
}

export interface WaitingRowHandlers {
  activeKey: string | null
  onFocus: (key: string) => void
  onOpen: (target: HomeTarget) => void
}

export function WaitingRow({
  row,
  first,
  prefix,
  activeKey,
  onFocus,
  onOpen
}: WaitingRowHandlers & {
  row: WaitingRowData
  /** The first row drawn carries the filled button. */
  first?: boolean
  /** A project name ahead of the title, on the fleet's lists. */
  prefix?: string
}): React.JSX.Element {
  const { wait } = row
  const Icon = ICONS[wait.icon]
  return (
    <div
      className={`phome-w ${wait.kind}${activeKey === row.key ? ' focused' : ''}`}
      data-waiting-row={row.key}
    >
      <span className={`w-tag ${wait.kind}`}>
        <Icon className="ic" strokeWidth={2} />
        {wait.tag}
      </span>
      <span className="w-body">
        <button
          type="button"
          className="w-title"
          onFocus={() => onFocus(row.key)}
          onClick={() => onOpen(row.target)}
        >
          {prefix && <em>{prefix} · </em>}
          {row.title}
        </button>
        {wait.snippet ? (
          <span className="w-count snippet">{wait.snippet}</span>
        ) : (
          <span className="w-count">
            <span>
              <b>{wait.lead}</b>
              {wait.rest}
            </span>
            {wait.progress && wait.progress.total <= MAX_DOTS && (
              <span className="w-dots" aria-hidden="true">
                {Array.from({ length: wait.progress.total }, (_, index) => (
                  <i key={index} className={index < wait.progress!.done ? 'on' : ''} />
                ))}
              </span>
            )}
          </span>
        )}
      </span>
      {row.age && (
        <span className={`w-age${wait.old ? ' old' : ''}`} title={exactTime(row.at)}>
          {row.age}
        </span>
      )}
      <button
        type="button"
        className={`w-act${first ? ' first' : ''}`}
        tabIndex={-1}
        aria-label={`${wait.action} (${wait.tag}): ${row.title}`}
        onClick={() => onOpen(row.target)}
      >
        {wait.action}
        <ArrowRight className="ic" strokeWidth={2} />
      </button>
    </div>
  )
}

/** The Waiting card: rows grouped by kind or sorted newest first (Group / Sort), with the toggle in its header. */
export function WaitingCard({
  rows,
  layout,
  onLayout,
  ...handlers
}: WaitingRowHandlers & {
  rows: readonly HomeWaitingRow[]
  layout: WaitingLayout
  onLayout: (layout: WaitingLayout) => void
}): React.JSX.Element {
  const arranged = arrangeWaiting(rows, layout)
  let drawn = 0
  const draw = (row: HomeWaitingRow): React.JSX.Element => (
    <WaitingRow key={row.key} row={row} first={drawn++ === 0} {...handlers} />
  )
  return (
    <section className="phome-card pull" aria-label="Waiting on you">
      <header>
        <CircleAlert className="ic" strokeWidth={2} />
        Waiting on you<span className="n">{rows.length}</span>
        <span className="w-toggle" role="group" aria-label="Group or sort Waiting on you">
          {WAITING_LAYOUTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={layout === option}
              className={layout === option ? 'on' : ''}
              onClick={() => onLayout(option)}
            >
              {WAITING_LAYOUT_LABELS[option]}
            </button>
          ))}
        </span>
      </header>
      <div className="phome-rows waiting-rows">
        {arranged.groups
          ? arranged.groups.map((group) => (
              <div key={group.kind} className="w-group-wrap">
                <div className="w-group">
                  {group.label}
                  <i>{group.sub}</i>
                </div>
                {group.rows.map(draw)}
              </div>
            ))
          : arranged.shown.map(draw)}
        {arranged.moreLabel && (
          <div className="phome-r more w-more" data-home-more>
            <span className="t">{arranged.moreLabel}</span>
          </div>
        )}
      </div>
    </section>
  )
}

/** The quiet card under Waiting: what is the agents' move. Closed until opened. */
export function AgentsCard({
  total,
  list,
  open,
  onToggle,
  activeKey,
  onFocus,
  onOpen
}: WaitingRowHandlers & {
  total: number
  list: HomeList
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <section className="phome-agents" aria-label="With your agents">
      <button
        type="button"
        className="hd"
        aria-expanded={open}
        aria-controls="phome-agents-rows"
        onClick={onToggle}
      >
        <Bot className="ic" strokeWidth={2} />
        <span className="lbl">With your agents · {total}</span>
        <span className="sum">The agents&rsquo; move. Nothing here needs you.</span>
        <span className="show">
          {open ? 'Hide' : 'Show'}
          {open ? (
            <ChevronUp className="ic" strokeWidth={2} />
          ) : (
            <ChevronDown className="ic" strokeWidth={2} />
          )}
        </span>
      </button>
      {open && (
        <div id="phome-agents-rows" className="rows">
          {list.shown.map((row: HomeRow) => (
            <button
              key={row.key}
              type="button"
              className={`ar${activeKey === row.key ? ' focused' : ''}`}
              onFocus={() => onFocus(row.key)}
              onClick={() => onOpen(row.target)}
            >
              <span className="t">{row.title}</span>
              <span className="s">
                {row.detail?.startsWith("Agent's move") ? (
                  <>
                    <b>Agent&rsquo;s move</b>
                    {row.detail.slice("Agent's move".length)}
                  </>
                ) : (
                  row.detail
                )}
                {row.age && ` · ${row.age}`}
              </span>
            </button>
          ))}
          {list.moreLabel && <div className="ar more">{list.moreLabel}</div>}
        </div>
      )}
    </section>
  )
}
