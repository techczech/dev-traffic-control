import { Check, ChevronRight, CircleHelp } from 'lucide-react'
import type { SpecQuestionModel } from '../lib/specs'

export function SpecQuestionCard({
  question,
  focused,
  position,
  total,
  pending,
  onFocus,
  onAnswer,
  onRead
}: {
  question: SpecQuestionModel
  focused: boolean
  position: number
  total: number
  pending: boolean
  onFocus: () => void
  onAnswer: (choice: string) => void
  onRead: () => void
}): React.JSX.Element {
  return (
    <article
      className={`spec-question-card${focused ? ' focused' : ''}${question.answered ? ' answered' : ''}`}
      data-question-key={question.key}
      role="listitem"
      onMouseDown={onFocus}
    >
      <header>
        {question.answered ? <Check aria-hidden="true" /> : <CircleHelp aria-hidden="true" />}
        <span className="spec-question-source">
          {question.app} — {question.documentTitle}
        </span>
        <span className="spec-question-position">
          {question.answered ? 'answered' : `${position} of ${total}`}
        </span>
      </header>
      {question.answered ? (
        <div className="spec-question-answer">
          <Check aria-hidden="true" />“{question.choice}” — answered
        </div>
      ) : (
        <div className="spec-question-body">
          <h2>{question.question}</h2>
          {question.context && <p>{question.context}</p>}
          <div className="spec-question-options">
            {question.options.map((option, index) => (
              <button
                key={option}
                type="button"
                className={question.choice === option ? 'picked' : undefined}
                disabled={pending}
                onClick={() => onAnswer(option)}
              >
                {index < 9 && <kbd>{index + 1}</kbd>}
                {option}
              </button>
            ))}
            <button
              type="button"
              className="spec-question-read"
              disabled={!question.headingId}
              onClick={onRead}
            >
              Read the section <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
