import { parseDocBlocks, renderRuns } from '../lib/richtext'

export function ReleaseNotesDocument({ notes }: { notes: string }): React.JSX.Element {
  const blocks = parseDocBlocks(notes)

  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === 'title') return <h3 key={index}>{renderRuns(block.runs)}</h3>
        if (block.kind === 'heading') {
          const Heading = block.level === 2 ? 'h4' : 'h5'
          return <Heading key={index}>{renderRuns(block.runs)}</Heading>
        }
        if (block.kind === 'para') return <p key={index}>{renderRuns(block.runs)}</p>
        if (block.kind === 'code') return <pre key={index}>{block.text}</pre>
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderRuns(item.runs)}</li>
              ))}
            </List>
          )
        }
        return null
      })}
    </>
  )
}
