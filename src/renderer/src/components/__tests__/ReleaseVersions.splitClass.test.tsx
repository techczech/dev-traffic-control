import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ProjectRelease, ReleaseRecord } from '../../../../main/qa/releaseRecords'
import { ReleaseVersions } from '../ReleaseVersions'

function release(version = '1.2.0'): ProjectRelease {
  const record: ReleaseRecord = {
    path: `/record/dev-traffic-control/releases/${version}.md`,
    version,
    app: 'Dev Traffic Control',
    release: version,
    repo: 'apps/dev-traffic-control',
    updated: '2026-08-07T00:00:00.000Z',
    features: [
      {
        id: 'built',
        title: 'Built feature',
        kind: 'feature',
        declaredState: 'built',
        status: 'built'
      }
    ],
    answers: [],
    degraded: false
  }
  return {
    kind: 'recorded',
    project: 'Dev Traffic Control',
    record,
    versions: [{ version, record }],
    inFlightVersion: version
  }
}

function renderSplit(versionLayout: 'rail' | 'pills'): HTMLElement {
  const { container } = render(
    <ReleaseVersions
      release={release()}
      now={new Date('2026-08-07T08:00:00.000Z')}
      versionLayout={versionLayout}
      onError={vi.fn()}
      onCopied={vi.fn()}
      onShipped={vi.fn()}
    />
  )
  const split = container.querySelector('.release-app-split')
  if (!(split instanceof HTMLElement)) throw new Error('no .release-app-split rendered')
  return split
}

// A bare variant class is a global claim: `.rail` already belongs to the Runner's
// 46px icon strip in main.css, and it collapsed this split to 46px for two releases.
describe('the release split names its variant inside its own namespace', () => {
  test('the rail layout carries no bare `rail` class', () => {
    const split = renderSplit('rail')

    expect([...split.classList]).toContain('release-app-split-rail')
    expect([...split.classList]).not.toContain('rail')
  })

  test('the pills layout carries no bare `pills` class', () => {
    const split = renderSplit('pills')

    expect([...split.classList]).toContain('release-app-split-pills')
    expect([...split.classList]).not.toContain('pills')
  })

  test('every class on the split is namespaced, never a bare generic word', () => {
    for (const layout of ['rail', 'pills'] as const) {
      for (const className of renderSplit(layout).classList) {
        expect(className, `${layout} layout emits a bare class \`${className}\``).toMatch(
          /^release-app-split(-[a-z]+)?$/
        )
      }
    }
  })
})
