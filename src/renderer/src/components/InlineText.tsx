import { inlineSegments } from '../lib/inlineEmphasis'

/** One line of record prose with its bold, italic and code marks rendered. */
export function InlineText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {inlineSegments(text).map((segment, i) =>
        segment.kind === 'strong' ? (
          <strong key={i}>{segment.text}</strong>
        ) : segment.kind === 'em' ? (
          <em key={i}>{segment.text}</em>
        ) : segment.kind === 'code' ? (
          <code key={i}>{segment.text}</code>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </>
  )
}
