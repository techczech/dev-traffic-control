export type CommandSection =
  | 'App'
  | 'Navigate'
  | 'Light run'
  | 'Run'
  | 'Verdicts'
  | 'Review'
  | 'Mark up'
  | 'Specs'
  | 'Releases'
  | 'Roadmap'
  | 'Feature requests'
  | 'Note'
  | 'Handoffs'
  | 'Settings'
  | 'Window'

export interface CommandRuntime {
  canInvoke: (id: CommandId) => boolean
  invoke: (id: CommandId, event?: KeyboardEvent) => void
  contextLabel: string | null
}

export interface CommandDefinition {
  id: string
  title: string
  shortTitle?: string
  section: CommandSection
  defaultBinding: string | null
  alternateBindings?: readonly string[]
  contextual?: boolean
  allowInText?: 'modified' | 'always'
  hintContexts?: readonly string[]
  when: (runtime: CommandRuntime) => boolean
  handler: (runtime: CommandRuntime, event?: KeyboardEvent) => void
}

type CommandSeed = Omit<CommandDefinition, 'when' | 'handler'>

function command(seed: CommandSeed): CommandDefinition {
  return {
    ...seed,
    when: (runtime) => runtime.canInvoke(seed.id as CommandId),
    handler: (runtime, event) => runtime.invoke(seed.id as CommandId, event)
  }
}

