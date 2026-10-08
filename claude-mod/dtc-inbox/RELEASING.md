# Releasing the dtc-inbox mod

What to run before a release of the mod, and what each check covers. Paths are from this folder.

## The checks

| Check | Needs | What it covers |
|---|---|---|
| `npm run typecheck` | Node, `npm ci` | Every file in `hooks/` and `types/` type-checks against itself, using the stand-in host typings in `dev/host-stub.d.ts`. `node-tests/` and the test shim type-check against Node. |
| `npm test` | Node, `npm ci`; `/usr/bin/perl` for `node-tests/` | Every test in `hooks/*.test.ts` that does not ask for the host, run by vitest. `node-tests/*.spec.ts`: the read helper against a real disk, with real symbolic links, a named pipe and two processes swapping files and folders during reads; and a read of the mod's own source that fails if any module uses the host's prompt-submit call. |
| `claude plugin validate .` | Claude Code | The manifest, the hooks module, what it imports and which host calls it makes. |
| `claude plugin test .` | Claude Code | Every test in `hooks/`, in Claude Code's own test environment. This is the only place the tests that load the whole mod run. |

## What runs without Claude Code, and what does not

The tests import their kit from `claude-code/testing`, which exists only inside Claude Code. Under vitest that import is answered by `dev/testing-shim.ts`, which hands back vitest's own `describe`, `expect` and `test`.

A test that asks for the host cannot run there: one whose function takes the host's `$` and `on`, or one given host options (`{ options: … }`). The shim marks each of these as skipped, with the reason in its name. Today they are the tests in `hooks/session-flow.test.ts` that load the mod and drive a session through it: that nothing reaches the host's prompt-submit call in a whole session, that every record is read through the helper, that an unchanged folder is not read again, and that nothing is read on a machine without it. They need the host's event dispatch, its mocks (`mock.clock`, `mock.store`, `mock.env`) and its `ui.mount`, none of which exist outside Claude Code. `npm test` prints how many it skipped.

The stand-in typings are loose and cover only what the mod names. They catch mistakes inside the mod; they do not check the mod against the host. Where Claude Code writes its own typings into `.claude-plugin/types/`, those are the authority, and the type-check here does not read them.

`node-tests/` is the other way round: it needs a real file system and a real process, which Claude Code's test environment does not give, so `claude plugin test` does not see it (it runs `*.test.ts` and `*.test.tsx` only, and these are `*.spec.ts`).

## Before a release

1. Set the same new version in `.claude-plugin/plugin.json` and `package.json`.
2. From a clean checkout, in this folder: `npm ci`, `npm run typecheck`, `npm test`. All must pass. In continuous integration these three are the gate.
3. On a machine with the Claude Code version named in the README: `claude plugin validate .` and `claude plugin test .`. Both must pass, with no test failing. This step is run by the maintainer by hand: it is the only check of the tests that load the whole mod.
4. Read the Security section of `README.md` against the change, and correct it if the change moved anything it says.
5. The mod shows and reads; it never acts. Both checks of that must pass: `node-tests/no-prompt-submit.spec.ts` under `npm test`, and `hooks/session-flow.test.ts` under `claude plugin test .`.

## The mod as a file on the app's release

The app's release workflow (`.github/workflows/release.yml` at the top of the repository) packs this folder and `.claude-plugin/marketplace.json` into `dtc-inbox-mod.zip` and attaches it to the draft release with the app. Two checks cover the files on that draft, both in `scripts/release-check.mjs` at the top of the repository:

| Check | Run by | Passes only when |
|---|---|---|
| `assets <tag> --manifest <SHA256SUMS> --url <release url>` | the workflow, as its last step | the draft holds exactly the files in the run's checksum list, each with its recorded SHA-256, and no other file; the list must name the app's `.dmg` and `.zip` by the names this version's build gives them, and `dtc-inbox-mod.zip` |
| `assets --after-manual <tag>` | the maintainer, after attaching `dev-traffic-control-skill.zip` and before publishing | the draft holds exactly those three files plus `dev-traffic-control-skill.zip`, and no other file. The app's two files are known by their exact names, worked out from the version and the packaging configuration, never by their extension; with `--manifest`, the three are also checked against their SHA-256 |

Attach the skill's zip only after the run has finished: attached earlier, it fails the workflow's check. Do not publish before the second check passes.
