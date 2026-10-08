import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReadingProgressState } from '../../../shared/ipc'
import { SpecQuestionCard } from '../components/SpecQuestionCard'
import { SpecRow } from '../components/SpecRow'
import { useCommandScope } from '../commands/provider'
import { reportDisplayError, validateSaveReportResult } from '../lib/reportErrors'
import { setDecisionChoice } from '../lib/reviewState'
import {
  filterSpecRows,
  needsSpecCount,
  specQuestions,
  specRows,
  type SpecFilter,
  type SpecQuestionModel
} from '../lib/specs'
import { useApp } from '../state/app'
import { EmptySurface } from './EmptySurface'

type QuestionFilter = 'unanswered' | 'answered'

/** The Specs tab's default Documents view over every document review in the record. */
export function Specs(): React.JSX.Element {
  const {
    snapshot,
    view,
    navigate,
    selectedPath,
    setSelectedPath,
    helpOpen,
    switcherOpen,
    showToast,
    scope
  } = useApp()
  const [progress, setProgress] = useState<ReadingProgressState>({})
  const [filter, setFilter] = useState<SpecFilter>('open')
  const [questionFilter, setQuestionFilter] = useState<QuestionFilter>('unanswered')
  const [selectedQuestionKey, setSelectedQuestionKey] = useState<string | null>(
    view.kind === 'specs' ? (view.questionKey ?? null) : null
  )
  const [pendingQuestions, setPendingQuestions] = useState<Set<string>>(() => new Set())
  const [retainedAnswers, setRetainedAnswers] = useState<Set<string>>(() => new Set())
  const [choiceOverrides, setChoiceOverrides] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => new Date())
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let current = true
    void window.qa
      .getReadingProgress()
      .then((state) => {
        if (current) setProgress(state)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Documents and their questions are the window's scope's.
  const rows = useMemo(
    () => (snapshot ? specRows(snapshot, scope, progress) : []),
    [snapshot, scope, progress]
  )
  const selectedMode = view.kind === 'specs' ? (view.mode ?? 'documents') : 'documents'
  const rawQuestions = useMemo(
    () => (snapshot ? specQuestions(snapshot, scope) : []),
    [snapshot, scope]
  )
  const questions = useMemo(
    () =>
      rawQuestions.map((question) => {
        if (!Object.hasOwn(choiceOverrides, question.key)) return question
        const choice = choiceOverrides[question.key]
        return { ...question, choice, answered: !!choice.trim() }
      }),
    [choiceOverrides, rawQuestions]
  )
  const visibleQuestions = useMemo(
    () =>
      questionFilter === 'answered'
        ? questions.filter((question) => question.answered)
        : questions.filter((question) => !question.answered || retainedAnswers.has(question.key)),
    [questionFilter, questions, retainedAnswers]
  )
  const visibleQuestionKeys = useMemo(
    () => visibleQuestions.map((question) => question.key),
    [visibleQuestions]
  )
  const requestedQuestionKey = view.kind === 'specs' ? view.questionKey : undefined
  const effectiveQuestionKey =
    selectedQuestionKey && visibleQuestionKeys.includes(selectedQuestionKey)
      ? selectedQuestionKey
      : requestedQuestionKey && visibleQuestionKeys.includes(requestedQuestionKey)
        ? requestedQuestionKey
        : (visibleQuestionKeys[0] ?? null)
  const visible = useMemo(() => filterSpecRows(rows, filter, query), [rows, filter, query])
  const questionCounts = useMemo(
    () => ({
      total: questions.length,
      unanswered: questions.filter((question) => !question.answered).length,
      answered: questions.filter((question) => question.answered).length,
      documents: new Set(questions.map((question) => question.requestPath)).size
    }),
    [questions]
  )
  const counts = useMemo(
    () => ({
      open: rows.filter((row) => row.state !== 'Answered').length,
      answered: rows.filter((row) => row.state === 'Answered').length,
      all: rows.length,
      needs: needsSpecCount(rows),
      questions: questionCounts.total
    }),
    [questionCounts.total, rows]
  )
  const visiblePaths = useMemo(() => visible.map((row) => row.requestPath), [visible])

  useEffect(() => {
    if (selectedMode !== 'documents') return
    if (visiblePaths.length === 0) {
      if (selectedPath !== null) setSelectedPath(null)
      return
    }
    if (!selectedPath || !visiblePaths.includes(selectedPath)) setSelectedPath(visiblePaths[0])
  }, [selectedMode, selectedPath, setSelectedPath, visiblePaths])

  useEffect(() => {
    if (selectedMode !== 'questions' || !effectiveQuestionKey) return
    const card = document.querySelector<HTMLElement>(
      `[data-question-key="${CSS.escape(effectiveQuestionKey)}"]`
    )
    card?.scrollIntoView({ block: 'nearest' })
  }, [effectiveQuestionKey, selectedMode])

  const selectedIndex = selectedPath ? visiblePaths.indexOf(selectedPath) : -1
  const selectedRow = selectedIndex >= 0 ? visible[selectedIndex] : null
  const selectedQuestionIndex = effectiveQuestionKey
    ? visibleQuestions.findIndex((question) => question.key === effectiveQuestionKey)
    : -1
  const selectedQuestion =
    selectedQuestionIndex >= 0 ? visibleQuestions[selectedQuestionIndex] : null
  const commandEnabled = !helpOpen && !switcherOpen

  const switchMode = useCallback(
    (mode: 'documents' | 'questions') => {
      if (mode === selectedMode) return
      navigate({
        kind: 'specs',
        mode,
        ...(mode === 'questions' && effectiveQuestionKey
          ? { questionKey: effectiveQuestionKey }
          : {})
      })
    },
    [effectiveQuestionKey, navigate, selectedMode]
  )

  const answerQuestion = useCallback(
    async (question: SpecQuestionModel, choice: string) => {
      if (pendingQuestions.has(question.key)) return
      setPendingQuestions((current) => new Set(current).add(question.key))
      try {
        const opened = await window.qa.openRun(question.requestPath)
        if (opened.corruptReport) {
          showToast('Open this document to recover its report before answering.')
          return
        }
        if (opened.report.completedAt) {
          showToast('Reopen this document before changing its decisions.')
          return
        }
        const next = setDecisionChoice(opened.report, question.id, question.question, choice)
        const result = validateSaveReportResult(
          await window.qa.saveReport(question.requestPath, next)
        )
        if (result.error) {
          showToast(result.error.message ?? 'Could not save this answer. Try again.')
          return
        }
        const savedChoice =
          next.items
            .find((item) => item.id === 'document')
            ?.decisions?.find((decision) => decision.id === question.id)?.choice ?? ''
        setChoiceOverrides((current) => ({ ...current, [question.key]: savedChoice }))
        setRetainedAnswers((current) => {
          const next = new Set(current)
          if (savedChoice.trim()) next.add(question.key)
          else next.delete(question.key)
          return next
        })
      } catch (error) {
        const display = reportDisplayError(error)
        showToast(display.message ?? 'Could not save this answer. Try again.')
      } finally {
        setPendingQuestions((current) => {
          const next = new Set(current)
          next.delete(question.key)
          return next
        })
      }
    },
    [pendingQuestions, showToast]
  )

  const readQuestionSection = useCallback(
    async (question: SpecQuestionModel) => {
      if (!question.headingId) return
      try {
        await window.qa.setReadingProgress(question.requestKey, {
          sectionSlug: question.headingId,
          sectionIndex: question.sectionIndex,
          sectionCount: question.sectionCount
        })
        navigate({ kind: 'specs', mode: 'questions', questionKey: question.key })
        navigate({ kind: 'runner', path: question.requestPath })
      } catch {
        showToast('Could not open that section. Try again.')
      }
    },
    [navigate, showToast]
  )

  const moveQuestion = useCallback(
    (offset: number) => {
      if (visibleQuestions.length === 0) return
      const current = selectedQuestionIndex < 0 ? 0 : selectedQuestionIndex
      const next = Math.max(0, Math.min(current + offset, visibleQuestions.length - 1))
      setSelectedQuestionKey(visibleQuestions[next].key)
    },
    [selectedQuestionIndex, visibleQuestions]
  )

  useCommandScope({
    'nav.move-down': {
      enabled:
        commandEnabled &&
        (selectedMode === 'questions' ? visibleQuestions.length > 0 : visible.length > 0),
      handler: () => {
        if (selectedMode === 'questions') moveQuestion(1)
        else
          setSelectedPath(
            visiblePaths[Math.min(selectedIndex + 1, visiblePaths.length - 1)] ?? visiblePaths[0]
          )
      }
    },
    'nav.move-up': {
      enabled:
        commandEnabled &&
        (selectedMode === 'questions' ? visibleQuestions.length > 0 : visible.length > 0),
      handler: () => {
        if (selectedMode === 'questions') moveQuestion(-1)
        else setSelectedPath(visiblePaths[Math.max(selectedIndex - 1, 0)] ?? visiblePaths[0])
      }
    },
    'nav.open-selection': {
      enabled: commandEnabled && selectedMode === 'documents' && !!selectedRow?.openable,
      handler: () => selectedRow && navigate({ kind: 'runner', path: selectedRow.requestPath })
    },
    'app.find-document': {
      enabled: commandEnabled && selectedMode === 'documents',
      handler: () => searchRef.current?.focus()
    },
    'specs.documents': {
      enabled: commandEnabled && selectedMode !== 'documents',
      handler: () => switchMode('documents')
    },
    'specs.questions': {
      enabled: commandEnabled && selectedMode !== 'questions',
      handler: () => switchMode('questions')
    },
    'specs.answer-question': {
      enabled:
        commandEnabled &&
        selectedMode === 'questions' &&
        !!selectedQuestion &&
        !selectedQuestion.answered &&
        !pendingQuestions.has(selectedQuestion.key),
      handler: (event) => {
        if (!selectedQuestion || !event) return
        const option = selectedQuestion.options[Number(event.key) - 1]
        if (option) void answerQuestion(selectedQuestion, option)
      }
    },
    'specs.read-section': {
      enabled: commandEnabled && selectedMode === 'questions' && !!selectedQuestion?.headingId,
      handler: () => selectedQuestion && void readQuestionSection(selectedQuestion)
    },
    'specs.next-question': {
      enabled: commandEnabled && selectedMode === 'questions' && visibleQuestions.length > 0,
      handler: () => moveQuestion(1)
    },
    'specs.filter-open': {
      enabled: commandEnabled && selectedMode === 'documents',
      handler: () => setFilter('open')
    },
    'specs.filter-answered': {
      enabled: commandEnabled && selectedMode === 'documents',
      handler: () => setFilter('answered')
    },
    'specs.filter-all': {
      enabled: commandEnabled && selectedMode === 'documents',
      handler: () => setFilter('all')
    },
    'specs.questions-unanswered': {
      enabled: commandEnabled && selectedMode === 'questions',
      handler: () => setQuestionFilter('unanswered')
    },
    'specs.questions-answered': {
      enabled: commandEnabled && selectedMode === 'questions',
      handler: () => setQuestionFilter('answered')
    }
  })

  if (
    selectedMode === 'documents' &&
    snapshot &&
    counts.open === 0 &&
    filter === 'open' &&
    !query
  ) {
    return (
      <EmptySurface
        surface="specs"
        answeredCount={counts.answered}
        onShowAnswered={() => setFilter('answered')}
      />
    )
  }

  return (
    <div className="view specs-view">
      <div className="specs-modebar">
        <div>
          <h1>Specs</h1>
          <span>
            {selectedMode === 'questions'
              ? `${questionCounts.total} questions across ${questionCounts.documents} documents · ${questionCounts.answered} answered`
              : `${counts.needs} ${counts.needs === 1 ? 'wants' : 'want'} your judgement`}
          </span>
        </div>
        <div className="specs-mode-tabs" role="tablist" aria-label="Specs views">
          <button
            type="button"
            className={selectedMode === 'documents' ? 'on' : undefined}
            role="tab"
            aria-selected={selectedMode === 'documents'}
            onClick={() => switchMode('documents')}
          >
            Documents <span>{counts.all}</span>
          </button>
          <button
            type="button"
            className={selectedMode === 'questions' ? 'on' : undefined}
            role="tab"
            aria-selected={selectedMode === 'questions'}
            onClick={() => switchMode('questions')}
          >
            Questions <span>{counts.questions}</span>
          </button>
        </div>
      </div>

      {selectedMode === 'documents' ? (
        <>
          <div className="specs-filters">
            <label className="specs-search">
              <Search aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="Filter by app or title…"
                aria-label="Filter specifications by app or title"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {(['open', 'answered', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`specs-filter-chip${filter === value ? ' on' : ''}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value[0].toUpperCase() + value.slice(1)} <span>{counts[value]}</span>
              </button>
            ))}
            <span className="specs-filter-grow" />
            <span className="specs-sort-label">Sorted by: what needs you first ▾</span>
          </div>

          <div className="specs-list" role="list" aria-label="Specifications">
            {visible.length > 0 ? (
              visible.map((row) => (
                <SpecRow
                  key={row.requestPath}
                  row={row}
                  focused={row.requestPath === selectedPath}
                  now={now}
                  onOpen={() => row.openable && navigate({ kind: 'runner', path: row.requestPath })}
                />
              ))
            ) : (
              <div className="specs-no-results">
                <h2>No specifications match</h2>
                <p>Change the filter or clear the text box to see the other documents.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="specs-filters">
            {(['unanswered', 'answered'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`specs-filter-chip${questionFilter === value ? ' on' : ''}`}
                aria-pressed={questionFilter === value}
                onClick={() => setQuestionFilter(value)}
              >
                {value[0].toUpperCase() + value.slice(1)} <span>{questionCounts[value]}</span>
              </button>
            ))}
            <span className="specs-filter-grow" />
            <span className="specs-sort-label">Grouped by: document ▾</span>
          </div>
          <div className="specs-question-list" role="list" aria-label="Specification questions">
            {visibleQuestions.length > 0 ? (
              <div className="specs-question-stack">
                {visibleQuestions.map((question) => (
                  <SpecQuestionCard
                    key={question.key}
                    question={question}
                    focused={question.key === effectiveQuestionKey}
                    position={
                      questions.findIndex((candidate) => candidate.key === question.key) + 1
                    }
                    total={questionCounts.total}
                    pending={pendingQuestions.has(question.key)}
                    onFocus={() => setSelectedQuestionKey(question.key)}
                    onAnswer={(choice) => void answerQuestion(question, choice)}
                    onRead={() => void readQuestionSection(question)}
                  />
                ))}
              </div>
            ) : (
              <div className="specs-no-results">
                <h2>No answered questions</h2>
                <p>Questions will collect here after you answer them.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
