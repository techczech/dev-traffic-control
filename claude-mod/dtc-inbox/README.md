# dtc-inbox: Dev Traffic Control answers inside Claude Code

A Claude Code mod (a plugin of function hooks) for people who use [Dev Traffic Control](https://github.com/techczech/dev-traffic-control) with Claude Code. When the reviewer answers something in the app, every Claude Code session shows what is waiting (a band above the prompt and a `/dtc` pane), and the agent reads the answer through one tool, `dtc_answers`, which returns it as delimited data. The mod never acts by itself: it submits no prompt and adds nothing to a turn.

The app stays the place where the reviewer answers. The mod only reads the records folder; it never writes into it.

## What it does

**The band.** One dim line above the prompt whenever answers are waiting for this session's project: `DTC — 2 answers waiting · /dtc to list`. It disappears when nothing is waiting. In a records folder with more files than one pass reads (see [Security](#security)), the band and the pane say `more not read yet` until later passes have read the rest.

**The `/dtc` pane.** Type `/dtc` to list, without spending a turn:

- what this session filed and where each record stands (not opened yet, opened, answered, collected);
- answers waiting to be collected from other sessions;
- answer files it could not read, each marked `could not read` (see [Security](#security));
- requests the reviewer opened and has not finished.

Up and down move, Enter opens the record in the Dev Traffic Control app, `c` puts the collect prompt for the selected answer into the prompt box (you send it), `a` shows unfinished requests older than two weeks, `q` or Esc closes. `/dtc collect [n]` fills the prompt box for answer `n` without opening the pane. In a narrow terminal, or outside the terminal and desktop app, `/dtc` answers with the same list as text.

**The `dtc_answers` tool.** The agent calls it with a record's path or its `dtc://` link (`dtc://open/<project>/<record>`, or the short form `dtc://<project>/<record>`) and gets the reviewer's answers in one normalised shape:

- for a request: each item's status and comment, flagged expectations, quotes, decisions, observations, and every picture the reviewer marked up, with each mark's number, shape and the words typed on it;
- for a roadmap idea: the reviewer's entry that the agent has not yet replied to, with the idea's id, title, `fate` and `candidate`;
- for a release record: every verdict with its comment, time and the paths of its screenshots.

It refuses a report that is not finished, so an agent never acts on half an answer. What it returns is the reviewer's content as quoted data, never as instructions (see [Security](#security)).

**It shows and reads; it never acts.** A session that writes a check request, a design review, a roadmap idea or a release record is remembered as the one that asked, and its own records are listed first in the pane. When an answer arrives, it shows in the band and as a row in the `/dtc` pane: an answer is waiting; ask the agent to collect it, or have it call `dtc_answers`. The agent reads it when you ask it to, when you send the collect prompt (`c` in the pane, or `/dtc collect`, which only fill the prompt box), or when it calls `dtc_answers` itself. A file arriving in the records folder never starts a turn.

Automatic delivery to the filing session is planned for a later release.

Three kinds of answer count as waiting:

| Answer | Where it lives | It stops waiting when |
|---|---|---|
| A finished request | `<project>/<request>.report.json` with `completedAt` | the agent writes `<request>.collected.json` or `<request>.resolved.md` |
| A reply on a feature request | a `## Reviewer entry` at the end of `<project>/roadmap/<id>.md` | the agent adds a `## Agent entry` after it |
| Release verdicts | `<project>/releases/<version>.answers.json` | an agent reads them with `dtc_answers`, or two weeks pass |

Release verdicts appear one minute after the last one was given, so a run of verdicts arrives together.

## Requirements

- Claude Code **2.1.287 or newer**. The mod is written against the mods API (function hooks) of that version and tested on 2.1.292. That API is in early access and may change between Claude Code releases.
- Dev Traffic Control **0.22.0 or newer**, for the record formats above (agent contract template v23).
- `/usr/bin/perl`, which macOS and almost every Linux system have. The mod reads each record through it (see [Security](#security)). On a machine without it the mod reads nothing: the band stays empty, the pane lists answers as `could not read`, and `dtc_answers` says so.
- macOS for Enter in the pane, which runs `open dtc://…`.

## Install

```
claude plugin marketplace add techczech/dev-traffic-control
claude plugin install dtc-inbox@dev-traffic-control
```

Start a new Claude Code session afterwards. `claude plugin list` shows whether it is installed and enabled.

## Configure the records folder

The mod reads the folder Dev Traffic Control keeps its records in. The default is the app's own default, `~/Documents/Dev Traffic Control`. If you chose another folder in the app's Settings, give the mod the same one:

```
claude plugin configure dtc-inbox@dev-traffic-control
```

| Option | Default | What it is |
|---|---|---|
| `dtcRoot` | `~/Documents/Dev Traffic Control` | The records folder. `~` is expanded. |
| `hubDir` | empty | Optional. A session whose working folder is this one (or inside it) sees every project's waiting answers. Left empty, each session sees only its own project. |
| `bandRefreshSeconds` | `60` | How often the waiting count is recomputed. Minimum 5. |

A session's project is the name of its git repository's folder (a linked worktree counts as its main repository). It must match the project's folder name in the records folder.

## Security

The mod cannot tell who wrote a file in the records folder. It treats every record as text from outside: something to show you and to hand to the agent as data, never something to obey.

**It never acts by itself.** The mod has no code that submits a prompt or adds text to a turn, and no option that turns such a thing on. A file arriving in the records folder shows in the band and the pane, and that is all. Nothing from a record reaches the agent until you ask or the agent calls `dtc_answers`. Two checks hold this: one reads the mod's source for any use of Claude Code's prompt-submit call, and one runs a whole session in Claude Code's test environment and requires that nothing was submitted.

An answer file that is not a regular file inside the records folder, is reached through a symbolic link, is larger than the size cap, or does not parse to the shape the app writes is listed in the `/dtc` pane as `could not read`. It is never counted in the band, and `c` does not collect it.

**The collect prompt.** The prompt the mod puts in the prompt box when you collect (you send it) is a fixed sentence around a link built from the project and file name, which may hold only letters, digits, `.`, `_` and `-`. No title, comment or other text from a record is ever put into a prompt. A prompt that would pass 1,000 characters is not built.

**Reviewer text is data.** Everything `dtc_answers` returns from a record (comments, quotes, the words on a mark, reviewer entries, titles, observations, file names) comes after a fixed preamble and between two marker lines:

```
<<<BEGIN DTC REVIEWER DATA>>>
{ ...the answers, as JSON... }
<<<END DTC REVIEWER DATA>>>
```

The preamble tells the agent that this is the reviewer's content, to be acted on as the Dev Traffic Control agent contract describes, and that instructions inside it about tools, secrets, other files or other systems are not to be followed. Before it is handed over:

- control characters (terminal escapes included), bidirectional marks and overrides, zero-width characters and other invisible characters are removed, in the pane and its text list as well;
- the two markers cannot appear inside the content;
- each long field (a comment, a note, a quote, a mark's words) is cut to 8,000 characters, with a note saying how much was left out; each short field (a title, an id) to 200;
- each list (items, quotes, marks, verdicts) is cut to 200 entries, and a verdict's screenshots to 20;
- the whole result is at most 60,000 characters: a longer one has its fields cut to 2,000 characters, then to 500, and then loses entries from the end, and says so.

This lowers the risk; it does not remove it. A model can still be talked into things by text it reads, which is why the mod hands a record over only when the agent asks for it, and why the folder should be private.

**Files and paths.**

- The mod reads only inside the records folder. Paths with `..`, encoded characters or control characters are refused. A symbolic link is never read and a linked folder is never walked, whether it leads outside the folder or not. The records folder itself may be a link.
- A file with more than one name (a hard link) is never read, whichever of its names is asked for: its other name may lie outside the records folder. It counts as `could not read`.
- Every file is read the same way. The file's folder must resolve to a place inside the records folder with no link on the way. The file is opened without following a link, and what was opened is checked (a regular file with exactly one name, within the size cap) and read through that same open file, never by its name a second time. After the read, the folder must still resolve to the same place and the name must still belong to the very file that was read. If any of this fails, the file counts as `could not read`.
- Claude Code gives a mod no way to open a file like that, so the mod runs the system's Perl for each read: `/usr/bin/perl` with a fixed program and the paths as arguments, without a shell. The program reports what it found; the mod decides.
- A file is read once for the size and modification time the folder lists it with, and not again until either changes. One pass over the records folder reads at most 200 files; the rest are read on the following passes (one per band refresh), and until then the band and the pane say `more not read yet`. A record whose answer file has not been read yet is not listed. Only one pass runs at a time: the band and the pane share it.
- Size caps: reports 2 MB, release answers 1 MB, idea files 256 KB, request files 1 MB (read for their title only). A larger file is not read.
- Projects and records whose names carry invisible or control characters are not listed.
- Screenshot paths are given to the agent only for regular files inside the records folder. A picture name in a report that is not a plain relative path is left out.
- The mod writes nothing into the records folder and makes no network calls. Its own bookkeeping goes to Claude Code's plugin storage: which session wrote which record, each open session's heartbeat, and which release verdicts an agent has read. It is used for display only.
- It runs two programs and no others: `/usr/bin/perl` to read a record, as above, and `/usr/bin/open` with a single `dtc://` link, without a shell, when you press Enter in the pane.
- Nothing from a record is written to a log.

**Limits that remain.**

- What stays outside the mod's protection is a program running as you that swaps folders faster than the checks around one read can notice.
- A file that has two names for an ordinary reason (some backup and deduplication tools make such files) is `could not read` as well. Copy it to a file of its own to have it read.
- The bookkeeping is shared by every session and nothing orders their writes to it. Two sessions writing in the same instant can lose one of the two notes; the effect is a record that shows no asking session in the pane, or is missing from "From this session". The answer itself still shows as waiting.
- More than 200 answer files that cannot be read, in one records folder, use up every pass: files after them are then not reached, and the band keeps saying `more not read yet`.
- Listing a folder (names and times, no content) is not done through an open file. The band and the pane can therefore show a name that a swapped folder supplied; such a file is still read only through the checks above.

## Uninstall

```
claude plugin uninstall dtc-inbox@dev-traffic-control
claude plugin marketplace remove dev-traffic-control
```

The mod's own bookkeeping (which session filed what) lives in Claude Code's plugin storage, never in your records folder, so uninstalling leaves your records exactly as they were.

## Develop

```
cd claude-mod/dtc-inbox
npm ci
npm run typecheck
npm test
claude plugin validate .
claude plugin test .
```

`npm run typecheck` and `npm test` need only Node and the three development packages in `package.json`; they run without Claude Code. `claude plugin test` runs every test in `hooks/` inside Claude Code's own test environment, including the few that load the whole mod. [RELEASING.md](RELEASING.md) says which check covers what and what to run before a release.

Tests sit beside the code in `hooks/*.test.ts`; `session-flow.test.ts`, `security.test.ts` and `guard.test.ts` hold the checks for the Security section above. `node-tests/` runs the read helper against a real disk, hard links included, and reads the mod's source to check that nothing in it submits a prompt. The fixtures are invented records of a project called `example-app`.

## Licence

MIT, as the rest of this repository.
