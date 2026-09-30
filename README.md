# Dev Traffic Control

A Mac app for the requests your coding agents send you. An agent writes a request as a Markdown file in one folder: a few things to try in the build it just made, or a document with decisions for you to take. Dev Traffic Control shows the request, you answer it with clicks, and the app writes your answer beside the request, where the agent reads it.

It is for developers who already work with coding agents such as Claude Code or Codex and are tired of answering "does it work?" in a chat window.

![A check request in Dev Traffic Control](site/screenshots/check.png)

**Status: public beta.** It runs on Apple Silicon Macs with macOS 12 or later. The record format may still change between beta releases.

## What you can answer

- **Check requests.** A short list of things to try in your app. You mark each one works or not, add a comment, and paste a screenshot.
- **Design reviews.** A document with pictures and decisions. The pictures for each option sit side by side with a button under each, so you choose by looking.
- **Marked-up screenshots.** Draw arrows, boxes and text labels on a screenshot or on a review picture. The agent receives the words of every mark and where it points.
- **Handoffs.** A note for the next session saying where the work stands and what to do next, with a button that copies a prompt to continue it.

A `dtc://` link from an agent opens the request directly.

## Install

1. Download the `.dmg` from the [latest release](https://github.com/techczech/dev-traffic-control/releases/latest).
2. Open it and drag **Dev Traffic Control** to Applications.
3. Start the app and choose a records folder. The suggested folder is `~/Documents/Dev Traffic Control`; any folder works, and it can be a git repository.

The build is signed and notarised by Apple, so it opens without a security warning.

## Connect your agents

You do this once.

1. **Install the dev-traffic-control skill.** It teaches your agent the request format. Any agent that reads skills can use it. The skill is at [techczech/dominiks-agent-skills › dev/dev-traffic-control](https://github.com/techczech/dominiks-agent-skills/tree/main/dev/dev-traffic-control).

   ```sh
   git clone https://github.com/techczech/dominiks-agent-skills
   cp -R dominiks-agent-skills/dev/dev-traffic-control <your agent's skills folder>
   ```

2. **Tell your agent where to write.** Paste this to your agent once, with your own folder:

   ```text
   Use the dev-traffic-control skill. My records folder is ~/Documents/Dev Traffic Control. When you want me to test or review something, file it there and give me the dtc:// link.
   ```

3. **Or look around first.** The example project holds one check request, one design review and one handoff, so you can see what your agents will send.

## The record format in brief

Everything is plain files in the records folder, one subfolder per project. The app never commits. If the folder is a git repository, the app runs `git pull --ff-only` in it only when you press **Pull now and open it** on a link whose record has not arrived yet, and it keeps a `.gitignore` in the folder for its own temporary files. Committing the folder is up to you.

```text
records folder/
  AGENTS.md                              the full contract, written and kept current by the app
  <project>/
    2026-01-15-export-check.md           a request (written by the agent, never edited)
    2026-01-15-export-check.report.json  your answers (written by the app)
    2026-01-15-export-check.shots/       your screenshots and marked-up pictures
    releases/0.11.0.md                   a release record, one heading per feature
    handoffs/2026-01-15-next-handoff.md  a handoff
```

A check request is Markdown with frontmatter; each `## heading` is one thing to check:

```markdown
---
title: Export round
app: Example App
version: 0.9.1
intro: You should be on 0.9.1. Does each of these work?
---

## Export to Word keeps the picture
Export a piece with an image to .docx and open it. The image is there.
```

A design review sets `kind: doc-review` and asks for decisions with a fenced `decision` block. An option line may carry its picture:

````markdown
```decision {#toolbar}
Where should the toolbar sit?
- A: along the top ![](toolbar-a.png)
- B: down the left side ![](toolbar-b.png)
```
````

The app writes your answers to `<request>.report.json`: a verdict and comment per check, the option you chose per decision, and every mark you drew with its words and position. The agent reads that file. The complete format is in the `AGENTS.md` the app writes into your records folder, and the [dev-traffic-control skill](https://github.com/techczech/dominiks-agent-skills/tree/main/dev/dev-traffic-control) teaches it to agents.

## Build from source

You need Node.js 24 and a Mac.

```sh
npm ci
npm run dev          # run the app from source
npm run typecheck
npx vitest run
npm run build:mac    # a local, unnotarised build in dist/
```

The layout tests lay the app's stylesheets out in headless Google Chrome, so they need Chrome installed at `/Applications/Google Chrome.app`, or `CHROME_BIN` set to another Chrome binary. Without Chrome they are skipped and say why; every other test still runs.

Releases are built by GitHub Actions from a `v*` tag: a signed and notarised arm64 `.dmg` and `.zip`, uploaded to a draft release.

## Licence

MIT. See [LICENSE](LICENSE).
