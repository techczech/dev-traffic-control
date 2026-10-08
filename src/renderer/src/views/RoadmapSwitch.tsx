import { useState } from 'react'
import { useCommandScope } from '../commands/provider'
import {
  nextRoadmapLayout,
  readRoadmapLayout,
  writeRoadmapLayout,
  type RoadmapLayout
} from '../lib/roadmapLayout'
import { useApp } from '../state/app'
import { Roadmap } from './RoadmapPool'
import { LayoutSwitch, RoadmapByRelease } from './RoadmapReleases'

/**
 * The Roadmap tab: Columns and List group approved features by
 * release; Tiers is the earlier pool view, kept whole (lanes by tier, reorder,
 * promote, set aside). The choice is remembered.
 */
export function RoadmapSwitch(): React.JSX.Element {
  const { helpOpen, switcherOpen } = useApp()
  const [layout, setLayout] = useState<RoadmapLayout>(readRoadmapLayout)

  const choose = (next: RoadmapLayout): void => {
    setLayout(next)
    writeRoadmapLayout(next)
  }

  useCommandScope({
    'roadmap.toggle-layout': {
      enabled: !helpOpen && !switcherOpen,
      handler: () => choose(nextRoadmapLayout(layout))
    }
  })

  if (layout === 'tiers') {
    return (
      <>
        <div className="rr-tiers-bar">
          <LayoutSwitch layout={layout} onLayout={choose} />
        </div>
        <Roadmap />
      </>
    )
  }
  return <RoadmapByRelease layout={layout} onLayout={choose} />
}
