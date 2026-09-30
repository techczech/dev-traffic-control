import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  Check,
  CircleAlert,
  FileText,
  Folder,
  Inbox,
  Layers,
  Map as MapIcon,
  MessageSquare,
  NotebookPen,
  Plus,
  Rocket,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react'
import type { PoolTier } from '../../../main/qa/pool'
import { useApp } from '../state/app'
import { VerdictSheet } from '../components/VerdictSheet'
import { ArchiveOld } from '../components/ArchiveOld'
import { ExampleStrip } from '../components/ExampleStrip'
import { InlineText } from '../components/InlineText'
import { inlinePlain } from '../lib/inlineEmphasis'
import type { ReleaseVerdict } from '../../../main/qa/releaseRecords'
import { useCommandScope } from '../commands/provider'
import { requestKey } from '../lib/inbox'
import {
  homeReadingOrder,
  projectHome,
  type HomeList,
  type HomeRow,
  type HomeTarget,
  type HomeReleaseQuestion,
  type ProjectHomeModel
} from '../lib/projectHome'

const LANE_ICON: Record<PoolTier, typeof SlidersHorizontal> = {
  functionality: SlidersHorizontal,
  'quality-of-life': Check,
  delight: Sparkles
}

/**
 * The project home (ADR-0016 § 3, mockup states 9–12). Everything about the
 * project in scope on the Overview tab, reached by ⌘⇧H or the rail row of
 * the project already in scope.
 *
 * Every section is a place to walk into: each row opens its record or the
 * surface that holds it. The project is named once, in the indicator, and not
 * again here.
 */
