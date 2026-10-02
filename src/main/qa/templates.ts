// Bundled string templates for the records-folder contract files.
// Authored per ADR-0001 (layout + file contract), ADR-0003 (artefact types +
// handshake) and ADR-0007 (document review). Register: telegraph, agent-facing.
// British spelling.

// Bump on every content change to ROOT_AGENTS_MD — bootstrap refreshes the
// live AGENTS.md in the records folder whenever the bundled template is newer than the file's
// marker (an unmarked file is v1, the pre-marker generation).
export const ROOT_TEMPLATE_VERSION = 23

/** The version a live contract file carries; unmarked files predate markers. */
export function templateVersion(content: string): number {
  const m = content.match(/<!--\s*dev-traffic-control template v(\d+)/)
  return m ? Number(m[1]) : 1
}

export const ROOT_AGENTS_MD = `# Test-Feedback Contract

<!-- dev-traffic-control template v${ROOT_TEMPLATE_VERSION} — app-owned; Dev Traffic Control refreshes this file when its bundled template is newer -->

The records folder. Dev Traffic Control watches this one directory; agents write requests here; the app writes results beside them. Dev Traffic Control never commits. If this folder is a git repository, the app runs \`git pull --ff-only\` in it only when the reviewer presses the pull button on a link whose record has not arrived, and it keeps a \`.gitignore\` here for its own temporary files. Committing this folder is done outside the app.

## Ownership split (hard rule)

- Agents WRITE requests (\`.md\`), **release records** (\`releases/<version>.md\`), **roadmap idea files** (\`roadmap/<id>.md\`), **handoff documents** (\`handoffs/*-handoff.md\`), **thread entries** (\`*-entry-*.md\`), **resolution markers** (\`*.resolved.md\`), watch claims (\`*.watch.json\`) and collection receipts (\`*.collected.json\`), and READ reports, release answers, roadmap order, handoff state sidecars and notes. Agents NEVER write app-owned \`.report.json\`, \`.answers.json\`, \`.state.json\`, \`roadmap/order.json\` or note files.
- Watch claims and collection receipts are agent-owned. The app reads them only and never creates, modifies or deletes them. A watch claim is \`{ agent, machine, startedAt, heartbeatAt }\`; it is live only when \`heartbeatAt\` is no more than 90 seconds old and \`machine\` equals this Mac's hostname. A collection receipt is \`{ agent, machine, collectedAt, note }\` and records that the finished report was read and acted on.
- The app WRITES reports (\`.report.json\`), release answers (\`releases/<version>.answers.json\`), roadmap idea files (\`roadmap/<id>.md\`), roadmap order (\`roadmap/order.json\`), handoff state sidecars (\`handoffs/*-handoff.state.json\`), notes (\`YYYY-MM-DD-note-<slug>.md\`; never put \`-note-\` in any other record's name) and shots. The app NEVER edits a request, a release record, a handoff document, an entry, a resolution marker, a watch claim or a collection receipt.
- Requests are immutable once written — the record of what was asked. Re-testing overwrites the report, not the request. No \`-2\` file copies; git history is the versioning.
- **Release records are the deliberate exception:** a release record is a living ledger, edited in place as its features move. Git history preserves earlier versions of that ledger.
- **Pool idea files are the second deliberate living-ledger exception:** agents and the app both edit them in place. The reviewer moves ideas between lanes and edits them from the app, and a file nobody may write cannot support that. Git history preserves earlier versions of that ledger; the app writes atomically and preserves every frontmatter key it does not own.
- **Entries are append-only**: nobody rewrites an entry, including its author. A thread evolves by adding entries, never editing them.

## Layout

\`\`\`
records-folder/
  AGENTS.md                      # this contract (+ CLAUDE.md sidecar)
  <project>/                     # slug = product repo name; folder existence = project creation
    AGENTS.md                    # short pointer (+ CLAUDE.md sidecar)
    <round>/                     # OPTIONAL free-named grouping, one level only
      YYYY-MM-DD-<slug>[-version].md            # request (immutable, agent-written)
      YYYY-MM-DD-<slug>[-version].report.json   # report sidecar (app-written)
      YYYY-MM-DD-<slug>[-version].shots/        # real PNGs
      YYYY-MM-DD-<slug>[-version].resolved.md   # resolution marker (agent-written; closes a request)
      YYYY-MM-DD-note-<slug>.md                 # note (+ its own .shots/, app-written)
    releases/                    # reserved; release ledgers, never a round
      <version>.md                              # living release record (agent-written)
      <version>.answers.json                    # the reviewer's answers (app-written)
      <version>.shots/                          # pictures on the reviewer's verdicts (app-written)
    roadmap/                     # reserved; feature pool, never a round
      <id>.md                                    # one idea (agent- and app-written)
      order.json                                 # the reviewer's order and state (app-written)
    handoffs/                    # reserved; stopped threads ready to continue, never a round
      YYYY-MM-DD-<slug>-handoff.md              # handoff document (agent-written)
      YYYY-MM-DD-<slug>-handoff.state.json      # picked-up/archive state (app-written)
    threads/                     # thread entries for this project (agent-written)
      YYYY-MM-DD-HHMM-entry-<slug>.md           # one immutable entry (append-only)
  _unfiled/                      # entries with no project yet — legitimate, not a backlog to clear
    handoffs/                    # stopped threads with no product repo
      YYYY-MM-DD-<slug>-handoff.md
      YYYY-MM-DD-<slug>-handoff.state.json
    threads/
      YYYY-MM-DD-HHMM-entry-<slug>.md
\`\`\`

- Project = first-level dir, slug matching the product repo. No registry.
- Round = optional second-level dir, any name (wave, milestone, sprint). One level only — never nest deeper.
- Root-level files (no round folder) are legal. All artefacts of one run share a basename.
- \`releases/\`, \`roadmap/\`, \`handoffs/\` and \`threads/\` are reserved project folders, never rounds. \`_unfiled/\` is a reserved slug (scanned, but never a "project").

## Release records — living ledgers

\`<project>/releases/<version>.md\` records the app, release and features currently in flight. Frontmatter requires \`app\`, \`release\` and repo-relative \`repo\`; optional \`handoff\` points to a handoff path relative to the project folder, and optional \`updated\` records the last change.

Each \`## heading\` is one reviewer-facing feature. Pin its identity with \`{#id}\` when wording may change; otherwise the heading slug is the id. Leading \`key: value\` lines are fields until the first non-key line; unknown keys are ignored. The only bold label is \`**How to check**\`, followed by the check text.

- Declared \`state:\` is exactly \`notstarted | building | built | you\`.
- Optional \`since: YYYY-MM-DD\` is the day the feature reached its current \`state:\`. Set it whenever you change \`state:\`; the app shows it after the state on every release row. When the reviewer's answer is newer than \`since:\`, the row shows the answer's \`at\` instead, because the answer changed the state; with neither, the row shows no date.
- \`done\` is never declared. It is derived only when the answers sidecar carries \`verdict: works\` for that feature id.
- \`kind: groundwork\` has no state and cannot be answered; use \`unlocks:\` to name what it enables.
- Edit the release record in place as the release moves. This living-ledger rule does not relax request immutability.

### Release-record example — \`releases/0.11.0.md\`

\`\`\`markdown
---
app: Example App
release: 0.11.0
repo: example-app
handoff: handoffs/2026-01-14-example-app-handoff.md
updated: 2026-01-15
---

## Export a draft as a PDF {#export-pdf}
state: you
since: 2026-01-15
A draft can be exported as a PDF file.

**How to check**
Open a draft and choose Export as PDF.

## Export settings storage
kind: groundwork
unlocks: The PDF export and later export formats.
\`\`\`

The app writes \`releases/0.11.0.answers.json\`, never the Markdown ledger. The sidecar carries \`app\`, \`release\` and \`answers[]\`; each answer carries \`id\`, \`verdict: works | off\`, \`comment\` and \`at\`, and \`screenshots\` when the reviewer attached pictures to the verdict: paths relative to the project folder, \`releases/<version>.shots/<feature-id>-<n>.png\`, real PNGs on disk. An answer without pictures has no \`screenshots\` field. When collecting a verdict, open every picture its \`screenshots\` names — they are part of what the reviewer said. Absent id means unanswered. \`removed: true\` preserves an answer after its feature heading is removed.

## Roadmap pool

\`<project>/roadmap/\` is the feature pool. **Idea files are a living ledger shared by agents and the app; \`order.json\` is app-owned.** Agents and the app create and edit \`<id>.md\`; agents never write \`order.json\`. The app owns only \`tier\`, \`title\` and the body in an idea file and preserves every other frontmatter key byte-for-byte. Position and state stay in \`order.json\`.

Each idea file is Markdown with frontmatter. \`id\` is stable, kebab-case, unique in the project and equal to the filename. \`tier\` is exactly \`functionality | quality-of-life | delight\`. \`candidate\` is optional and records an agent's suggested release.

\`\`\`markdown
---
id: three-tabs
title: Specs, Releases and Roadmap become their own tabs
tier: functionality
added: 2026-08-06
candidate: 0.15.0
---

Prose explaining the idea.
\`\`\`

The app-owned \`order.json\` has this shape:

\`\`\`json
{
  "positions": { "three-tabs": 1, "release-notes": 2 },
  "states": {
    "chat-panel": {
      "state": "setaside",
      "reason": "Wrong app for it.",
      "at": "2026-07-28T09:00:00.000Z"
    },
    "three-tabs": {
      "state": "promoted",
      "release": "0.15.0",
      "at": "2026-08-07T00:00:00.000Z"
    }
  },
  "returned": {
    "html-export": {
      "title": "Send a draft as an HTML document someone can read",
      "tier": "functionality",
      "from": "0.19.6",
      "at": "2026-08-07T06:00:00.000Z"
    }
  },
  "seenAt": "2026-08-06T22:00:00.000Z"
}
\`\`\`

An idea absent from \`states\` is in the pool. An in-pool state entry may carry \`release\` without a \`state\`; \`state\` is present only for \`promoted\` or \`setaside\`. An idea absent from \`positions\` follows positioned ideas in its tier, ordered by \`added\` then id. A missing or malformed \`order.json\` means every idea stays in the pool in that default order. The app records an unfinished shipped feature in \`returned\` when no agent-owned idea file exists; it appears in its lane with no body, marked \`returned from <version>\`. A later \`<id>.md\` remains agent-owned and wins for every field it declares, without creating a second row. The resolved candidate release is \`states[id].release\`, then the idea's optional \`candidate\`, then unassigned; the reviewer's app-owned view therefore wins.

### Feature requests

A **feature request** is a roadmap idea the reviewer said, filed with extra optional frontmatter. It is the same file: Roadmap keeps working on it, and an idea without these keys loads as before. **Whenever you see a suggestion from the reviewer — in a review, a check, a thread or chat — file it at once** (create \`<id>.md\`, or add the keys to the idea that already exists) so the reviewer can find it and see what became of it. The app lists every idea with \`by: reviewer\` in its **Feature requests** tab.

\`\`\`markdown
---
id: export-keeps-filters
title: Export keeps the active filters
tier: functionality
added: 2026-01-15
by: reviewer
said:
  where: a test request (preview.2)
  when: 2026-01-15
  link: dtc://open/example-app/2026-01-15-example-app-0.4.0-preview.2-check
quote: "the export ignores my filters - I get every row, not the ones on screen"
context: Exporting a filtered list wrote every row instead of the visible ones.
plan: Apply the active filters when exporting.
fate: building
fate_note: in 0.4.0-preview.3
related: [ticket-12, release-0.4.0, review-2026-01-15-sign-in-journeys]
candidate: 0.4.0
---

Free-text body: the longer story, written for the agent.
\`\`\`

- \`by\`: \`reviewer\` (the reviewer said it; older records may say \`by: dominik\`, read it as \`reviewer\`) or \`agent\` (the agent proposed it). Only \`by: reviewer\` ideas are feature requests.
- \`said\`: \`where\`, \`when\` and \`link\` of where the reviewer said it. \`quote\`: the reviewer's exact words. For more than one quote, write both as lists, in the same order.
- \`context\`: your summary of the whole point, across every place it was said. \`plan\`: your next step. \`candidate\`: the release it is aimed at.
- \`fate\`: exactly one of \`waiting | planned | building | built | merged | declined\`. \`waiting\` means it needs the reviewer's pick; the app then lists it in Waiting on you with buttons. **Keep \`fate\` current**: when work lands, a plan changes or a release moves, edit it in the same turn. A request with no \`plan\` or no \`fate\` shows as "No plan yet" and counts as owed by you. An unknown \`fate\` value is read as no fate.
- \`fate_note\`: which release it is in, what it merged into, or why it was declined. \`related\`: record ids or \`dtc://\` links (a request file name, \`release-<version>\`, another idea's id); the app shows each as a chip with its state.
- **Approval and the Roadmap.** The **Roadmap** tab shows approved ideas grouped by release. An idea is approved when its \`fate\` is \`planned\` or \`building\`, or when it has no \`by: reviewer\` (an idea an agent proposed). A \`by: reviewer\` idea with \`fate: waiting\` stays in Feature requests until the reviewer presses **Approve → Roadmap**. That press writes \`fate: planned\` and \`candidate: <pending version>\` into the idea's frontmatter and appends a \`## Reviewer entry · <date> · Approved for the roadmap\` section; moving a card between releases rewrites \`candidate\` (Unscheduled removes the line). The app owns exactly those two keys on the pool idea file and edits nothing else in the frontmatter.
- **The pending version is derived, never written.** It is the next minor after the highest \`releases/<version>.md\` record (0.22.0 in flight gives 0.23.0). **Never create \`releases/<next>.md\` while an earlier release is in flight**: the app shows only the highest release record as in flight, so plan later releases as \`candidate:\` on ideas. A candidate whose release already has a record is read as in Releases, not on the Roadmap.
- **When a release ships, you mark it shipped.** Do it in the release's own record, if the reviewer has not already shipped it from the app: write \`releases/<version>.shipped.json\` with \`app\`, \`release\`, \`notes\`, \`shippedAt\` (ISO time) and \`returnedFeatureIds\` (\`[]\` when every feature is built), the same shape the app writes. A release record with that file is shipped, and the Roadmap then derives the next pending version. The next pending version then appears by itself, empty.
- **Two prompts hand work to you.** The reviewer can copy them from Feature requests. (1) *Ask an agent to plan this*: open the idea file named in the prompt, fill in \`context\`, \`plan\`, \`fate\` and \`related\` per this section, and reply with the \`dtc://\` link. (2) *Review all requests*: go through every \`by: reviewer\` idea in the project (or every project), give each a \`plan\` and \`fate\`, propose priorities and releases as \`candidate\`, and file a doc-review for the reviewer's approval of the proposed order. Do not set \`fate: planned\` on a \`waiting\` request yourself: approval is the reviewer's yes.
- The reviewer's answers from the card are appended to the idea's body as \`## Reviewer entry · <date> · <answer>\` sections, with the reviewer's words under the heading. **Read them.** Answer with a \`## Agent entry · <date>\` section and update \`fate\` and \`plan\`. A \`waiting\` request whose last entry is the reviewer's stays out of Waiting on you until you add yours.

## Handoffs

\`<project>/handoffs/YYYY-MM-DD-<slug>-handoff.md\` records a stopped thread an agent can continue. Use \`_unfiled/handoffs/\` when the thread has no product repo. The project is the containing folder name; do not repeat it in frontmatter. Skip \`README.md\`, \`AGENTS.md\` and \`CLAUDE.md\`.

Frontmatter fields are \`title\`, \`domain\`, repo-relative \`repo\`, \`move: agent | me\`, \`state: live | superseded | done\`, \`updated\` and one-line \`resume\`. \`title\` and \`repo\` are near-required; omitted fields degrade honestly. \`domain\` is routing context only. A missing title falls back to the first H1, then the filename; a missing date falls back to file mtime. Never guess \`move\`, \`state\` or \`resume\`.

The app writes \`<basename>.state.json\` beside the handoff as \`{ "pickedUpAt": string|null, "archivedAt": string|null }\`. Agents may read this sidecar and must never write it. The app never edits the handoff document. Delete the sidecar to resurrect a handoff; the document itself is never deleted.

### Handoff example — \`handoffs/2026-01-15-export-feature-handoff.md\`

\`\`\`markdown
---
title: Example App 0.11.0 export feature is next
domain: utilities
repo: example-app
move: agent
state: live
updated: 2026-01-15
resume: Build the export feature from the release record.
---

# Example App 0.11.0 export feature is next

Read the release-record specification before continuing.
\`\`\`

## Hand the reviewer a link, never a sentence (hard rule)

Filing a request is half the job. Announcing it in prose is how it gets missed. **End the message with a link to the record you just wrote.**

Grammar — the path IS the address, so build it from the file you just wrote. No lookup, no id:

\`\`\`
dtc://open/<project>/<path within the project>
dtc://open/example-app/2026-01-15-action-bar.md
dtc://open/example-app/releases/0.21.0.md#action-bar
dtc://project/example-app
\`\`\`

**Emit it as a markdown link, never as a bare URL and never inside a code fence.** A terminal only makes a URL clickable when it recognises the scheme, and \`dtc://\` is not one it knows — so a bare \`dtc://…\` is dead text. A markdown link becomes a terminal hyperlink, which carries any scheme, and the clickable region is the label:

\`\`\`
[Open the request in Dev Traffic Control](dtc://open/example-app/2026-01-15-action-bar.md)
\`\`\`

A link opens a **new window** when the app is running, so it never disturbs what the reviewer already has open; if the app is closed it starts up on the record. A link never writes anything.

## Request format — LIGHT BY DEFAULT (a hard contract, not a style note)

The reviewer is **not a QA worker**. The reviewer wants a quick look — does the key thing work, yes or no — and then a good decision. A long request is worse than none: the reviewer abandons it partway and answers in chat, and it cost the reviewer attention for nothing. These caps bind **every** request unless the reviewer **explicitly** asks for a detailed pass:

- **≤ 4 checks. ≤ 3 things to look at per check.** More than four and the reviewer will not do it — the whole point is lost. If you have more, you are testing too much: keep the four that matter, park the rest.
- **One flat list. NO \`**Steps**\` / \`**Expected**\` split.** Each \`## heading\` item is ONE line — what it is and how to see it, together. Never make the reviewer read a procedure and then a separate checklist for the same thing.
- **Only KEY, user-facing features** — the thing you just built. Does it work?
- **State incidental facts; never test them.** A version number, "it launched", a log line — put it in \`intro\` ("you should be on v0.9.1; if not, tell me"), never as a check. Anything you can assert in code or a test, assert it yourself — do not spend the reviewer's attention on it.

Frontmatter: \`id\`, \`app\`, \`version\`, \`build\`, \`date\`, \`intro\`; optional \`gate\`, \`kind\`. \`## heading\` = one item; \`{#id}\` pins a stable id across regeneration; a parse failure degrades to plain text, never an error.

Rendering mode: optional frontmatter \`mode\`: \`light\` = single-screen light surface · \`detailed\` = item-per-card Runner, only when the reviewer asks for a thorough pass. Omit \`mode\` and the request shape decides.

### Park the rest — \`## Also worth checking\`

Edge cases, hidden behaviours, regressions, the incidentals — everything that is not a key feature — go in a final \`## Also worth checking\` section. It is **reference, not a task**: no \`**Steps**\`, and no verdict is ever demanded of the reviewer. It exists so (a) the reviewer can glance and *choose* to poke one, and (b) a later agent, an automated sweep, or a unit test can pick them up. **Prefer writing these as automated tests** over ever asking the reviewer to run them — that is where hidden behaviour belongs.

\`## Also worth checking\` keeps its **reserved name**, and \`Also worth checking\` is a **reserved opening phrase**. The parked heading is recognised loosely, allowing trailing punctuation or a parenthetical. Do not begin any check heading with it. A heading that begins with the phrase but does not match the parked heading is treated as an ordinary check; its generated \`also-\` id will collide with the parked convention. Keep the reserved heading as the **last section**. Parked ids share the document-order id set with checks, so moving this section between regenerations can shift ids and make \`reconcile\` mark a previously answered parked item \`removed\`.

Read-back: each parked bullet gets an \`also-<slug>\` id. It creates no report item unless the reviewer uses **test now**. A report item originating from the parked section means the reviewer chose to poke that parked line; collect its verdict like any other check. The \`also-\` prefix alone does not establish that meaning.

### Worked example — light (the default)

\`\`\`markdown
---
id: round-b-images
title: Images round — paste, SVG, Word, headings
app: Example App
version: 0.9.1
kind: recheck
intro: You should be on v0.9.1. Quick poke at the images round — does each land?
---

## Paste an image into the editor
Copy any picture, **⌘V** into a piece — it appears **inline**, not a broken box.

## Export to Word keeps the picture
Export a piece with an image to **.docx**, open it — the image is there.

## Headings keep their style on paste
Paste a heading from another doc — it stays a **heading**, not body text.

## Also worth checking
- SVG pastes as a picture, not raw markup
- The Export sheet reopens in the folder you last used
- The offered filename is the new piece's own title
\`\`\`

### Carried detail — available, collapsed, never forced

A light check may carry \`**Steps**\` / \`**Expected**\` when you already have them. Dev Traffic Control keeps them collapsed behind \`▸ Steps\`; the reviewer opens them only when useful. For auto-detection, each check body is a single paragraph — soft wrapping is fine, a blank line is not, and no list bullets. \`## Also worth checking\` is matched with trailing punctuation or a parenthetical. Do not begin any check heading with \`Also worth checking\`: a heading that begins with that reserved opening phrase but does not match the parked section is treated as an ordinary check, and its generated \`also-\` id will collide with the parked convention. A light request carrying either label MUST set \`mode: light\` in frontmatter — auto-detection only recognises that pure flat shape. The caps above still bind.

\`\`\`markdown
---
title: Export image recheck
app: Example App
mode: light
---

## Export to Word keeps the picture
Export a piece with an image to **.docx**, open it — the image is there.

**Steps**
- Insert an image, export to **.docx**, then open the file

**Expected**
- The image renders in place, not as a grey box
\`\`\`

### Detailed mode — ONLY when the reviewer explicitly asks for a thorough pass

When (and only when) the reviewer says they want to really test everything, use per-item \`**Steps**\` / \`**Expected**\` / optional \`**Notes**\`. This is the exception, never the default:

\`\`\`markdown
## Title slide 30% sidebar
The layout moved the negative space left.

**Steps**
- Open **Example App** -> document **Sample Project** -> press **⌘P**
- Arrow to the title slide

**Expected**
- Title occupies the **right 70%**, no text clipped
- Sidebar keeps **30% width** at every size
\`\`\`

## Review requests (documents you want read)

A request with \`kind: doc-review\` asks the reviewer to read and comment on a snapshot of an agent-authored document (PRD, ADR, plan, summary) instead of testing items. Name it \`YYYY-MM-DD-review-<slug>.md\` — the \`-review-\` segment mirrors \`-note-\` so folders scan by eye.

- Frontmatter: \`kind: doc-review\` plus provenance — \`source\` (repo-relative path of the living copy in the product repo) and \`commit\` (short SHA at snapshot time). \`title\`, \`app\`, \`date\` as usual.
- **SHORT and reviewer-facing — never the whole PRD/ADR verbatim.** The long document is for you and other agents; it stays at \`source\` (the home copy) as the record. What you snapshot for the reviewer is a **distillation**: open with a **2–4 line summary** — what changed and what you need from the reviewer — then only the sections the reviewer must weigh in on, each tight. The reviewer will skim or skip a wall of text; a PRD the reviewer cannot act on in about a minute is not ready to review. Keep the depth at home, link it, do not paste it.
- **Lead with the decisions.** Everything you need the reviewer to choose goes up top as \`\`\`decision toggles (below). The prose exists to inform those choices, not to be read end to end.
- No \`**Steps**\`/\`**Expected**\` parsing; the document's headings become the reading TOC. Strip any source YAML frontmatter — provenance already points home.
- Immutable like every request: a revised document after rework = a NEW snapshot request, never an edit.
- **Make it visual — a PRD or spec the reviewer cannot picture from prose is not ready to review.** The Reading surface renders: **Markdown tables**; **images** (\`![alt](url)\` — a http/data URL, or a relative path to a file you also place in the folder); and **embedded mockups** — fence a block as \`\`\`html or \`\`\`svg and it renders in a sandboxed frame (static or interactive SVG/HTML both welcome). Include the small visuals that make the text concrete — a table of the options, an SVG of the layout, an HTML snippet of the component. Full production designs are reviewed elsewhere; here, show enough that the reviewer can see what the words mean.
- **Ask for a decision with a toggle, not a paragraph.** When you need a yes/no or a pick among options, fence a \`\`\`decision block: its first line is the question, each \`- option\` line is a clickable button, and the reviewer answers with one click. With no \`-\` lines it defaults to **Approve / Needs change / Reject**. Pin a stable id with \`\`\`decision {#some-id} so the answer survives a re-snapshot. The reviewer's pick lands in the report as structured \`decisions[]\` (id, question, choice, optional comment) — comments stay reserved for real text. Prefer toggles wherever the answer is a choice; it is the single biggest reduction in the reviewer's review effort.

\`\`\`\`
\`\`\`decision {#sidebar-side}
Which side should the sidebar sit on?
- Left
- Right
- Neither — full width
\`\`\`
\`\`\`\`

### Worked example — \`2026-01-15-review-turn-into-text-prd.md\`

\`\`\`markdown
---
title: Turn-into-text PRD review
app: Example App
date: 2026-01-15
kind: doc-review
source: docs/plans/2026-01-15-turn-into-text-PRD.md
commit: 4f2c9ab
---

Spoken beats become presentable slide text in one action.

## Goals {#goals}

- Presenter notes turn into slide-ready lines without leaving the editor

## Open questions

- Which editor surface owns the transform?
\`\`\`

### Review reports (the app writes these — you read them)

Same sidecar \`<basename>.report.json\`, but exactly ONE item: \`id: "document"\`, \`title\` = request title.

- \`items[0].status\` is the document-level disposition, stored as the standard enum: \`pass\` = approved · \`partial\` = approved with changes (the comments are the change list) · \`fail\` = needs rework · \`skip\` = not reviewed.
- \`quotes\`: selection comments — \`{ text, comment, section, number }\`. \`section\` is the slug of the heading the selection falls under; \`number\` is the stable marker id shown in the app (removal never renumbers, ids are never reused).
- \`sectionMarks\`: whole-section needs-work marks — \`[{ section, comment }]\` — for structural problems, distinct from selection comments.
- \`decisions\`: answered \`\`\`decision toggles — \`[{ id, question, choice, comment? }]\`. \`choice\` is the exact option label the reviewer clicked (\`''\` = the reviewer toggled it back off = undecided); \`comment\` is set only if the reviewer added one. Read these as your structured answers — do not hunt for the same yes/no in \`quotes\`.
- A decision answer may also carry \`markups\` (optional; absent when the reviewer marked nothing), a list of pictures the reviewer marked up: \`[{ picture, marked, marks, notes?, option? }]\`. \`picture\` is the original, which is never altered; \`marked\` is a separate PNG in the request's \`.shots/\` folder with the shapes drawn in, and either each mark's label joined to it with no numbers (\`notes: "picture"\`) or numbered pins with the words in a list (\`notes: "list"\`; absent on older records, which have pins). \`marks\` carries the words, so read them without looking at pixels: \`{ n, shape: "box", box: { x, y, w, h }, text }\` · \`{ n, shape: "arrow", from: { x, y }, to: { x, y }, text }\` · \`{ n, shape: "text", at: { x, y }, text }\`. \`n\` is the mark's number (the pin's, in list mode; on the picture the marks carry no numbers); \`text\` is exactly what the reviewer typed (may be empty). Coordinates are fractions of the original picture, 0 to 1 from its top-left. A box is its top-left corner and size; an arrow's \`to\` is the point it aims at and \`from\` its tail, where the pin sits in list mode (on the picture the label sits there). On a decision, \`option\` names the option whose picture it is; an answer can carry marks with \`choice: ''\` if the reviewer marked a picture before picking.
- \`flagged\`/\`expectedIndex\` are meaningless on a review; \`screenshots\` and \`noteFiles\` work unchanged.

## Report format (the app writes these — you read them)

Sidecar \`<basename>.report.json\`, same basename as the request. Shape:

\`\`\`json
{
  "id": "title-padding-01813",
  "title": "Title padding fixes",
  "app": "Example App",
  "version": "0.18.13",
  "build": "…",
  "startedAt": "2026-07-18T12:00:00.000Z",
  "completedAt": "2026-07-18T12:40:00.000Z",
  "noteFiles": ["2026-07-18-note-title-ideas.md"],
  "items": [
    {
      "id": "title-slide-30-sidebar",
      "title": "Title slide 30% sidebar",
      "status": "partial",
      "comment": "Right pane fine; sidebar drifts narrow.",
      "flagged": [
        { "expectedIndex": 1, "text": "Sidebar keeps 30% width at every size", "comment": "Drops to 24% below 900px." }
      ],
      "quotes": [
        { "text": "no text clipped", "comment": "Held at every width I tried." }
      ],
      "screenshots": ["title-padding-0.18.13.shots/title-slide-30-sidebar-1.png"]
    }
  ]
}
\`\`\`

- \`items[].status\`: \`pass | partial | fail | skip | unanswered\`. \`partial\` = works except for flagged expectations. Plain \`pass\` may still carry a comment.
- \`flagged\`: array of \`{ expectedIndex, text, comment }\` — a specific Expected bullet marked as the failing bit, each with its own comment. \`expectedIndex\` is zero-based into that item's Expected list.
- \`quotes\`: array of \`{ text, comment }\` — a text selection the reviewer pulled out, each with its own comment. Separate from the general per-item \`comment\`.
- \`screenshots\`: relative paths into the run's \`.shots/\` folder. Real PNGs on disk, never data URLs.
- \`markups\` on an item (and on a light-run observation): the screenshots the reviewer marked up. \`markups\` (optional; absent when the reviewer marked nothing) is a list of pictures the reviewer marked up: \`[{ picture, marked, marks, notes?, option? }]\`. \`picture\` is the original, which is never altered; \`marked\` is a separate PNG in the request's \`.shots/\` folder with the shapes drawn in, and either each mark's label joined to it with no numbers (\`notes: "picture"\`) or numbered pins with the words in a list (\`notes: "list"\`; absent on older records, which have pins). \`marks\` carries the words, so read them without looking at pixels: \`{ n, shape: "box", box: { x, y, w, h }, text }\` · \`{ n, shape: "arrow", from: { x, y }, to: { x, y }, text }\` · \`{ n, shape: "text", at: { x, y }, text }\`. \`n\` is the mark's number (the pin's, in list mode; on the picture the marks carry no numbers); \`text\` is exactly what the reviewer typed (may be empty). Coordinates are fractions of the original picture, 0 to 1 from its top-left. A box is its top-left corner and size; an arrow's \`to\` is the point it aims at and \`from\` its tail, where the pin sits in list mode (on the picture the label sits there). Here \`picture\` is one of the item's \`screenshots\`.
- \`removed: true\` marks an item that vanished from a regenerated request but kept its earlier answer.

### Light reports

\`mode: "light"\` on a report means the verdict vocabulary was binary:

- \`pass\` = it works.
- \`fail\` = the reviewer flagged it; \`comment\` is the reviewer's one-line note.
- \`unanswered\` = the reviewer did not get to it. It is not a failure.
- \`partial\` and \`skip\` do not occur.

\`screenshots[]\` stays per item, relative into \`<basename>.shots/\`.

\`observations: [{ id, text, screenshots[] }]\` is a LIST of separate run-level notes the reviewer wrote while poking around. **File each one separately** — as a bug, a thread entry (\`<project>/threads/\`), or a backlog item — and say where you filed it in your resolution. Observations may be unrelated to the checks. A collected light report with unfiled observations is not collected.

\`observationSeq\` is the monotonic high-water mark for observation ids. The app increments it when it creates \`obs-<n>\`, and never reuses a removed observation's number or screenshot stem.

\`\`\`json
{
  "id": "round-b-images",
  "title": "Images round — paste, SVG, Word, headings",
  "app": "Example App",
  "version": "0.9.1",
  "startedAt": "2026-07-26T12:00:00.000Z",
  "completedAt": "2026-07-26T12:08:00.000Z",
  "noteFiles": [],
  "mode": "light",
  "observationSeq": 1,
  "items": [
    {
      "id": "paste-an-image-into-the-editor",
      "title": "Paste an image into the editor",
      "status": "pass",
      "comment": "",
      "flagged": [],
      "quotes": [],
      "screenshots": []
    },
    {
      "id": "export-to-word-keeps-the-picture",
      "title": "Export to Word keeps the picture",
      "status": "fail",
      "comment": "The image came through as a grey placeholder.",
      "flagged": [],
      "quotes": [],
      "screenshots": ["round-b-images.shots/export-to-word-keeps-the-picture-1.png"]
    }
  ],
  "observations": [
    {
      "id": "obs-1",
      "text": "The export dialog felt slow to open the first time.",
      "screenshots": []
    }
  ]
}
\`\`\`

## Statuses (derived, never stored)

Read state from the report; the app stores no status field.

- No report file -> **waiting**.
- Report present, no \`completedAt\` -> **in-progress**.
- Report with \`completedAt\` stamped -> **done**.

## Stamped is final (handshake)

Autosave means there is no export moment. Only treat a report as final when \`completedAt\` is set. Partials may be read when the reviewer says so in chat — otherwise a run without \`completedAt\` is still moving. Reopening a run clears \`completedAt\`; status honestly reverts to in-progress.

## Collection

When a report is stamped done, read it (and any \`noteFiles\`), copy the outcome into your own project record. The per-project record is your job, not file placement here.

## Resolving in chat (stop the long tail)

The reviewer often answers a request in chat instead of opening the app. When they do, close it so it does not sit in their queue forever: write a **resolution marker** next to the request — \`<request-basename>.resolved.md\` (e.g. \`2026-07-18-padding.resolved.md\` beside \`2026-07-18-padding.md\`).

- Frontmatter: \`resolved_by: <you>\`, \`at: <ISO>\`. Body: one line — the outcome and where you actioned it (task record, commit, PR).
- The request drops out of "Waiting on you" and the inbox immediately. The marker is **yours** (agent-owned) — the app reads it but never writes or deletes it.
- **Resurrect** by deleting the marker; the request returns to the queue. Nothing is lost — the request and its history stay put.
- This is not a substitute for a real report when the reviewer walks a request in the app. It is for the common case where the reviewer just says "yes, works" in chat.

## Threads and entries — the record of *why* (ADR-0009)

A **thread** is a durable, project-scoped topic: the record of WHY. Reports record test outcomes; your own task record records what got done; ADRs record what was decided; the thread holds the reasoning and keeps it linked to the conversation that produced it. Start or extend one when the reviewer talks an idea, roadmap, or design through at length, or says "start a thread in the records folder" — so the thinking is not lost the moment it becomes an ADR or a task.

- A thread is a **virtual id** (\`thread:\` in frontmatter), NOT a folder — one thread may span projects. Entries live in \`<project>/threads/\` (or \`_unfiled/\` when there is no home yet).
- An **entry** is one immutable Markdown file: \`YYYY-MM-DD-HHMM-entry-<slug>.md\`. **Append, never edit.** Each contribution is a new file.
- Thread state is **derived from the latest entry that asserts each field** — never a stored status. To change \`move\`/\`form\`/\`state\`, append an entry that asserts the new value.

Frontmatter — only \`thread:\` is required:

- \`thread\` — kebab-case id. \`title\` — a short human name for the thread.
- \`by\` — whose content: \`reviewer\` | \`agent\`. Older records may say \`by: dominik\`; read it as \`reviewer\`. \`written_by\` — who created the file. Transcribing the reviewer: \`by: reviewer\`, \`written_by: agent\`.
- \`at\` — ISO timestamp (else taken from the filename date/time).
- \`projects: [..]\` — 0..n; membership lives HERE, never in the folder. \`parents: [..]\` — thread ids this grew out of; zero is legal (unattributable is fine).
- \`move\` — whose turn: \`me\` (blocked on the reviewer) · \`agent\` (ready to hand off) · \`nobody\`.
- \`form\` — \`idea\` · \`branch\` (parallel line; fuses into the trunk or retires having borne fruit) · \`sidequest\` (offshoot that leaves the tree) · \`graft\` (*same tree, new fruit*) · \`strut\` (an output refashioned to support other trees).
- \`state\` — \`open\` | \`retired\`; \`outcome\` — \`fused\` | \`delivered\` | \`abandoned\` when retiring.
- \`dictation: true\` — the body is dictated; read for intent, never pattern-match on strings.

Body is Markdown: the idea, the decision, the reasoning. When a thread produces an ADR / commit / PR, append an entry that records the outcome and cites it, with \`parents\` pointing back.

**First move each session:** in the projects you are touching, check \`<project>/threads/\` for entries with \`move: agent\` — those are handed to you. That closes the loop on ideas the reviewer dumped for you to pick up.

### Worked example — a thread across two entries

\`\`\`markdown
---
thread: turn-into-text-editor-surface
title: Which surface owns turn-into-text
by: reviewer
written_by: agent
at: 2026-07-25T10:00:00.000Z
projects: [example-app]
parents: []
move: agent
form: idea
---

Spoken beats should become slide text in one action. Open question: the
editor gutter, or a command on the selection?
\`\`\`

\`\`\`markdown
---
thread: turn-into-text-editor-surface
by: agent
at: 2026-07-25T14:00:00.000Z
projects: [example-app]
parents: [turn-into-text-editor-surface]
move: me
---

Decided: a command on the selection (keeps the gutter clean). Recorded as
docs/adr/0040-turn-into-text.md @ a1b2c3d. Needs the reviewer's approval on the keybind sweep.
\`\`\`

## Notes (the app writes these — you read them)

Free feedback authored by the reviewer, the mirror image of a request: \`YYYY-MM-DD-note-<slug>.md\` + its own \`.shots/\`. Frontmatter \`title\`, optional \`linkedRun\` (basename of a request), optional \`handedOverAt\`. Body is Markdown; screenshots are inline \`![](relative/shot.png)\` links. Status: **draft** until \`handedOverAt\` is stamped, then **handed over**. Treat only handed-over notes as final, same rule as reports.
`

export function PROJECT_AGENTS_MD(slug: string): string {
  return `# ${slug}

QA requests, reports and notes for the **${slug}** project. Full contract: [../AGENTS.md](../AGENTS.md).

- Write requests here (optionally inside a round subfolder). Immutable once written.
- Reports (\`*.report.json\`), notes and shots are app-written — do not edit them.
- Treat a report as final only when \`completedAt\` is stamped.
`
}

export const CLAUDE_SIDECAR = `@./AGENTS.md\n`