export const COMMANDS = [
  command({
    id: 'app.command-palette',
    title: 'Command palette',
    section: 'App',
    defaultBinding: 'Mod+Shift+P',
    allowInText: 'modified'
  }),
  command({
    id: 'app.navigation-switcher',
    title: 'Navigation switcher',
    section: 'App',
    defaultBinding: 'Mod+Shift+K',
    allowInText: 'modified'
  }),
  command({
    id: 'app.contextual-actions',
    title: 'Contextual actions',
    section: 'App',
    defaultBinding: 'Mod+K',
    allowInText: 'modified'
  }),
  command({
    id: 'app.inspector',
    title: 'Inspector',
    section: 'App',
    defaultBinding: 'Mod+P',
    allowInText: 'modified'
  }),
  command({
    id: 'app.find-document',
    title: 'Find in document',
    section: 'App',
    defaultBinding: 'Mod+F',
    allowInText: 'modified'
  }),
  command({
    id: 'app.search-everything',
    title: 'Search across everything',
    section: 'App',
    defaultBinding: 'Mod+Shift+F',
    allowInText: 'modified'
  }),
  command({
    id: 'app.settings',
    title: 'Settings',
    section: 'App',
    defaultBinding: 'Mod+,',
    allowInText: 'modified'
  }),
  command({
    id: 'app.new-window',
    title: 'New Window',
    section: 'App',
    defaultBinding: 'Mod+N',
    allowInText: 'modified'
  }),
  command({
    id: 'app.cheat-sheet',
    title: 'Keyboard cheat sheet',
    section: 'App',
    defaultBinding: 'Mod+/',
    alternateBindings: ['?'],
    allowInText: 'modified'
  }),
  command({
    id: 'app.rebind-highlighted',
    title: 'Rebind the highlighted command',
    section: 'App',
    defaultBinding: 'Mod+Shift+,',
    allowInText: 'modified'
  }),
  command({
    id: 'reading.text-size-increase',
    title: 'Increase request text size',
    section: 'App',
    defaultBinding: 'Mod+=',
    allowInText: 'modified'
  }),
  command({
    id: 'reading.text-size-decrease',
    title: 'Decrease request text size',
    section: 'App',
    defaultBinding: 'Mod+-',
    allowInText: 'modified'
  }),
  command({
    id: 'reading.text-size-reset',
    title: 'Reset request text size',
    section: 'App',
    defaultBinding: 'Mod+0',
    allowInText: 'modified'
  }),
  command({
    id: 'app.close-back',
    title: 'Close or go back',
    section: 'App',
    defaultBinding: 'Escape',
    allowInText: 'always',
    hintContexts: ['settings']
  }),
  command({
    id: 'find.next',
    title: 'Find next match',
    section: 'Navigate',
    defaultBinding: 'Enter',
    allowInText: 'always'
  }),
  command({
    id: 'find.previous',
    title: 'Find previous match',
    section: 'Navigate',
    defaultBinding: 'Shift+Enter',
    allowInText: 'always'
  }),
  command({
    id: 'palette.move-down',
    title: 'Move to the next palette command',
    section: 'App',
    defaultBinding: 'ArrowDown',
    allowInText: 'always'
  }),
  command({
    id: 'palette.move-up',
    title: 'Move to the previous palette command',
    section: 'App',
    defaultBinding: 'ArrowUp',
    allowInText: 'always'
  }),
  command({
    id: 'palette.run',
    title: 'Run the highlighted command',
    section: 'App',
    defaultBinding: 'Enter',
    allowInText: 'always'
  }),
  command({
    id: 'palette.restore-default',
    title: 'Restore the highlighted command default',
    section: 'App',
    defaultBinding: 'Mod+Backspace',
    allowInText: 'always'
  }),

  command({
    id: 'nav.dashboard',
    title: 'Go to Overview',
    section: 'Navigate',
    defaultBinding: 'Mod+1'
  }),
  command({
    id: 'nav.get-started',
    title: 'Get started: connect your agents',
    shortTitle: 'Get started',
    section: 'Navigate',
    defaultBinding: 'Mod+Alt+G'
  }),
  command({
    id: 'nav.inbox',
    title: 'Go to Inbox',
    section: 'Navigate',
    defaultBinding: 'Mod+2'
  }),
  command({
    id: 'nav.specs',
    title: 'Go to Specs',
    section: 'Navigate',
    defaultBinding: 'Mod+3'
  }),
  command({
    id: 'nav.releases',
    title: 'Go to Releases',
    section: 'Navigate',
    defaultBinding: 'Mod+4'
  }),
  command({
    id: 'nav.roadmap',
    title: 'Go to Roadmap',
    section: 'Navigate',
    defaultBinding: 'Mod+5'
  }),
  command({
    id: 'nav.handoffs',
    title: 'Go to Handoffs',
    section: 'Navigate',
    defaultBinding: 'Mod+6'
  }),
  command({
    id: 'nav.requests',
    title: 'Go to Feature requests',
    section: 'Navigate',
    defaultBinding: 'Mod+7'
  }),
  // Overview follows scope; this chord selects it inside a project.
  command({
    id: 'nav.project-home',
    title: 'Go to project Overview',
    section: 'Navigate',
    defaultBinding: 'Mod+Shift+H'
  }),
  command({
    id: 'nav.copy-project-link',
    title: 'Copy link to this project',
    section: 'Navigate',
    defaultBinding: 'Mod+Shift+L'
  }),
  command({
    id: 'nav.all-projects',
    title: 'Go to All projects',
    section: 'Navigate',
    defaultBinding: 'Mod+Shift+0'
  }),
  command({
    id: 'nav.move-down',
    title: 'Move selection down',
    shortTitle: 'Move',
    section: 'Navigate',
    defaultBinding: 'ArrowDown',
    alternateBindings: ['J'],
    hintContexts: ['dashboard', 'inbox', 'handoffs', 'specs', 'releases', 'roadmap', 'requests']
  }),
  command({
    id: 'nav.move-up',
    title: 'Move selection up',
    shortTitle: 'Move',
    section: 'Navigate',
    defaultBinding: 'ArrowUp',
    alternateBindings: ['K'],
    hintContexts: ['dashboard', 'inbox', 'handoffs', 'specs', 'releases', 'roadmap', 'requests']
  }),
  command({
    id: 'nav.open-selection',
    title: 'Open the selection',
    shortTitle: 'Open',
    section: 'Navigate',
    defaultBinding: 'Enter',
    contextual: true,
    hintContexts: ['dashboard', 'inbox', 'handoffs', 'specs', 'requests']
  }),
  command({
    id: 'nav.open-project',
    title: 'Open the selected project',
    shortTitle: 'Project',
    section: 'Navigate',
    defaultBinding: 'ArrowRight',
    contextual: true,
    hintContexts: ['inbox']
  }),
  command({
    id: 'specs.documents',
    title: 'Show specification documents',
    shortTitle: 'Documents',
    section: 'Specs',
    defaultBinding: '[',
    hintContexts: ['specs']
  }),
  command({
    id: 'specs.questions',
    title: 'Show specification questions',
    shortTitle: 'Questions',
    section: 'Specs',
    defaultBinding: ']',
    hintContexts: ['specs']
  }),
  command({
    id: 'specs.answer-question',
    title: 'Answer the highlighted specification question',
    shortTitle: 'Answer',
    section: 'Specs',
    defaultBinding: '1–9',
    hintContexts: ['specs']
  }),
  command({
    id: 'specs.read-section',
    title: 'Read the section for the highlighted question',
    shortTitle: 'Read section',
    section: 'Specs',
    defaultBinding: 'R',
    hintContexts: ['specs']
  }),
  command({
    id: 'specs.next-question',
    title: 'Move to the next specification question',
    shortTitle: 'Leave unanswered',
    section: 'Specs',
    defaultBinding: 'Mod+ArrowDown',
    hintContexts: ['specs']
  }),
  command({
    id: 'specs.filter-open',
    title: 'Show open specification documents',
    section: 'Specs',
    defaultBinding: 'Shift+O',
    hintContexts: ['specs']
  }),
  command({
    id: 'specs.filter-answered',
    title: 'Show answered specification documents',
    section: 'Specs',
    defaultBinding: 'Shift+A',
    hintContexts: ['specs']
  }),
  command({
    id: 'specs.filter-all',
    title: 'Show all specification documents',
    section: 'Specs',
    defaultBinding: 'Shift+L',
    hintContexts: ['specs']
  }),
  command({
    id: 'specs.questions-unanswered',
    title: 'Show unanswered specification questions',
    section: 'Specs',
    defaultBinding: 'Alt+U',
    hintContexts: ['specs']
  }),
  command({
    id: 'specs.questions-answered',
    title: 'Show answered specification questions',
    section: 'Specs',
    defaultBinding: 'Alt+A',
    hintContexts: ['specs']
  }),
  command({
    id: 'nav.archive-selection',
    title: 'Archive the selected request',
    shortTitle: 'Archive',
    section: 'Navigate',
    defaultBinding: 'E',
    contextual: true
  }),
  command({
    id: 'nav.unarchive-selection',
    title: 'Restore the selected request',
    section: 'Navigate',
    defaultBinding: 'Shift+E',
    contextual: true
  }),
  command({
    id: 'nav.toggle-archived',
    title: 'Show or hide archived requests',
    section: 'Navigate',
    defaultBinding: 'Shift+A'
  }),
  command({
    id: 'nav.new-note',
    title: 'New note',
    section: 'Navigate',
    defaultBinding: 'N',
    hintContexts: ['dashboard']
  }),
  command({
    id: 'nav.toggle-waiting-layout',
    title: 'Waiting on you: group or sort',
    shortTitle: 'Arrange',
    section: 'Navigate',
    defaultBinding: 'W',
    contextual: true,
    hintContexts: ['dashboard']
  }),
  command({
    id: 'nav.choose-record-folder',
    title: 'Choose the record folder',
    section: 'Navigate',
    defaultBinding: 'Mod+Shift+O'
  }),

  command({
    id: 'release.answer-works',
    title: 'Mark the highlighted feature works',
    shortTitle: 'Works',
    section: 'Releases',
    defaultBinding: 'Y',
    contextual: true,
    hintContexts: ['releases']
  }),
  command({
    id: 'release.flag-feature',
    title: 'Flag the highlighted feature',
    shortTitle: 'Flag',
    section: 'Releases',
    defaultBinding: 'F',
    contextual: true,
    hintContexts: ['releases']
  }),
  command({
    id: 'release.toggle-how-to',
    title: 'Show or hide how to check the highlighted feature',
    shortTitle: 'How to check',
    section: 'Releases',
    defaultBinding: 'H',
    contextual: true,
    hintContexts: ['releases']
  }),
  command({
    id: 'release.open-app',
    title: 'Open the selected app release',
    shortTitle: 'Open app',
    section: 'Releases',
    defaultBinding: 'Enter',
    contextual: true,
    hintContexts: ['releases']
  }),
  command({
    id: 'release.show-board',
    title: 'Show the all-apps release board',
    shortTitle: 'All-apps board',
    section: 'Releases',
    defaultBinding: 'Alt+B',
    hintContexts: ['releases']
  }),
  command({
    id: 'release.project-previous',
    title: 'Select the previous release project',
    shortTitle: 'Previous project',
    section: 'Releases',
    defaultBinding: 'Alt+Shift+ArrowUp',
    hintContexts: ['releases']
  }),
  command({
    id: 'release.project-next',
    title: 'Select the next release project',
    shortTitle: 'Next project',
    section: 'Releases',
    defaultBinding: 'Alt+Shift+ArrowDown',
    hintContexts: ['releases']
  }),
  command({
    id: 'release.toggle-version-layout',
    title: 'Switch between version pills and the version rail',
    shortTitle: 'Pills or rail',
    section: 'Releases',
    defaultBinding: 'Alt+V',
    hintContexts: ['releases']
  }),
  command({
    id: 'release.toggle-needs-you-group',
    title: 'Fold or unfold release projects that need you',
    section: 'Releases',
    defaultBinding: 'Ctrl+Alt+1'
  }),
  command({
    id: 'release.toggle-in-flight-group',
    title: 'Fold or unfold release projects in flight',
    section: 'Releases',
    defaultBinding: 'Ctrl+Alt+2'
  }),
  command({
    id: 'release.toggle-nothing-declared-group',
    title: 'Fold or unfold projects with nothing declared',
    section: 'Releases',
    defaultBinding: 'Ctrl+Alt+3'
  }),
  command({
    id: 'release.version-previous',
    title: 'Move to the previous version',
    section: 'Releases',
    defaultBinding: 'Alt+ArrowUp',
    hintContexts: ['releases']
  }),
  command({
    id: 'release.version-next',
    title: 'Move to the next version',
    section: 'Releases',
    defaultBinding: 'Alt+ArrowDown',
    hintContexts: ['releases']
  }),
  command({
    id: 'release.give-notes',
    title: 'Give these frozen release notes to someone',
    shortTitle: 'Give notes',
    section: 'Releases',
    defaultBinding: 'G',
    contextual: true,
    hintContexts: ['releases']
  }),
  command({
    id: 'release.ship',
    title: 'Ship this release',
    shortTitle: 'Ship it',
    section: 'Releases',
    defaultBinding: 'Shift+S',
    contextual: true,
    hintContexts: ['releases']
  }),
  command({
    id: 'release.scope-in-flight',
    title: 'Show releases in flight',
    section: 'Releases',
    defaultBinding: 'Alt+I'
  }),
  command({
    id: 'release.scope-shipped',
    title: 'Show shipped releases',
    section: 'Releases',
    defaultBinding: 'Alt+H'
  }),
  command({
    id: 'release.filter-everything',
    title: 'Show every release feature',
    section: 'Releases',
    defaultBinding: 'Alt+1'
  }),
  command({
    id: 'release.filter-you',
    title: 'Show release features waiting on you',
    section: 'Releases',
    defaultBinding: 'Alt+2'
  }),
  command({
    id: 'release.filter-building',
    title: 'Show release features being built',
    section: 'Releases',
    defaultBinding: 'Alt+3'
  }),
  command({
    id: 'release.filter-not-started',
    title: 'Show release features not started',
    section: 'Releases',
    defaultBinding: 'Alt+4'
  }),
  command({
    id: 'release.ship-own',
    title: 'Ship as a release of its own',
    section: 'Releases',
    defaultBinding: 'Alt+1',
    allowInText: 'modified'
  }),
  command({
    id: 'release.ship-fixes',
    title: 'Ship as fixes to the previous release',
    section: 'Releases',
    defaultBinding: 'Alt+2',
    allowInText: 'modified'
  }),
  command({
    id: 'release.ship-confirm',
    title: 'Ship and freeze the release notes',
    section: 'Releases',
    defaultBinding: 'Mod+Enter',
    allowInText: 'modified'
  }),

  command({
    id: 'roadmap.project-previous',
    title: 'Select the previous Roadmap project',
    shortTitle: 'Previous project',
    section: 'Roadmap',
    defaultBinding: 'Ctrl+Alt+ArrowUp',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.project-next',
    title: 'Select the next Roadmap project',
    shortTitle: 'Next project',
    section: 'Roadmap',
    defaultBinding: 'Ctrl+Alt+ArrowDown',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.toggle-with-ideas-group',
    title: 'Fold or unfold Roadmap projects with ideas',
    section: 'Roadmap',
    defaultBinding: 'Ctrl+Alt+4'
  }),
  command({
    id: 'roadmap.toggle-nothing-in-pool-group',
    title: 'Fold or unfold projects with nothing in the Roadmap pool',
    section: 'Roadmap',
    defaultBinding: 'Ctrl+Alt+5'
  }),
  command({
    id: 'roadmap.move-up',
    title: 'Move the highlighted idea up its lane',
    shortTitle: 'Move up',
    section: 'Roadmap',
    defaultBinding: 'Ctrl+Mod+ArrowUp',
    contextual: true,
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.move-down',
    title: 'Move the highlighted idea down its lane',
    shortTitle: 'Move down',
    section: 'Roadmap',
    defaultBinding: 'Ctrl+Mod+ArrowDown',
    contextual: true,
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.move-left',
    title: 'Move the highlighted idea to the previous lane',
    shortTitle: 'Previous lane',
    section: 'Roadmap',
    defaultBinding: 'Ctrl+Mod+ArrowLeft',
    contextual: true
  }),
  command({
    id: 'roadmap.move-right',
    title: 'Move the highlighted idea to the next lane',
    shortTitle: 'Next lane',
    section: 'Roadmap',
    defaultBinding: 'Ctrl+Mod+ArrowRight',
    contextual: true
  }),
  command({
    id: 'roadmap.promote',
    title: 'Promote the highlighted idea into a release',
    shortTitle: 'Promote',
    section: 'Roadmap',
    defaultBinding: 'P',
    contextual: true,
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.edit-idea',
    title: 'Edit the highlighted Roadmap idea',
    shortTitle: 'Edit idea',
    section: 'Roadmap',
    defaultBinding: 'Enter',
    contextual: true,
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.set-aside',
    title: 'Set the highlighted idea aside',
    shortTitle: 'Set aside',
    section: 'Roadmap',
    defaultBinding: 'Shift+S',
    contextual: true,
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.put-back',
    title: 'Put the highlighted idea back in its lane',
    shortTitle: 'Put back',
    section: 'Roadmap',
    defaultBinding: 'B',
    contextual: true
  }),
  command({
    id: 'roadmap.confirm-action',
    title: 'Confirm the open Roadmap action',
    shortTitle: 'Confirm',
    section: 'Roadmap',
    defaultBinding: 'Mod+Enter',
    contextual: true,
    allowInText: 'modified'
  }),
  command({
    id: 'roadmap.filter-pool',
    title: 'Show ideas in the pool',
    section: 'Roadmap',
    defaultBinding: 'Alt+P',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.filter-set-aside',
    title: 'Show ideas set aside',
    section: 'Roadmap',
    defaultBinding: 'Alt+A',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.filter-promoted',
    title: 'Show promoted ideas',
    section: 'Roadmap',
    defaultBinding: 'Alt+R',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.toggle-functionality',
    title: 'Fold or unfold the Functionality lane',
    section: 'Roadmap',
    defaultBinding: 'Alt+1',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.toggle-quality-of-life',
    title: 'Fold or unfold the Quality of life lane',
    section: 'Roadmap',
    defaultBinding: 'Alt+2',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.toggle-delight',
    title: 'Fold or unfold the Delight lane',
    section: 'Roadmap',
    defaultBinding: 'Alt+3',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.choose-sheet-option',
    title: 'Choose an option in the open Roadmap sheet',
    section: 'Roadmap',
    defaultBinding: '1–9'
  }),
  command({
    id: 'roadmap.sort-lane',
    title: 'Sort this Roadmap lane out',
    section: 'Roadmap',
    defaultBinding: 'Alt+S',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.add-idea',
    title: 'Add an idea to the Roadmap',
    section: 'Roadmap',
    defaultBinding: 'N',
    hintContexts: ['roadmap']
  }),

  command({
    id: 'roadmap.toggle-layout',
    title: 'Switch the Roadmap between Columns, List and Tiers',
    shortTitle: 'Layout',
    section: 'Roadmap',
    defaultBinding: 'L',
    hintContexts: ['roadmap']
  }),
  command({
    id: 'roadmap.move-to',
    title: 'Move the highlighted feature to another release',
    shortTitle: 'Move to…',
    section: 'Roadmap',
    defaultBinding: 'M',
    contextual: true,
    hintContexts: ['roadmap']
  }),

  command({
    id: 'requests.review-all',
    title: 'Copy the prompt that asks an agent to review all requests',
    shortTitle: 'Review all',
    section: 'Feature requests',
    defaultBinding: 'R',
    hintContexts: ['requests']
  }),
  command({
    id: 'requests.toggle-finished',
    title: 'Fold or unfold the Finished feature requests',
    shortTitle: 'Finished',
    section: 'Feature requests',
    defaultBinding: 'F',
    hintContexts: ['requests']
  }),
  command({
    id: 'requests.show-no-plan',
    title: 'Show only the feature requests without a plan',
    shortTitle: 'No plan',
    section: 'Feature requests',
    defaultBinding: 'N',
    hintContexts: ['requests']
  }),

  command({
    id: 'light.toggle-works',
    title: 'Mark this check works',
    shortTitle: 'Works',
    section: 'Light run',
    defaultBinding: 'Space',
    hintContexts: ['light-run']
  }),
  command({
    id: 'light.toggle-problem',
    title: 'Flag a problem on this check',
    shortTitle: 'Problem',
    section: 'Light run',
    defaultBinding: 'F',
    hintContexts: ['light-run']
  }),
  command({
    id: 'light.toggle-detail',
    title: 'Show this check’s steps',
    shortTitle: 'Steps',
    section: 'Light run',
    defaultBinding: 'S',
    hintContexts: ['light-run-detail']
  }),
  command({
    id: 'light.toggle-all-details',
    title: 'Step by step — open every drawer',
    shortTitle: 'All steps',
    section: 'Light run',
    defaultBinding: 'T',
    hintContexts: ['light-run-detail']
  }),
  command({
    id: 'light.everything-works',
    title: 'Everything works',
    shortTitle: 'All good',
    section: 'Light run',
    defaultBinding: 'A',
    contextual: true,
    hintContexts: ['light-run']
  }),
  command({
    id: 'light.add-observation',
    title: 'Add an observation',
    shortTitle: 'Observation',
    section: 'Light run',
    defaultBinding: 'O',
    contextual: true,
    hintContexts: ['light-run']
  }),
  command({
    id: 'light.remove-observation',
    title: 'Remove the focused observation',
    section: 'Light run',
    defaultBinding: 'Shift+Backspace'
  }),
  command({
    id: 'light.focus-check',
    title: 'Focus check 1–9',
    shortTitle: 'Focus',
    section: 'Light run',
    defaultBinding: '1–9',
    hintContexts: ['light-run']
  }),
  command({
    id: 'light.open-detailed',
    title: 'Switch to the detailed view',
    section: 'Light run',
    defaultBinding: 'D',
    contextual: true
  }),
  command({
    id: 'light.paste-screenshot',
    title: 'Paste a screenshot',
    shortTitle: 'Screenshot',
    section: 'Light run',
    defaultBinding: 'Mod+V'
  }),

  command({
    id: 'run.tick-next',
    title: 'Tick the next step or expected bullet',
    section: 'Run',
    defaultBinding: 'Space'
  }),
  command({
    id: 'run.untick-last',
    title: 'Untick the most recently ticked',
    section: 'Run',
    defaultBinding: 'Shift+Space'
  }),
  command({
    id: 'run.flag-expected',
    title: 'Flag an expected bullet',
    shortTitle: 'Flag',
    section: 'Run',
    defaultBinding: '1–9',
    hintContexts: ['run']
  }),
  command({
    id: 'run.comment',
    title: 'Comment on this item',
    section: 'Run',
    defaultBinding: 'C'
  }),
  command({
    id: 'run.quote',
    title: 'Quote the selected text',
    section: 'Run',
    defaultBinding: 'Q'
  }),
  command({ id: 'run.item-list', title: 'Item list', section: 'Run', defaultBinding: 'L' }),
  command({
    id: 'run.other-observations',
    title: 'Other observations',
    section: 'Run',
    defaultBinding: 'O'
  }),
  command({
    id: 'run.next-item',
    title: 'Next item',
    section: 'Run',
    defaultBinding: 'ArrowRight',
    alternateBindings: ['J']
  }),
  command({
    id: 'run.previous-item',
    title: 'Previous item',
    section: 'Run',
    defaultBinding: 'ArrowLeft',
    alternateBindings: ['K']
  }),
  command({
    id: 'run.finish',
    title: 'Finish the run',
    shortTitle: 'Finish',
    section: 'Run',
    defaultBinding: 'Shift+F',
    contextual: true,
    hintContexts: ['run', 'light-run']
  }),
  command({
    id: 'run.reopen',
    title: 'Reopen the run',
    section: 'Run',
    defaultBinding: 'Shift+R',
    contextual: true
  }),
  command({
    id: 'run.copy-collect-prompt',
    title: 'Copy collect prompt',
    shortTitle: 'Copy collect prompt',
    section: 'Run',
    defaultBinding: 'Mod+Shift+C',
    contextual: true
  }),
  command({
    id: 'run.open-other-surface',
    title: 'Open in the other run surface',
    section: 'Run',
    defaultBinding: 'V',
    contextual: true
  }),
  command({
    id: 'run.retry-save',
    title: 'Retry saving the run',
    section: 'Run',
    defaultBinding: 'Mod+Shift+R'
  }),
  command({
    id: 'run.paste-screenshot',
    title: 'Paste a screenshot',
    shortTitle: 'Screenshot',
    section: 'Run',
    defaultBinding: 'Mod+V'
  }),
  command({
    id: 'run.finish-confirm',
    title: 'Confirm finishing the run',
    section: 'Run',
    defaultBinding: 'Enter'
  }),
  command({
    id: 'verdict.pass',
    title: 'Pass',
    shortTitle: 'Pass',
    section: 'Verdicts',
    defaultBinding: 'P',
    hintContexts: ['run']
  }),
  command({
    id: 'verdict.partial',
    title: 'Partial pass',
    shortTitle: 'Partial',
    section: 'Verdicts',
    defaultBinding: 'N',
    hintContexts: ['run']
  }),
  command({
    id: 'verdict.fail',
    title: 'Fail',
    shortTitle: 'Fail',
    section: 'Verdicts',
    defaultBinding: 'F',
    hintContexts: ['run']
  }),
  command({
    id: 'verdict.skip',
    title: 'Skip',
    shortTitle: 'Skip',
    section: 'Verdicts',
    defaultBinding: 'S',
    hintContexts: ['run']
  }),

  // Ticket 27: the verdict sheet's All at once list, answered as in a check.
  command({
    id: 'verdicts.works',
    title: 'Answer Works on the focused feature',
    shortTitle: 'Works',
    section: 'Verdicts',
    defaultBinding: 'Space'
  }),
  command({
    id: 'verdicts.off',
    title: 'Answer Something’s off on the focused feature',
    shortTitle: 'Something’s off',
    section: 'Verdicts',
    defaultBinding: 'F'
  }),
  command({
    id: 'verdicts.toggle-layout',
    title: 'Show verdicts one at a time or all at once',
    shortTitle: 'One or all',
    section: 'Verdicts',
    defaultBinding: 'Alt+V'
  }),

  command({
    id: 'review.quote',
    title: 'Quote the selected text',
    shortTitle: 'Quote',
    section: 'Review',
    defaultBinding: 'Q',
    alternateBindings: ['Mod+Shift+C'],
    hintContexts: ['review']
  }),
  command({
    id: 'review.mark-section',
    title: 'Mark this section needs work',
    shortTitle: 'Mark section',
    section: 'Review',
    defaultBinding: 'M',
    hintContexts: ['review']
  }),
  command({
    id: 'review.jump-comment',
    title: 'Jump to a comment by number',
    shortTitle: 'Comments',
    section: 'Review',
    defaultBinding: '1–9',
    hintContexts: ['review']
  }),
  command({
    id: 'review.toggle-ledger',
    title: 'Open or close the ledger',
    shortTitle: 'Ledger',
    section: 'Review',
    defaultBinding: 'L',
    hintContexts: ['review']
  }),
  command({
    id: 'review.compare-decision',
    title: 'Compare the pictures of the current decision',
    shortTitle: 'Compare',
    section: 'Review',
    defaultBinding: 'Alt+C'
  }),
  command({
    id: 'review.picture-previous',
    title: 'Previous picture of this decision',
    section: 'Review',
    defaultBinding: 'ArrowLeft'
  }),
  command({
    id: 'review.picture-next',
    title: 'Next picture of this decision',
    section: 'Review',
    defaultBinding: 'ArrowRight'
  }),
  // Ticket 30: marking up a picture in the window-sized mark-up view.
  command({
    id: 'markup.open',
    title: 'Mark up this picture',
    shortTitle: 'Mark up',
    section: 'Mark up',
    defaultBinding: 'M'
  }),
  command({
    id: 'markup.tool-arrow',
    title: 'Arrow: press on the point, drag to the tail',
    shortTitle: 'Arrow',
    section: 'Mark up',
    defaultBinding: 'A'
  }),
  command({
    id: 'markup.tool-box',
    title: 'Rectangle: drag a rounded rectangle',
    shortTitle: 'Rectangle',
    section: 'Mark up',
    defaultBinding: 'R'
  }),
  command({
    id: 'markup.tool-text',
    title: 'Text: place a text label',
    shortTitle: 'Text',
    section: 'Mark up',
    defaultBinding: 'T'
  }),
  command({
    id: 'markup.undo',
    title: 'Undo the last mark change',
    shortTitle: 'Undo',
    section: 'Mark up',
    defaultBinding: 'Mod+Z',
    allowInText: 'modified'
  }),
  command({
    id: 'markup.delete',
    title: 'Remove the selected mark',
    shortTitle: 'Remove',
    section: 'Mark up',
    defaultBinding: 'Backspace',
    alternateBindings: ['Delete']
  }),
  command({
    id: 'markup.toggle-notes',
    title: 'Words on the picture or in a list',
    shortTitle: 'List',
    section: 'Mark up',
    defaultBinding: 'L'
  }),
  command({
    id: 'markup.label-done',
    title: 'Keep the label being typed',
    section: 'Mark up',
    defaultBinding: 'Enter',
    allowInText: 'always'
  }),
  command({
    id: 'markup.done',
    title: 'Done: save the marked-up picture',
    shortTitle: 'Done',
    section: 'Mark up',
    defaultBinding: 'Mod+Enter',
    allowInText: 'modified'
  }),
  command({
    id: 'review.approve',
    title: 'Approve',
    shortTitle: 'Approve',
    section: 'Review',
    defaultBinding: 'P',
    hintContexts: ['review']
  }),
  command({
    id: 'review.approve-changes',
    title: 'Approve with changes',
    shortTitle: 'With changes',
    section: 'Review',
    defaultBinding: 'N',
    hintContexts: ['review']
  }),
  command({
    id: 'review.needs-rework',
    title: 'Needs rework',
    shortTitle: 'Rework',
    section: 'Review',
    defaultBinding: 'F',
    hintContexts: ['review']
  }),
  command({
    id: 'review.not-reviewed',
    title: 'Not reviewed',
    shortTitle: 'Not reviewed',
    section: 'Review',
    defaultBinding: 'S',
    hintContexts: ['review']
  }),
  command({
    id: 'review.finish',
    title: 'Finish the review',
    shortTitle: 'Finish',
    section: 'Review',
    defaultBinding: 'Shift+F',
    alternateBindings: ['Mod+Enter'],
    hintContexts: ['review']
  }),
  command({
    id: 'review.reopen',
    title: 'Reopen the review',
    section: 'Review',
    defaultBinding: 'Shift+R',
    contextual: true
  }),
  command({
    id: 'review.finish-confirm',
    title: 'Confirm finishing the review',
    section: 'Review',
    defaultBinding: 'Enter'
  }),
  command({
    id: 'note.hand-over',
    title: 'Hand over',
    shortTitle: 'Hand over',
    section: 'Note',
    defaultBinding: 'Shift+H',
    hintContexts: ['note']
  }),
  command({
    id: 'note.reopen',
    title: 'Reopen the note',
    section: 'Note',
    defaultBinding: 'Shift+R'
  }),
  command({
    id: 'note.link-run',
    title: 'Link a run',
    shortTitle: 'Link run',
    section: 'Note',
    defaultBinding: 'R',
    hintContexts: ['note']
  }),
  command({
    id: 'note.remove-link',
    title: 'Remove the linked run',
    section: 'Note',
    defaultBinding: 'Shift+Backspace'
  }),
  command({
    id: 'note.paste-screenshot',
    title: 'Paste a screenshot',
    shortTitle: 'Screenshot',
    section: 'Note',
    defaultBinding: 'Mod+V',
    hintContexts: ['note']
  }),
  command({
    id: 'note.retry-save',
    title: 'Retry saving the note',
    section: 'Note',
    defaultBinding: 'Mod+Shift+R'
  }),

  command({
    id: 'handoff.copy',
    title: 'Copy the selected prompt',
    shortTitle: 'Copy',
    section: 'Handoffs',
    defaultBinding: 'C',
    hintContexts: ['handoffs']
  }),
  command({
    id: 'handoff.archive',
    title: 'Archive the selected handoff',
    shortTitle: 'Archive',
    section: 'Handoffs',
    defaultBinding: 'A',
    contextual: true,
    hintContexts: ['handoffs']
  }),
  command({
    id: 'handoff.reveal',
    title: 'Show the selected handoff file',
    shortTitle: 'Show file',
    section: 'Handoffs',
    defaultBinding: 'Mod+O',
    contextual: true,
    hintContexts: ['handoffs']
  }),
  command({
    id: 'handoff.filter-all',
    title: 'Show all handoffs',
    section: 'Handoffs',
    defaultBinding: 'Alt+1'
  }),
  command({
    id: 'handoff.filter-ready',
    title: 'Show handoffs ready for an agent',
    section: 'Handoffs',
    defaultBinding: 'Alt+2'
  }),
  command({
    id: 'handoff.filter-waiting',
    title: 'Show handoffs waiting on you',
    section: 'Handoffs',
    defaultBinding: 'Alt+3'
  }),
  command({
    id: 'handoff.filter-superseded',
    title: 'Show superseded handoffs',
    section: 'Handoffs',
    defaultBinding: 'Alt+4'
  }),
  command({
    id: 'handoff.toggle-grouping',
    title: 'Group handoffs by project or list newest first',
    section: 'Handoffs',
    defaultBinding: 'Alt+G'
  }),
  command({
    id: 'handoff.filter-project',
    title: 'Filter handoffs by project',
    section: 'Handoffs',
    defaultBinding: 'Alt+5'
  }),

  command({
    id: 'settings.change-folder',
    title: 'Change the record folder',
    section: 'Settings',
    defaultBinding: 'Mod+Shift+O'
  }),
  command({
    id: 'settings.text-size-normal',
    title: 'Use normal request text',
    section: 'Settings',
    defaultBinding: 'Alt+1'
  }),
  command({
    id: 'settings.text-size-large',
    title: 'Use large request text',
    section: 'Settings',
    defaultBinding: 'Alt+2'
  }),
  command({
    id: 'settings.text-size-extra-large',
    title: 'Use extra-large request text',
    section: 'Settings',
    defaultBinding: 'Alt+3'
  }),
  command({
    id: 'settings.pin-remember',
    title: 'Remember the last pin state',
    section: 'Settings',
    defaultBinding: 'Alt+4'
  }),
  command({
    id: 'settings.pin-always',
    title: 'Always start pinned',
    section: 'Settings',
    defaultBinding: 'Alt+5'
  }),
  command({
    id: 'settings.toggle-dock-badge',
    title: 'Toggle the Dock badge',
    section: 'Settings',
    defaultBinding: 'Alt+6'
  }),
  command({
    id: 'settings.width-narrow',
    title: 'Use the narrow window',
    section: 'Settings',
    defaultBinding: 'Alt+7'
  }),
  command({
    id: 'settings.width-wide',
    title: 'Use the wide window',
    section: 'Settings',
    defaultBinding: 'Alt+8'
  }),
  command({
    id: 'settings.window-free',
    title: 'Float the window freely',
    section: 'Settings',
    defaultBinding: 'Ctrl+1'
  }),
  command({
    id: 'settings.window-docked',
    title: 'Keep the window docked at its edge',
    section: 'Settings',
    defaultBinding: 'Ctrl+2'
  }),
  command({
    id: 'settings.open-keymap-palette',
    title: 'Open the palette to change shortcuts',
    section: 'Settings',
    defaultBinding: 'Mod+Shift+,'
  }),

  command({
    id: 'window.toggle-pin',
    title: 'Pin beside the app under test',
    section: 'Window',
    defaultBinding: 'Mod+Alt+P'
  }),
  command({
    id: 'window.toggle-width',
    title: 'Toggle narrow or wide window',
    section: 'Window',
    defaultBinding: 'Alt+W'
  }),
  // Ticket 27: the Dock split button. Pin is whether it stays on top; Dock is
  // where it goes. The main part keeps Alt+D, the chord the old dock toggle had;
  // the menu of four places takes the same key with ⇧ (the bigger version).
  command({
    id: 'window.dock',
    title: 'Dock as the sidebar at the last place',
    shortTitle: 'Dock',
    section: 'Window',
    defaultBinding: 'Alt+D'
  }),
  command({
    id: 'window.choose-dock-place',
    title: 'Choose where to dock the sidebar',
    shortTitle: 'Dock where',
    section: 'Window',
    defaultBinding: 'Alt+Shift+D'
  }),
  command({
    id: 'window.reset-position',
    title: 'Reset window position',
    section: 'Window',
    defaultBinding: 'Ctrl+Alt+R'
  }),
  command({
    id: 'file.reveal-selection',
    title: 'Reveal the selected file in Finder',
    section: 'Window',
    defaultBinding: 'Mod+Alt+O',
    contextual: true
  }),
  command({
    id: 'file.copy-path',
    title: 'Copy the selected file path',
    section: 'Window',
    defaultBinding: 'Mod+Alt+C',
    contextual: true
  }),

  command({
    id: 'onboarding.accept-default',
    title: 'Use the default record folder',
    section: 'Settings',
    defaultBinding: 'Enter'
  }),
  command({
    id: 'onboarding.choose-folder',
    title: 'Choose another record folder',
    section: 'Settings',
    defaultBinding: 'Mod+Shift+O'
  })
] as const satisfies readonly CommandDefinition[]

