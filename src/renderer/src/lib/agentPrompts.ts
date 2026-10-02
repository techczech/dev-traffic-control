/**
 * The two prompts the Feature requests tab copies to the clipboard (ticket 42).
 * No hook is wired: the reviewer pastes the prompt into an agent session. Both prompts
 * point the agent at the records-folder contract (the root `AGENTS.md`) for the
 * idea file's keys, so the field list is not repeated here and cannot drift.
 */

/** The `dtc://` link that opens one roadmap idea file in the app. */
export function ideaLink(project: string, id: string): string {
  return `dtc://open/${project}/roadmap/${id}.md`
}

/** "Ask an agent to plan this": one request with no plan. */
export function planThisPrompt(idea: { project: string; id: string; title: string }): string {
  const link = ideaLink(idea.project, idea.id)
  return [
    `Plan this feature request in the Dev Traffic Control records folder: "${idea.title}".`,
    '',
    `Idea file: ${idea.project}/roadmap/${idea.id}.md (${link})`,
    '',
    'Read the idea file and everything it links to (the places the reviewer said it, the related records). Then edit the idea file in place, following the records-folder contract (the root AGENTS.md):',
    '- `context`: your summary of the whole point, across every place it was said.',
    '- `plan`: your next step, in one or two sentences.',
    "- `fate`: `waiting` if it needs the reviewer's pick, otherwise the fate that is true now.",
    '- `related`: the records that bear on it.',
    '',
    `When you are done, reply with the link as a markdown link: [Open the request in Dev Traffic Control](${link}).`
  ].join('\n')
}

/** "Review all requests": every request in one project, or in all of them. */
export function reviewAllPrompt(scope: {
  kind: 'project' | 'all'
  project?: string
  count: number
}): string {
  const where =
    scope.kind === 'project' && scope.project
      ? `in the project ${scope.project}`
      : 'in every project under All projects'
  return [
    `Review all feature requests ${where} in the Dev Traffic Control records folder (${scope.count} listed in the app now).`,
    '',
    'Go through every idea file with `by: reviewer` under `<project>/roadmap/`. For each one, following the records-folder contract (the root AGENTS.md):',
    '- Give it a `plan` and a `fate` if it has none, and keep `context` current.',
    '- Propose its priority and its release as `candidate: <version>`. The pending release is the next minor after the highest release record; never create a `releases/<next>.md` file while an earlier release is in flight.',
    "- Do not set `fate: planned` on a request that is still `waiting`: that is the reviewer's yes, given with Approve → Roadmap in the app.",
    '',
    'Then file one doc-review that shows the proposed order and release assignments, so the reviewer can approve or change the order. Reply with the link to that doc-review as a markdown link.'
  ].join('\n')
}
