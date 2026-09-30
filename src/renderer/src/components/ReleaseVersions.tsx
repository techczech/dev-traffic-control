import { ArrowLeft, PanelLeft, Share, Ship, Tags } from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  ProjectRelease,
  ReleaseVersion,
  ReleaseVerdict
} from '../../../main/qa/releaseRecords'
import type { ProjectPool } from '../../../main/qa/pool'
import { draftReleaseNotes, ledgerReleaseNotes } from '../../../shared/releaseNotes'
import { compareReleaseVersions } from '../../../shared/releaseVersionOrder'
import { useCommandScope } from '../commands/provider'
import {
  groupReleaseVersions,
  releaseBoardRows,
  type ReleaseBoardFeatureRow,
  type ReleaseBoardRow,
  type ReleaseVersionGroup
} from '../lib/releases'
import { releaseDetailTally, type ReleaseVersionLayout } from '../lib/releaseSidebar'
import { ReleaseFeatureRow } from './ReleaseFeatureRow'
import { ReleaseNotesDocument } from './ReleaseNotesDocument'
import { ReleaseShipSheet } from './ReleaseShipSheet'

type RecordedProjectRelease = Extract<ProjectRelease, { kind: 'recorded' }>
type ProposedReleaseRow = Extract<ReleaseBoardRow, { kind: 'proposed' }>
type DisplayGroup =
  { kind: 'recorded'; group: ReleaseVersionGroup } | { kind: 'proposed'; row: ProposedReleaseRow }
type RailEntry =
  { kind: 'recorded'; version: ReleaseVersion } | { kind: 'proposed'; row: ProposedReleaseRow }
/**
 * One project's releases on the Releases surface: its versions, the release in
 * flight open beside them, a shipped version as a frozen record (ADR-0015
 * direction A, ADR-0016 state 14).
 *
 * This was the ADR-0015 *app view*, with Releases, Specs and Threads tabs of
 * its own — a second, partial answer to "show me this project". Ticket 12
 * retired that: the project home is the one answer, the Specs surface holds the
 * specs, and what is left here is only the release.
 */