export type CommandId = (typeof COMMANDS)[number]['id']

export const RESERVED_COMMANDS = {
  'app.command-palette': 'Mod+Shift+P',
  'app.navigation-switcher': 'Mod+Shift+K',
  'app.contextual-actions': 'Mod+K',
  'app.inspector': 'Mod+P',
  'app.find-document': 'Mod+F',
  'app.search-everything': 'Mod+Shift+F',
  'app.settings': 'Mod+,',
  'app.cheat-sheet': 'Mod+/'
} as const satisfies Partial<Record<CommandId, string>>

export type SurfaceCommandScope =
  | 'dashboard'
  | 'inbox'
  | 'specs'
  | 'releases'
  | 'release-shipping'
  | 'roadmap'
  | 'requests'
  | 'handoffs'
  | 'verdict-list'
  | 'markup'

const RESERVED_IDS = Object.keys(RESERVED_COMMANDS) as CommandId[]

const GLOBAL_COMMAND_IDS: readonly CommandId[] = [
  ...RESERVED_IDS,
  'app.new-window',
  'reading.text-size-increase',
  'reading.text-size-decrease',
  'reading.text-size-reset',
  'app.close-back',
  'window.toggle-pin',
  'window.toggle-width',
  'window.dock',
  'window.choose-dock-place',
  'window.reset-position',
  'file.reveal-selection',
  'file.copy-path',
  'nav.dashboard',
  'nav.get-started',
  'nav.inbox',
  'nav.specs',
  'nav.releases',
  'nav.roadmap',
  'nav.handoffs',
  'nav.requests',
  'nav.project-home',
  'nav.copy-project-link',
  'nav.all-projects'
]

