// Surface module for the /dtc pane: keys and drawing run here, so moving costs no round
// trip. Enter and c post an action to the hooks module, which acts on a fresh scan.

import type { ClientModule } from 'claude-code'

import { initialState, reduceKey, renderPane } from './pane'
import type { PaneProps, Tone, ViewState } from './pane'

const COLOUR: Record<Tone, { color?: string; dimColor?: boolean; bold?: boolean; inverse?: boolean }> = {
  title: { bold: true },
  heading: { bold: true, color: 'suggestion' },
  row: {},
  selected: { inverse: true },
  dim: { dimColor: true },
}

let listening = false
let latest: PaneProps | null = null

const DtcView: ClientModule<any, ViewState> = (raw, surface) => {
  const props = raw as PaneProps
  latest = props
  const state: ViewState = surface.state ?? initialState()
  const { Box, Text } = surface.elements

  if (!listening) {
    listening = true
    surface.onKey(event => {
      const view = latest ?? props
      const next = reduceKey(surface.state ?? initialState(), event.key, view)
      surface.setState(next.state)
      if (next.action) surface.post(next.action)
    })
  }

  const columns = surface.columns > 0 ? surface.columns : 100
  const rows = surface.rows > 0 ? surface.rows : 24
  return (
    <Box flexDirection="column">
      {renderPane(props, state, columns, rows).map(line => (
        <Text {...COLOUR[line.tone]} wrap="truncate">
          {line.text === '' ? ' ' : line.text}
        </Text>
      ))}
    </Box>
  )
}

export default DtcView