export function ReleaseVersions({
  release,
  pool,
  initialVersion,
  initialFeature,
  now,
  versionLayout = 'rail',
  onVersionLayoutChange,
  onError,
  onCopied,
  onShipped
}: {
  release: ProjectRelease
  pool?: ProjectPool
  initialVersion?: string
  /** A link's `#feature-id`: that feature is selected when the release opens. */
  initialFeature?: string
  now: Date
  versionLayout?: ReleaseVersionLayout
  onVersionLayoutChange?: (layout: ReleaseVersionLayout) => void
  onError: (message: string) => void
  onCopied: () => void
  onShipped: (version: string) => void
}): React.JSX.Element {
  const recordedRelease = release.kind === 'recorded' ? release : undefined
  const groups = useMemo(
    () => groupReleaseVersions(recordedRelease?.versions ?? []),
    [recordedRelease?.versions]
  )
  const proposedRows = useMemo(
    () =>
      releaseBoardRows([release], pool ? [pool] : []).filter(
        (row): row is ProposedReleaseRow => row.kind === 'proposed'
      ),
    [pool, release]
  )
  const displayGroups = useMemo<DisplayGroup[]>(
    () =>
      [
        ...groups.map((group): DisplayGroup => ({ kind: 'recorded', group })),
        ...proposedRows.map((row): DisplayGroup => ({ kind: 'proposed', row }))
      ].sort((left, right) =>
        compareReleaseVersions(displayGroupVersion(right), displayGroupVersion(left))
      ),
    [groups, proposedRows]
  )
  const rail = useMemo<RailEntry[]>(
    () =>
      displayGroups.flatMap((group) =>
        group.kind === 'proposed'
          ? [{ kind: 'proposed', row: group.row }]
          : [
              { kind: 'recorded', version: group.group.release },
              ...group.group.fixes.map((version): RailEntry => ({ kind: 'recorded', version }))
            ]
      ),
    [displayGroups]
  )
  const defaultVersion =
    initialVersion && rail.some((entry) => railEntryVersion(entry) === initialVersion)
      ? initialVersion
      : (recordedRelease?.inFlightVersion ?? railEntryVersion(rail[0]))
  const [selectedVersion, setSelectedVersion] = useState(defaultVersion)
  const [selectedFeature, setSelectedFeature] = useState<string | null>(initialFeature ?? null)
  const [openChecks, setOpenChecks] = useState<Set<string>>(() => new Set())
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const [comments, setComments] = useState<Record<string, string>>({})
  const [shipOpen, setShipOpen] = useState(false)
  const activeVersion = rail.some((entry) => railEntryVersion(entry) === selectedVersion)
    ? selectedVersion
    : defaultVersion

  const selectedIndex = Math.max(
    0,
    rail.findIndex((entry) => railEntryVersion(entry) === activeVersion)
  )
  const selectedDisplayGroup =
    displayGroups.find((group) => displayGroupContains(group, activeVersion)) ?? displayGroups[0]
  const selectedGroup =
    selectedDisplayGroup?.kind === 'recorded' ? selectedDisplayGroup.group : undefined
  const proposedRow =
    selectedDisplayGroup?.kind === 'proposed' ? selectedDisplayGroup.row : undefined
  const detailVersion = selectedGroup?.release
  const inFlightVersion = recordedRelease?.inFlightVersion
  const inFlight = !!inFlightVersion && detailVersion?.version === inFlightVersion
  const featureListActive = inFlight || !!proposedRow
  const boardRow = inFlight && recordedRelease ? recordedBoardRow(recordedRelease, pool) : null
  const activeBoardRow = proposedRow ?? boardRow
  const shippable = activeBoardRow?.shippable ?? false
  const features = activeBoardRow?.features ?? []
  const selectableFeatures = features.filter(
    (item): item is ReleaseBoardFeatureRow => item.kind === 'feature'
  )
  const activeFeature =
    selectableFeatures.find((item) => item.id === selectedFeature) ?? selectableFeatures[0]
  const appName = recordedRelease?.record.app?.trim() || release.project
  const unfinished = (boardRow?.features ?? []).flatMap((feature) =>
    feature.kind === 'feature' && feature.status === 'notstarted'
      ? [
          {
            id: feature.id,
            title: feature.title,
            tier: pool?.ideas.find((idea) => idea.id === feature.id)?.tier
          }
        ]
      : []
  )
  const fixesTarget = groups.find(
    (group) =>
      group.release.version !== detailVersion?.version &&
      !!group.release.shipment &&
      !group.release.shipment.fixesTo
  )?.release.version

  useCommandScope({
    'release.version-previous': {
      enabled: rail.length > 0,
      handler: () => setSelectedVersion(railEntryVersion(rail[Math.max(0, selectedIndex - 1)]))
    },
    'release.version-next': {
      enabled: rail.length > 0,
      handler: () =>
        setSelectedVersion(railEntryVersion(rail[Math.min(rail.length - 1, selectedIndex + 1)]))
    },
    'release.toggle-version-layout': {
      enabled: rail.length > 0,
      handler: () => onVersionLayoutChange?.(versionLayout === 'rail' ? 'pills' : 'rail')
    },
    'nav.move-down': {
      enabled: featureListActive && selectableFeatures.length > 0,
      handler: () => {
        const index = Math.max(
          0,
          selectableFeatures.findIndex((item) => item.id === activeFeature?.id)
        )
        setSelectedFeature(
          selectableFeatures[Math.min(selectableFeatures.length - 1, index + 1)]?.id
        )
      }
    },
    'nav.move-up': {
      enabled: featureListActive && selectableFeatures.length > 0,
      handler: () => {
        const index = Math.max(
          0,
          selectableFeatures.findIndex((item) => item.id === activeFeature?.id)
        )
        setSelectedFeature(selectableFeatures[Math.max(0, index - 1)]?.id)
      }
    },
    'release.answer-works': {
      enabled: inFlight && !!activeFeature?.answerable,
      handler: () => activeFeature && void answer(activeFeature, 'works')
    },
    'release.flag-feature': {
      enabled: inFlight && !!activeFeature?.answerable,
      handler: () => activeFeature && void answer(activeFeature, 'off')
    },
    'release.toggle-how-to': {
      enabled: inFlight && !!activeFeature?.howToCheck,
      handler: () => activeFeature && setOpenChecks((current) => toggled(current, activeFeature.id))
    },
    'release.give-notes': {
      enabled: !inFlight && !!detailVersion?.shipment?.notes.trim(),
      handler: () => void giveNotes()
    },
    'release.ship': {
      enabled: shippable && !shipOpen,
      handler: () => setShipOpen(true)
    }
  })

  async function answer(item: ReleaseBoardFeatureRow, verdict: ReleaseVerdict): Promise<void> {
    if (!inFlightVersion) return
    const key = item.id
    const comment = verdict === 'off' ? (comments[key] ?? item.answer?.comment ?? '') : ''
    setPending((current) => new Set(current).add(key))
    try {
      await window.qa.answerRelease({
        project: release.project,
        version: inFlightVersion,
        id: item.id,
        verdict,
        comment
      })
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The release answer could not be saved.')
    } finally {
      setPending((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  async function giveNotes(): Promise<void> {
    if (!detailVersion || !selectedGroup) return
    try {
      await navigator.clipboard.writeText(shareableNotes(selectedGroup))
      onCopied()
    } catch {
      onError('The frozen release notes could not be copied.')
    }
  }

  async function confirmShipment(notes: string, fixesTo?: string): Promise<void> {
    if (!inFlightVersion) return
    await window.qa.shipRelease({
      project: release.project,
      version: inFlightVersion,
      notes,
      ...(fixesTo ? { fixesTo } : {})
    })
    setShipOpen(false)
    onShipped(inFlightVersion)
  }

  return (
    <div className="release-app-view">
      <div className="release-app-modebar">
        {versionLayout === 'rail' && (
          <button
            type="button"
            className="release-project-list-return"
            onClick={() => onVersionLayoutChange?.('pills')}
          >
            <ArrowLeft aria-hidden="true" />
            Projects
          </button>
        )}
        {/* The project is named once, by the scope chip (ticket 06). */}
      </div>
      {release.kind === 'nothing-recorded' ? (
        <div className="release-project-empty">
          <h2>Nobody has said what {appName} is working towards</h2>
          <p>
            There is no release record for this project. Its requests, threads and specs are on the
            project home.
          </p>
        </div>
      ) : (
        <>
          <div className="release-version-toolbar">
            <span>Versions</span>
            {versionLayout === 'pills' &&
              rail.slice(0, 4).map((entry) => {
                const version = railEntryVersion(entry)
                return (
                  <button
                    type="button"
                    className={`release-version-pill${version === activeVersion ? ' on' : ''}`}
                    aria-pressed={version === activeVersion}
                    key={version}
                    onClick={() => setSelectedVersion(version)}
                  >
                    {version}
                  </button>
                )
              })}
            {versionLayout === 'pills' && rail.length > 4 && (
              <button
                type="button"
                className="release-version-pill more"
                onClick={() => onVersionLayoutChange?.('rail')}
              >
                +{rail.length - 4} more
              </button>
            )}
            <button
              type="button"
              className={`release-version-layout${versionLayout === 'rail' ? ' on' : ''}`}
              aria-pressed={versionLayout === 'rail'}
              title={
                versionLayout === 'rail' ? 'Show versions as pills' : 'Show versions in a rail'
              }
              onClick={() => onVersionLayoutChange?.(versionLayout === 'rail' ? 'pills' : 'rail')}
            >
              <PanelLeft aria-hidden="true" />
              Rail
            </button>
          </div>
          <div className={`release-app-split release-app-split-${versionLayout}`}>
            {versionLayout === 'rail' && (
              <aside className="release-version-rail" aria-label="Versions">
                <h2>
                  <Tags aria-hidden="true" />
                  Versions
                </h2>
                {displayGroups.map((displayGroup) =>
                  displayGroup.kind === 'proposed' ? (
                    <ProposedVersionButton
                      key={`proposed:${displayGroup.row.version}`}
                      row={displayGroup.row}
                      selected={activeVersion === displayGroup.row.version}
                      onSelect={() => setSelectedVersion(displayGroup.row.version)}
                    />
                  ) : (
                    <div key={displayGroup.group.release.version}>
                      <VersionButton
                        version={displayGroup.group.release}
                        selected={activeVersion === displayGroup.group.release.version}
                        inFlight={displayGroup.group.release.version === inFlightVersion}
                        onSelect={() => setSelectedVersion(displayGroup.group.release.version)}
                      />
                      {displayGroup.group.fixes.map((fix) => (
                        <VersionButton
                          key={fix.version}
                          version={fix}
                          selected={activeVersion === fix.version}
                          inFlight={false}
                          subVersion
                          onSelect={() => setSelectedVersion(fix.version)}
                        />
                      ))}
                    </div>
                  )
                )}
              </aside>
            )}
            <section className="release-version-detail">
              {activeBoardRow ? (
                <>
                  <header className="release-detail-header">
                    <div>
                      <h2>{activeBoardRow.version}</h2>
                      {activeBoardRow.kind === 'proposed' && (
                        <strong className="release-proposed-badge">{activeBoardRow.label}</strong>
                      )}
                    </div>
                    {shippable && (
                      <button
                        type="button"
                        className="release-ship"
                        onClick={() => setShipOpen(true)}
                      >
                        <Ship aria-hidden="true" />
                        Ship it
                      </button>
                    )}
                    <p>{releaseDetailTally(activeBoardRow)}</p>
                  </header>
                  <div className="release-detail-scroll" role="list">
                    {features.map((item) => (
                      <ReleaseFeatureRow
                        key={item.id}
                        item={item}
                        focused={item.kind === 'feature' && item.id === activeFeature?.id}
                        now={now}
                        readShot={(rel) =>
                          window.qa.readVerdictShot({
                            project: release.project,
                            version: activeBoardRow.version,
                            rel
                          })
                        }
                        howToOpen={openChecks.has(item.id)}
                        pending={pending.has(item.id)}
                        comment={
                          comments[item.id] ??
                          (item.kind === 'feature' ? (item.answer?.comment ?? '') : '')
                        }
                        onFocus={() => item.kind === 'feature' && setSelectedFeature(item.id)}
                        onToggleHowTo={() => setOpenChecks((current) => toggled(current, item.id))}
                        onWorks={() =>
                          activeBoardRow.kind === 'recorded' &&
                          item.kind === 'feature' &&
                          void answer(item, 'works')
                        }
                        onFlag={() =>
                          activeBoardRow.kind === 'recorded' &&
                          item.kind === 'feature' &&
                          void answer(item, 'off')
                        }
                        onCommentChange={(comment) =>
                          setComments((current) => ({ ...current, [item.id]: comment }))
                        }
                        onCommentCommit={() =>
                          activeBoardRow.kind === 'recorded' &&
                          item.kind === 'feature' &&
                          void answer(item, 'off')
                        }
                      />
                    ))}
                  </div>
                </>
              ) : detailVersion && selectedGroup ? (
                <FrozenVersion
                  group={selectedGroup}
                  app={appName}
                  onGive={() => void giveNotes()}
                />
              ) : (
                <div className="release-notes-empty">No versions were found for this app.</div>
              )}
            </section>
          </div>
        </>
      )}
      {shipOpen && shippable && detailVersion && (
        <ReleaseShipSheet
          app={appName}
          version={detailVersion.version}
          initialNotes={draftReleaseNotes(detailVersion.record)}
          unfinished={unfinished}
          fixesTarget={fixesTarget}
          onCancel={() => setShipOpen(false)}
          onConfirm={confirmShipment}
          onError={onError}
        />
      )}
    </div>
  )
}

function VersionButton({
  version,
  selected,
  inFlight,
  subVersion = false,
  onSelect
}: {
  version: ReleaseVersion
  selected: boolean
  inFlight: boolean
  subVersion?: boolean
  onSelect: () => void
}): React.JSX.Element {
  const label = inFlight
    ? 'in flight'
    : subVersion
      ? 'fixes'
      : version.shipment
        ? `shipped ${shortDate(version.shipment.shippedAt)}`
        : ledgerReleaseNotes(version.record)
          ? 'not frozen'
          : 'no frozen notes'
  return (
    <button
      type="button"
      className={`release-version-row${selected ? ' on' : ''}${subVersion ? ' sub' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span>{version.version}</span>
      <small>{label}</small>
      {inFlight && <strong>You</strong>}
    </button>
  )
}

function ProposedVersionButton({
  row,
  selected,
  onSelect
}: {
  row: ProposedReleaseRow
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`release-version-row release-version-proposed${selected ? ' on' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span>{row.version}</span>
      <small>{row.label}</small>
    </button>
  )
}

function FrozenVersion({
  group,
  app,
  onGive
}: {
  group: ReleaseVersionGroup
  app: string
  onGive: () => void
}): React.JSX.Element {
  const shipment = group.release.shipment
  const notes = shipment?.notes.trim() ?? ''
  const ledgerNotes = notes ? '' : ledgerReleaseNotes(group.release.record)
  return (
    <div className="release-detail-scroll">
      <article className="release-frozen-notes">
        <header>
          <span>{group.release.version}</span>
          {shipment && (
            <time dateTime={shipment.shippedAt}>shipped {longDate(shipment.shippedAt)}</time>
          )}
          {shipment && <strong>Frozen</strong>}
        </header>
        {notes ? (
          <ReleaseNotesDocument notes={notes} />
        ) : ledgerNotes ? (
          <LedgerNotes notes={ledgerNotes} />
        ) : (
          <p className="release-notes-missing">
            No frozen notes were recorded for {app} {group.release.version}.
          </p>
        )}
        {group.fixes.length > 0 && (
          <section className="release-fixes">
            <h3>Fixed afterwards, in {group.fixes.map((fix) => fix.version).join(' and ')}</h3>
            <ul>
              {group.fixes.map((fix) => {
                const fixNotes = fix.shipment?.notes.trim() ?? ''
                const fixLedgerNotes = fixNotes ? '' : ledgerReleaseNotes(fix.record)
                return (
                  <li key={fix.version}>
                    <strong>{fix.version}</strong>{' '}
                    {fixNotes ? (
                      fixNotes
                    ) : fixLedgerNotes ? (
                      <div className="release-fix-ledger">
                        <LedgerNotes notes={fixLedgerNotes} />
                      </div>
                    ) : (
                      'No frozen notes were recorded for these fixes.'
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        <button
          type="button"
          className="release-give"
          disabled={!notes}
          title={notes ? undefined : GIVE_NEEDS_FROZEN_NOTES}
          onClick={onGive}
        >
          <Share aria-hidden="true" />
          Give this to someone
        </button>
      </article>
    </div>
  )
}

/** Why "Give this to someone" is off: only frozen notes ever go out (ticket 28). */
const GIVE_NEEDS_FROZEN_NOTES =
  'Only frozen notes can be given to someone, and this version has none.'

/**
 * A version's release notes as they stand now, standing in for frozen notes it
 * does not have. Marked as not frozen, and never what "Give this to someone"
 * copies.
 */
function LedgerNotes({ notes }: { notes: string }): React.JSX.Element {
  return (
    <>
      <p className="release-notes-unfrozen">
        Not frozen — these are the features in the release notes as they stand now.
      </p>
      <ReleaseNotesDocument notes={notes} />
    </>
  )
}

function recordedBoardRow(
  release: RecordedProjectRelease,
  pool?: ProjectPool
): Extract<ReleaseBoardRow, { kind: 'recorded' }> | null {
  return (
    releaseBoardRows([release], pool ? [pool] : []).find(
      (row): row is Extract<ReleaseBoardRow, { kind: 'recorded' }> =>
        row.kind === 'recorded' && row.version === release.record.version
    ) ?? null
  )
}

function displayGroupVersion(group: DisplayGroup): string {
  return group.kind === 'proposed' ? group.row.version : group.group.release.version
}

function displayGroupContains(group: DisplayGroup, version: string | undefined): boolean {
  if (!version) return false
  return group.kind === 'proposed'
    ? group.row.version === version
    : group.group.release.version === version ||
        group.group.fixes.some((fix) => fix.version === version)
}

function railEntryVersion(entry: RailEntry | undefined): string | undefined {
  if (!entry) return undefined
  return entry.kind === 'proposed' ? entry.row.version : entry.version.version
}

function toggled(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function shortDate(value: string): string {
  return formatDate(value, { day: 'numeric', month: 'short' })
}

function longDate(value: string): string {
  return formatDate(value, { day: 'numeric', month: 'long' })
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', options).format(date)
}

function shareableNotes(group: ReleaseVersionGroup): string {
  const notes = group.release.shipment?.notes.trim() ?? ''
  const fixes = group.fixes
    .map((fix) => `- ${fix.version}: ${fix.shipment?.notes.trim() || 'No frozen notes recorded.'}`)
    .join('\n')
  return [`${group.release.record.app ?? 'Release'} ${group.release.version}`, notes, fixes]
    .filter(Boolean)
    .join('\n\n')
}