export function ProjectHome({ slug }: { slug: string }): React.JSX.Element {
  const { snapshot, navigate, markSeen, housekeeping, settings, changeSetting } = useApp()
  const [sheet, setSheet] = useState<{ questions: HomeReleaseQuestion[]; start: number } | null>(
    null
  )
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const model = useMemo(
    () => (snapshot ? projectHome(snapshot, slug, now, undefined, housekeeping) : null),
    [snapshot, slug, now, housekeeping]
  )

  const open = (target: HomeTarget): void => {
    if (target.kind === 'runner') {
      markSeen(requestKey(snapshot?.root ?? '', target.path))
      navigate({ kind: 'runner', path: target.path })
    } else if (target.kind === 'thread') {
      navigate({ kind: 'thread', project: target.project, thread: target.thread })
    } else if (target.kind === 'note') {
      navigate({ kind: 'note', path: target.path })
    } else if (target.kind === 'verdict') {
      openVerdict(target.id)
    } else {
      navigate({ kind: target.surface })
    }
  }
  // The sheet walks every waiting feature, starting at the one he picked.
  const openVerdict = (id?: string): void => {
    const all = model?.releaseCall?.all ?? []
    if (all.length === 0) return
    const start = Math.max(0, id ? all.findIndex((question) => question.id === id) : 0)
    setSheet({ questions: all, start })
  }
  const answerVerdict = async (
    id: string,
    verdict: ReleaseVerdict,
    comment: string,
    screenshots: string[]
  ): Promise<void> => {
    if (!model?.releaseCall) return
    await window.qa.answerRelease({
      project: slug,
      version: model.releaseCall.version,
      id,
      verdict,
      comment,
      ...(screenshots.length > 0 ? { screenshots } : {})
    })
  }
  const verdictVersion = model?.releaseCall?.version ?? ''
  const attachVerdictShot = useCallback(
    (id: string, pngBase64: string) =>
      window.qa.addVerdictShot({ project: slug, version: verdictVersion, id, pngBase64 }),
    [slug, verdictVersion]
  )
  const readVerdictShot = useCallback(
    (rel: string) => window.qa.readVerdictShot({ project: slug, version: verdictVersion, rel }),
    [slug, verdictVersion]
  )
  const writeNote = (): void => navigate({ kind: 'note', newIn: `${snapshot?.root ?? ''}/${slug}` })

  // One address per row, in reading order, and what each address opens.
  const { order, targets } = useMemo(() => {
    if (!model || model.empty)
      return { order: [] as string[], targets: new Map<string, HomeTarget>() }
    return { order: homeReadingOrder(model), targets: homeTargets(model) }
  }, [model])
  const activeKey = selectedKey && order.includes(selectedKey) ? selectedKey : (order[0] ?? null)
  const activeIndex = activeKey ? order.indexOf(activeKey) : -1

  useCommandScope({
    'nav.move-down': {
      enabled: order.length > 0,
      handler: () => setSelectedKey(order[Math.min(activeIndex + 1, order.length - 1)] ?? null)
    },
    'nav.move-up': {
      enabled: order.length > 0,
      handler: () => setSelectedKey(order[Math.max(activeIndex - 1, 0)] ?? null)
    },
    'nav.open-selection': {
      enabled: !!activeKey,
      handler: () => {
        const target = activeKey ? targets.get(activeKey) : undefined
        if (target) open(target)
      }
    },
    // A note can be written into the project at any time, not only into an
    // empty one: the retired project view offered it in every state.
    'nav.new-note': { enabled: !!model, handler: writeNote }
  })

  if (!model) return <div className="view phome" />

  if (model.empty) {
    return (
      <div className="view phome">
        <div className="phome-scroll">
          <div className="phome-toolbar">
            <NewNoteButton onClick={writeNote} />
          </div>
          <section className="phome-card" aria-label="Nothing recorded">
            <div className="phome-empty" role="status">
              <Folder className="ic xl" strokeWidth={1.75} />
              <h2>Nothing has been recorded here yet</h2>
              <p>
                {model.name} is a folder in the record repo. No release, no requests, no threads and
                no notes have been written into it.
              </p>
              <button type="button" className="phome-btn primary" onClick={writeNote}>
                <Plus className="ic" strokeWidth={2} />
                Write the first note
              </button>
            </div>
          </section>
        </div>
      </div>
    )
  }

  const rowProps = {
    activeKey,
    onFocus: setSelectedKey,
    onOpen: open
  }
  const noRelease = model.release.kind === 'none'

  const waiting = model.waiting.total > 0 && (
    <section className="phome-card pull" aria-label="Waiting on you">
      <header>
        <CircleAlert className="ic" strokeWidth={2} />
        Waiting on you<span className="n">{model.waiting.total}</span>
      </header>
      <Rows list={model.waiting} {...rowProps} />
    </section>
  )

  const release =
    model.release.kind === 'none' ? (
      <section className="phome-card" aria-label="Release">
        <header>
          <Rocket className="ic" strokeWidth={2} />
          Release<span className="n">none declared</span>
        </header>
        <div className="phome-norelease">
          <strong>{model.release.sentence}</strong>
          <span>
            Its requests, threads and notes are below and stay where they are. A release record is
            what gives them features to sit against.
          </span>
        </div>
      </section>
    ) : (
      <section className="phome-card" aria-label="Release">
        <header>
          <Rocket className="ic" strokeWidth={2} />
          {model.release.kind === 'in-flight' ? 'Release in flight' : 'Release shipped'} —{' '}
          {model.release.version}
          <span className="n">
            {model.release.features.total} feature{model.release.features.total === 1 ? '' : 's'}
          </span>
        </header>
        {model.release.features.total === 0 ? (
          <div className="phome-quiet">No features declared in this release.</div>
        ) : (
          <div className="phome-rows">
            {model.release.features.shown.map((feature) => (
              <button
                key={feature.key}
                type="button"
                className={`phome-r${activeKey === feature.key ? ' focused' : ''}`}
                onFocus={() => setSelectedKey(feature.key)}
                onClick={() => {
                  const target = targets.get(feature.key)
                  if (target) open(target)
                }}
              >
                <span className="t">{feature.title}</span>
                <span className="meta">
                  <span className={`phome-pill ${feature.status}`}>{feature.state}</span>
                  {feature.age && (
                    <span className="age" title={exactTime(feature.at)}>
                      {feature.age}
                    </span>
                  )}
                </span>
              </button>
            ))}
            <More list={model.release.features} />
          </div>
        )}
      </section>
    )

  const requests = model.requests.total > 0 && (
    <ListCard
      label={noRelease ? 'Requests' : 'Recent requests'}
      icon={<Inbox className="ic" strokeWidth={2} />}
      list={model.requests}
      {...rowProps}
    />
  )
  const notes = model.notes.total > 0 && (
    <ListCard
      label="Notes"
      icon={<NotebookPen className="ic" strokeWidth={2} />}
      list={model.notes}
      {...rowProps}
    />
  )
  const roadmap = model.roadmap.total > 0 && (
    <section className="phome-card" aria-label="Roadmap">
      <header>
        <MapIcon className="ic" strokeWidth={2} />
        Roadmap<span className="n">{model.roadmap.total}</span>
      </header>
      <div className="phome-rows">
        {model.roadmap.lanes.map((lane) => {
          const Icon = LANE_ICON[lane.tier]
          const key = `lane:${lane.tier}`
          return (
            <button
              key={lane.tier}
              type="button"
              className={`phome-lane${activeKey === key ? ' focused' : ''}`}
              onFocus={() => setSelectedKey(key)}
              onClick={() => navigate({ kind: 'roadmap' })}
            >
              <Icon className="ic" strokeWidth={2} />
              <span className="ln">{lane.label}</span>
              <span className="lc">{lane.count}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
  const threads = model.threads.total > 0 && (
    <ListCard
      label="Open threads"
      icon={<MessageSquare className="ic" strokeWidth={2} />}
      list={model.threads}
      {...rowProps}
    />
  )
  const handoffs = (
    <ListCard
      label="Handoffs"
      icon={<ArrowRightLeft className="ic" strokeWidth={2} />}
      list={model.handoffs}
      empty="None ready right now."
      {...rowProps}
    />
  )
  const specs = model.specs.total > 0 && (
    <ListCard
      label="Specs"
      icon={<FileText className="ic" strokeWidth={2} />}
      list={model.specs}
      {...rowProps}
    />
  )
  // Only a project with round subfolders draws this; for the rest the home is
  // exactly as locked.
  const rounds = model.rounds.total > 0 && (
    <ListCard
      label="Rounds"
      icon={<Layers className="ic" strokeWidth={2} />}
      list={model.rounds}
      {...rowProps}
    />
  )

  return (
    <div className="view phome">
      {sheet && model.releaseCall && (
        <VerdictSheet
          projectName={model.name}
          version={model.releaseCall.version}
          questions={sheet.questions}
          startAt={sheet.start}
          answer={answerVerdict}
          attachShot={attachVerdictShot}
          readShot={readVerdictShot}
          onClose={() => setSheet(null)}
          layout={settings?.verdictLayout}
          onLayoutChange={(layout) => changeSetting?.('verdictLayout', layout)}
        />
      )}
      <div className="phome-scroll">
        <ExampleStrip slug={slug} />
        <div className="phome-toolbar">
          <NewNoteButton onClick={writeNote} />
          {model.standing.owed.total > 0 && <ArchiveOld scope={{ kind: 'project', slug }} />}
        </div>
        {model.releaseCall && (
          <ReleaseCall
            model={model}
            activeKey={activeKey}
            onFocus={setSelectedKey}
            onAnswer={(id) => openVerdict(id)}
          />
        )}
        <div className="phome-cols">
          {noRelease ? (
            <>
              <div className="phome-stack">
                {waiting}
                {release}
                {requests}
                {notes}
              </div>
              <div className="phome-stack">
                {threads}
                {roadmap}
                {handoffs}
                {specs}
                {rounds}
              </div>
            </>
          ) : (
            <>
              <div className="phome-stack">
                {waiting}
                {release}
                {/* Side by side only as a pair; one alone takes the column's
                    width, like the cards above it. */}
                {requests && notes ? (
                  <div className="phome-pair">
                    {requests}
                    {notes}
                  </div>
                ) : (
                  requests || notes
                )}
              </div>
              <div className="phome-stack">
                {roadmap}
                {threads}
                {handoffs}
                {specs}
                {rounds}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The release needs him (mockup state 10). The block takes the full width at
 * the top and states each question in its own words, with the feature it
 * blocks and how long it has waited; everything else drops a step behind it.
 */
function ReleaseCall({
  model,
  activeKey,
  onFocus,
  onAnswer
}: {
  model: ProjectHomeModel
  activeKey: string | null
  onFocus: (key: string) => void
  onAnswer: (id: string) => void
}): React.JSX.Element | null {
  const call = model.releaseCall
  if (!call) return null
  return (
    <section className="phome-card pull loud" aria-label="The release needs you">
      <header>
        <CircleAlert className="ic lg" strokeWidth={2} />
        {call.heading}
        {call.since && <span className="n">{call.since}</span>}
      </header>
      <div>
        {call.questions.shown.map((question, index) => (
          <div
            key={question.key}
            className={`phome-hero${activeKey === question.key ? ' focused' : ''}`}
          >
            {/* The feature's title leads; what it is follows, two lines at most,
                the whole of it on hover. */}
            <button
              type="button"
              className="q"
              title={inlinePlain(question.detail) || question.title}
              onFocus={() => onFocus(question.key)}
              onClick={() => onAnswer(question.id)}
            >
              {question.title}
            </button>
            {(question.detail || question.asked) && (
              <div className="m">
                <InlineText text={question.detail} />
                {question.detail && question.asked && ' · '}
                {question.asked}
              </div>
            )}
            {index === 0 && (
              <div className="f">
                <button
                  type="button"
                  className="phome-btn primary"
                  onClick={() => onAnswer(question.id)}
                >
                  <Check className="ic" strokeWidth={2} />
                  Give the verdict
                </button>
                <kbd>↵</kbd>
              </div>
            )}
          </div>
        ))}
        {call.questions.moreLabel && (
          <div className="phome-hero more" data-home-more>
            {call.questions.moreLabel}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * Ticket 25, drawing B: a note can be started from the top of every Project
 * Dash, whatever the project holds. It runs the same handler as `nav.new-note`.
 */
function NewNoteButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" className="phome-new-note" onClick={onClick}>
      <Plus className="ic" strokeWidth={2} />
      New note
    </button>
  )
}

interface RowProps {
  activeKey: string | null
  onFocus: (key: string) => void
  onOpen: (target: HomeTarget) => void
}

function ListCard({
  label,
  icon,
  list,
  empty,
  ...rowProps
}: RowProps & {
  label: string
  icon: React.ReactNode
  list: HomeList
  empty?: string
}): React.JSX.Element {
  return (
    <section className="phome-card" aria-label={label}>
      <header>
        {icon}
        {label}
        <span className="n">{list.total}</span>
      </header>
      {list.total === 0 ? (
        <div className="phome-quiet">{empty}</div>
      ) : (
        <Rows list={list} {...rowProps} />
      )}
    </section>
  )
}

function Rows({
  list,
  activeKey,
  onFocus,
  onOpen
}: RowProps & { list: HomeList }): React.JSX.Element {
  return (
    <div className="phome-rows">
      {list.shown.map((row: HomeRow) => (
        <button
          key={row.key}
          type="button"
          className={`phome-r${activeKey === row.key ? ' focused' : ''}`}
          onFocus={() => onFocus(row.key)}
          onClick={() => onOpen(row.target)}
        >
          <span className="t">
            {row.title}
            {row.detail && <span className="phome-d">{row.detail}</span>}
          </span>
          <span className="meta">
            {row.state && (
              <span className={`phome-state ${row.state.tone}`}>{row.state.label}</span>
            )}
            {row.age && (
              <span className="age" title={exactTime(row.at)}>
                {row.age}
              </span>
            )}
          </span>
        </button>
      ))}
      <More list={list} />
    </div>
  )
}

/** The quiet closing row of a capped list. Headers keep the full count. */
function More({ list }: { list: { moreLabel: string } }): React.JSX.Element | null {
  if (!list.moreLabel) return null
  return (
    <div className="phome-r more" data-home-more>
      <span className="t">{list.moreLabel}</span>
    </div>
  )
}

function homeTargets(model: ProjectHomeModel): Map<string, HomeTarget> {
  const targets = new Map<string, HomeTarget>()
  const releases: HomeTarget = { kind: 'surface', surface: 'releases' }
  // A verdict is given in the sheet, never on Releases (ticket 21): Releases
  // is only for reading release notes.
  for (const question of model.releaseCall?.questions.shown ?? []) {
    targets.set(question.key, { kind: 'verdict', id: question.id })
  }
  if (model.release.kind !== 'none') {
    for (const feature of model.release.features.shown)
      targets.set(
        feature.key,
        feature.status === 'you' && model.releaseCall
          ? { kind: 'verdict', id: feature.id }
          : releases
      )
  }
  for (const lane of model.roadmap.lanes) {
    targets.set(`lane:${lane.tier}`, { kind: 'surface', surface: 'roadmap' })
  }
  for (const list of [
    model.waiting,
    model.requests,
    model.notes,
    model.threads,
    model.handoffs,
    model.specs,
    model.rounds
  ]) {
    for (const row of list.shown) targets.set(row.key, row.target)
  }
  return targets
}

/** The exact day and time, for hovering over a row's short date. */
function exactTime(iso: string): string | undefined {
  // A bare day (a release row's `since:`) has no time to show.
  const day = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (day) {
    return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).toLocaleDateString(
      'en-GB',
      { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    )
  }
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return undefined
  return time.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
