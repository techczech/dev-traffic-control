import { ChevronRight, GripVertical, Pencil, RotateCcw } from 'lucide-react'
import type { PoolIdea, PoolTier } from '../../../main/qa/pool'

export interface RoadmapIdeaDraft {
  id: string
  title: string
  bodyMarkdown: string
}

export function RoadmapIdeaRow({
  idea,
  focused,
  isNew,
  pending,
  dragging,
  draft,
  onDraftChange,
  onFocus,
  onDragStart,
  onDragEnd,
  onDrop,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onPromote,
  onRestore,
  stateView = false
}: {
  idea: PoolIdea
  focused: boolean
  isNew: boolean
  pending: boolean
  dragging: boolean
  draft?: RoadmapIdeaDraft
  onDraftChange?: (draft: RoadmapIdeaDraft) => void
  onFocus: () => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onDrop?: () => void
  onEdit?: () => void
  onSaveEdit?: () => void
  onCancelEdit?: () => void
  onPromote?: () => void
  onRestore?: () => void
  stateView?: boolean
}): React.JSX.Element {
  const editing = draft?.id === idea.id
  return (
    <div
      className={`roadmap-idea-row${focused ? ' focused' : ''}${dragging ? ' dragging' : ''}${editing ? ' editing' : ''}`}
      role="listitem"
      tabIndex={editing ? -1 : 0}
      draggable={!stateView && !pending && !editing}
      aria-current={focused ? 'true' : undefined}
      onClick={onFocus}
      onFocus={onFocus}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!stateView && !editing) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop?.()
      }}
    >
      <span className="roadmap-idea-grip" aria-hidden="true">
        {!stateView && !editing && <GripVertical />}
      </span>
      <span className="roadmap-idea-rank">{stateView || editing ? '' : idea.position}</span>
      {editing && draft && onDraftChange ? (
        <form
          className="roadmap-idea-editor"
          onSubmit={(event) => {
            event.preventDefault()
            onSaveEdit?.()
          }}
        >
          <label>
            <span>Title</span>
            <input
              autoFocus
              value={draft.title}
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            <span>Idea</span>
            <textarea
              rows={5}
              value={draft.bodyMarkdown}
              onChange={(event) => onDraftChange({ ...draft, bodyMarkdown: event.target.value })}
            />
          </label>
          <footer>
            <button type="button" onClick={onCancelEdit}>
              Cancel <kbd>Esc</kbd>
            </button>
            <button type="submit" className="primary" disabled={!draft.title.trim() || pending}>
              {pending ? 'Saving…' : 'Save idea'} <kbd>⌘↵</kbd>
            </button>
          </footer>
        </form>
      ) : (
        <>
          <span className="roadmap-idea-body">
            <strong>{idea.title}</strong>
            {stateView && idea.setAsideReason && (
              <em className="roadmap-idea-reason">“{idea.setAsideReason}”</em>
            )}
            <span className="roadmap-idea-meta">
              {idea.state === 'setaside' ? (
                <>
                  <span>was {tierLabel(idea.tier)}</span>
                  <span>{stateDateLabel('set aside', idea.stateAt)}</span>
                </>
              ) : idea.state === 'promoted' ? (
                <>
                  <span className="release">{idea.candidateRelease ?? 'unassigned'}</span>
                  {idea.specWanted && <span>spec wanted</span>}
                  <span>{stateDateLabel('promoted', idea.stateAt)}</span>
                </>
              ) : (
                <>
                  {idea.returnedFrom ? (
                    <span className="release">returned from {idea.returnedFrom}</span>
                  ) : (
                    <span className={idea.candidateRelease ? 'release' : ''}>
                      {idea.candidateRelease ?? 'unassigned'}
                    </span>
                  )}
                  {isNew && <span className="new">new</span>}
                  {!idea.returnedFrom && <span>{addedLabel(idea.added)}</span>}
                </>
              )}
            </span>
          </span>
          {!stateView && (
            <span className="roadmap-idea-actions">
              {focused && <kbd>{pending ? 'saving…' : '⌃⌘← / ⌃⌘→'}</kbd>}
              <button type="button" disabled={pending} onClick={onEdit}>
                <Pencil /> Edit
              </button>
              <button type="button" disabled={pending} onClick={onPromote}>
                Promote <ChevronRight />
              </button>
            </span>
          )}
          {stateView && idea.state === 'setaside' && (
            <span className="roadmap-idea-actions">
              <button type="button" disabled={pending} onClick={onRestore}>
                <RotateCcw /> Put back
              </button>
            </span>
          )}
        </>
      )}
    </div>
  )
}

function addedLabel(added?: string): string {
  if (!added) return 'date not recorded'
  const date = new Date(added)
  if (Number.isNaN(date.getTime())) return `added ${added}`
  return `added ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date)}`
}

function tierLabel(tier: PoolTier): string {
  if (tier === 'functionality') return 'Functionality'
  if (tier === 'quality-of-life') return 'Quality of life'
  return 'Delight'
}

function stateDateLabel(action: string, value?: string): string {
  if (!value) return `${action} date not recorded`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return `${action} ${value}`
  return `${action} ${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short'
  }).format(date)}`
}