/** Commands that can be enabled together on the six surfaces and their modal states. */
export const SURFACE_COMMANDS: Record<SurfaceCommandScope, readonly CommandId[]> = {
  dashboard: [
    ...GLOBAL_COMMAND_IDS,
    'nav.move-down',
    'nav.move-up',
    'nav.open-selection',
    'nav.new-note',
    'nav.toggle-waiting-layout'
  ],
  inbox: [
    ...GLOBAL_COMMAND_IDS,
    'nav.move-down',
    'nav.move-up',
    'nav.open-selection',
    'nav.open-project',
    'nav.archive-selection',
    'nav.unarchive-selection',
    'nav.toggle-archived',
    'nav.new-note'
  ],
  specs: [
    ...GLOBAL_COMMAND_IDS,
    'nav.move-down',
    'nav.move-up',
    'nav.open-selection',
    'specs.documents',
    'specs.questions',
    'specs.answer-question',
    'specs.read-section',
    'specs.next-question',
    'specs.filter-open',
    'specs.filter-answered',
    'specs.filter-all',
    'specs.questions-unanswered',
    'specs.questions-answered',
    'review.quote',
    'review.finish'
  ],
  releases: [
    ...GLOBAL_COMMAND_IDS,
    'nav.move-down',
    'nav.move-up',
    'release.answer-works',
    'release.flag-feature',
    'release.toggle-how-to',
    'release.open-app',
    'release.version-previous',
    'release.version-next',
    'release.give-notes',
    'release.ship',
    'release.scope-in-flight',
    'release.scope-shipped',
    'release.filter-everything',
    'release.filter-you',
    'release.filter-building',
    'release.filter-not-started'
  ],
  'release-shipping': [
    ...GLOBAL_COMMAND_IDS,
    'release.ship-own',
    'release.ship-fixes',
    'release.ship-confirm'
  ],
  roadmap: [
    ...GLOBAL_COMMAND_IDS,
    'nav.move-down',
    'nav.move-up',
    'roadmap.project-previous',
    'roadmap.project-next',
    'roadmap.toggle-with-ideas-group',
    'roadmap.toggle-nothing-in-pool-group',
    'roadmap.move-up',
    'roadmap.move-down',
    'roadmap.move-left',
    'roadmap.move-right',
    'roadmap.edit-idea',
    'roadmap.promote',
    'roadmap.set-aside',
    'roadmap.put-back',
    'roadmap.confirm-action',
    'roadmap.filter-pool',
    'roadmap.filter-set-aside',
    'roadmap.filter-promoted',
    'roadmap.toggle-functionality',
    'roadmap.toggle-quality-of-life',
    'roadmap.toggle-delight',
    'roadmap.choose-sheet-option',
    'roadmap.sort-lane',
    'roadmap.add-idea',
    'roadmap.toggle-layout',
    'roadmap.move-to'
  ],
  requests: [
    ...GLOBAL_COMMAND_IDS,
    'nav.move-down',
    'nav.move-up',
    'nav.open-selection',
    'requests.toggle-finished',
    'requests.show-no-plan',
    'requests.review-all'
  ],
  handoffs: [
    ...GLOBAL_COMMAND_IDS,
    'nav.move-down',
    'nav.move-up',
    'nav.open-selection',
    'handoff.copy',
    'handoff.archive',
    'handoff.reveal',
    'handoff.filter-all',
    'handoff.filter-ready',
    'handoff.filter-waiting',
    'handoff.filter-superseded',
    'handoff.toggle-grouping',
    'handoff.filter-project'
  ],
  // Ticket 27: the verdict sheet's All at once list, over the Project Dash.
  'verdict-list': [
    ...GLOBAL_COMMAND_IDS,
    'nav.move-down',
    'nav.move-up',
    'verdicts.works',
    'verdicts.off',
    'verdicts.toggle-layout'
  ],
  // Ticket 30: the mark-up view, over a run or a review.
  markup: [
    ...GLOBAL_COMMAND_IDS,
    'markup.tool-arrow',
    'markup.tool-box',
    'markup.tool-text',
    'markup.undo',
    'markup.delete',
    'markup.toggle-notes',
    'markup.label-done',
    'markup.done'
  ]
}

const COMMAND_BY_ID = new Map(COMMANDS.map((entry) => [entry.id, entry]))

export function commandById(id: CommandId): CommandDefinition {
  const found = COMMAND_BY_ID.get(id)
  if (!found) throw new Error(`Unknown command: ${id}`)
  return found
}

export function availableCommands(runtime: CommandRuntime): CommandDefinition[] {
  return COMMANDS.filter((entry) => entry.when(runtime))
}

export function runCommand(id: CommandId, runtime: CommandRuntime, event?: KeyboardEvent): boolean {
  const entry = COMMAND_BY_ID.get(id)
  if (!entry || !entry.when(runtime)) return false
  entry.handler(runtime, event)
  return true
}

export function commandsBySection(commands: readonly CommandDefinition[] = COMMANDS): Array<{
  section: CommandSection
  commands: CommandDefinition[]
}> {
  const groups = new Map<CommandSection, CommandDefinition[]>()
  for (const entry of commands) {
    const rows = groups.get(entry.section) ?? []
    rows.push(entry)
    groups.set(entry.section, rows)
  }
  return [...groups].map(([section, rows]) => ({ section, commands: rows }))
}
