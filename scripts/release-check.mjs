#!/usr/bin/env node
/**
 * The release workflow's refusals, as plain functions and a small CLI.
 *
 *   node scripts/release-check.mjs trigger
 *     The run may only release the tag that started it. The tag must be
 *     `v<package.json version>`, the repository must be EXPECTED_REPOSITORY,
 *     the tag must be fetched from it successfully, and the fetched tag must
 *     be the checked-out commit. Reads GITHUB_EVENT_NAME, GITHUB_REF,
 *     GITHUB_REPOSITORY and, for a manual run, INPUT_TAG. Prints the tag and
 *     writes `tag=<tag>` to GITHUB_OUTPUT.
 *
 *   node scripts/release-check.mjs release <tag> <file>...
 *     The draft is created only when no release exists for the tag, draft or
 *     published, and only with the full set of files a release carries.
 *     Prints `create` when both hold. To rebuild a draft, delete it and run
 *     again.
 *
 *   node scripts/release-check.mjs assets <tag> --manifest <SHA256SUMS> [--url <release url>]
 *     The workflow's last step. The release for the tag must be exactly one
 *     draft whose files are exactly the files in the checksum list, no more
 *     and no fewer, each with the SHA-256 listed. Any other file on the draft
 *     fails, the skill's zip included. With a url, the draft must be the one
 *     at that address.
 *
 *   node scripts/release-check.mjs assets --after-manual <tag> [--manifest <SHA256SUMS>]
 *     The maintainer's check, after attaching the skill's zip and before
 *     publishing. The draft must hold exactly the app's dmg and zip, the
 *     mod's zip and dev-traffic-control-skill.zip, and nothing else. With a
 *     manifest, the workflow's three files are also checked against their
 *     SHA-256.
 *
 * The app's dmg and zip are known by their exact names, worked out from the
 * tag's version and the packaging configuration (package.json and
 * electron-builder.yml in the current folder). No file is taken for the app's
 * because of its extension.
 *
 * A command this script runs (git, gh) that fails is always a failure of the
 * check. Nothing is concluded from the text of an error message: "there is no
 * release for this tag" is read only from a complete, well-formed list of the
 * repository's releases that has no entry for the tag.
 *
 * Only Node built-ins are used, so the checks run before `npm ci`.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The one repository releases are made from. A fork that releases changes this line. */
export const EXPECTED_REPOSITORY = 'techczech/dev-traffic-control'
/** The Claude Code mod, packaged by the workflow's build job. */
export const MOD_ASSET = 'dtc-inbox-mod.zip'
/** The agent skill, which lives in another repository and is attached to the draft by the maintainer. */
export const SKILL_ASSET = 'dev-traffic-control-skill.zip'

const TAG_REF = 'refs/tags/'
/** Where the tag is fetched to, apart from any tag a local clone already holds. */
const FETCHED_REF = 'refs/release-check/'
// The versions this project tags: 1.2.3, or 1.2.3-beta.1.
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/
const SHA256 = /^[0-9a-f]{64}$/

/**
 * Which tag this run may release, or why it may not release anything.
 *
 * @param {{ eventName?: string, ref?: string, inputTag?: string, version?: string }} run
 * @returns {{ ok: true, tag: string } | { ok: false, error: string }}
 */
export function authorisedTag({ eventName, ref, inputTag, version }) {
  if (typeof version !== 'string' || !VERSION.test(version)) {
    return {
      ok: false,
      error: `package.json version ${JSON.stringify(version)} is not a release version.`
    }
  }
  const expected = `v${version}`
  if (eventName === 'push') {
    if (typeof ref !== 'string' || !ref.startsWith(TAG_REF)) {
      return { ok: false, error: `The run was started by ${ref || 'no ref'}, which is not a tag.` }
    }
    const pushed = ref.slice(TAG_REF.length)
    if (pushed !== expected) {
      return {
        ok: false,
        error: `The pushed tag is ${pushed} but package.json is at ${version}; this run may only release ${expected}.`
      }
    }
    return { ok: true, tag: expected }
  }
  if (eventName === 'workflow_dispatch') {
    if (typeof inputTag !== 'string' || inputTag === '') {
      return { ok: false, error: 'A manual run needs the tag to release in its `tag` input.' }
    }
    if (inputTag !== expected) {
      return {
        ok: false,
        error: `The tag input is ${inputTag} but package.json is at ${version}; this run may only release ${expected}.`
      }
    }
    return { ok: true, tag: expected }
  }
  return { ok: false, error: `A release cannot be started by a ${eventName || 'missing'} event.` }
}

/**
 * The `owner/repo` a GitHub remote address names, or null for any other
 * address (a local path, another host, a longer path).
 *
 * @param {unknown} url
 * @returns {string | null}
 */
export function repositoryOfUrl(url) {
  if (typeof url !== 'string') return null
  const match =
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
      url.trim()
    )
  return match ? `${match[1]}/${match[2]}` : null
}

/**
 * The tag is only fetched from, and the release only written to, the expected
 * repository. The address `origin` really fetches from must name it; so must
 * GITHUB_REPOSITORY, which a run on GitHub Actions always has.
 *
 * @param {{ remoteUrl: unknown, githubRepository?: string, isActions?: boolean, expected?: string }} where
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function repositoryIsExpected({
  remoteUrl,
  githubRepository,
  isActions = false,
  expected = EXPECTED_REPOSITORY
}) {
  const same = (name) => typeof name === 'string' && name.toLowerCase() === expected.toLowerCase()
  const remote = repositoryOfUrl(remoteUrl)
  if (!same(remote)) {
    return {
      ok: false,
      error: `The remote origin is ${JSON.stringify(remoteUrl)}, not the repository ${expected}; the tag is only fetched from ${expected}.`
    }
  }
  if (githubRepository === undefined || githubRepository === '') {
    if (isActions) return { ok: false, error: 'GITHUB_REPOSITORY is not set on this runner.' }
    return { ok: true }
  }
  if (!same(githubRepository)) {
    return {
      ok: false,
      error: `This run belongs to ${githubRepository}, not ${expected}; releases are only made from ${expected}.`
    }
  }
  return { ok: true }
}

/**
 * The checked-out commit must be the tag's commit.
 *
 * @param {{ tag: string, tagCommit?: string | null, headCommit?: string | null }} commits
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function tagIsCheckedOut({ tag, tagCommit, headCommit }) {
  if (!tagCommit) return { ok: false, error: `The tag ${tag} does not exist in the repository.` }
  if (!headCommit) return { ok: false, error: 'The checked-out commit could not be read.' }
  if (tagCommit !== headCommit) {
    return {
      ok: false,
      error: `The tag ${tag} is at ${tagCommit} but the checked-out commit is ${headCommit}; the build would not be the tagged source.`
    }
  }
  return { ok: true }
}

/**
 * The repository's releases, read from `gh api --paginate --slurp
 * repos/<owner>/<repo>/releases`: an array of pages, each an array of
 * releases. Drafts are in this list (the lookup by tag does not return them).
 * A command that failed, output that is not that shape, or a release without a
 * string `tag_name`, a boolean `draft` and an `assets` array throws: a list
 * that cannot be read in full is never taken for "no release".
 *
 * @param {{ status: number | null, stdout: string, stderr: string }} result
 * @returns {Array<{ id: number, tag: string, isDraft: boolean, url: string, assets: Array<{ id: number, name: string, state: string, digest: string | null }> }>}
 */
export function parseReleaseList({ status, stdout, stderr }) {
  if (status !== 0) {
    throw new Error(
      `The releases could not be listed (gh exit ${status}): ${String(stderr).trim() || 'no message'}`
    )
  }
  let pages
  try {
    pages = JSON.parse(stdout)
  } catch {
    throw new Error('The list of releases is not JSON.')
  }
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error('The list of releases is not a list of pages.')
  }
  return pages.flat().map((release) => {
    if (
      release === null ||
      typeof release !== 'object' ||
      !Number.isSafeInteger(release.id) ||
      typeof release.tag_name !== 'string' ||
      typeof release.draft !== 'boolean' ||
      typeof release.html_url !== 'string' ||
      !Array.isArray(release.assets)
    ) {
      throw new Error('The list of releases holds an entry that is not a release.')
    }
    const assets = release.assets.map((asset) => {
      if (
        asset === null ||
        typeof asset !== 'object' ||
        !Number.isSafeInteger(asset.id) ||
        typeof asset.name !== 'string' ||
        typeof asset.state !== 'string'
      ) {
        throw new Error(`Release ${release.tag_name} lists a file that cannot be read.`)
      }
      return {
        id: asset.id,
        name: asset.name,
        state: asset.state,
        digest: typeof asset.digest === 'string' ? asset.digest : null
      }
    })
    return {
      id: release.id,
      tag: release.tag_name,
      isDraft: release.draft,
      url: release.html_url,
      assets
    }
  })
}

/** The dmg's name as `electron-builder.yml` sets it (`dmg.artifactName`). */
const DMG_TEMPLATE = '${name}-${version}.${ext}'

/**
 * What the packaging configuration says about the app's file names: the
 * package name and the product name. The names of the release's files are
 * worked out from these and the version, never read off the files themselves.
 * Throws when the configuration no longer matches the two name patterns this
 * script knows (`appFileNames`): the dmg's `artifactName` must be
 * `${name}-${version}.${ext}`, and the mac target must set none, so that the
 * zip keeps electron-builder's own name.
 *
 * @param {{ packageJson: string, builderYml: string }} sources
 * @returns {{ name: string, productName: string }}
 */
export function packagingOf({ packageJson, builderYml }) {
  const { name } = JSON.parse(packageJson)
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(`package.json name ${JSON.stringify(name)} is not a package name.`)
  }
  // The top-level sections of the file, each with the lines indented under it.
  const sections = new Map()
  let current = null
  for (const line of String(builderYml).split('\n')) {
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (top) {
      current = top[1]
      sections.set(current, { value: top[2].trim(), lines: [] })
    } else if (current !== null) sections.get(current).lines.push(line)
  }
  const artifactNameIn = (section) => {
    for (const line of sections.get(section)?.lines ?? []) {
      const found = /^ {2}artifactName:\s*(.+?)\s*$/.exec(line)
      if (found) return found[1].replace(/^(['"])(.*)\1$/, '$2')
    }
    return null
  }
  const productName = (sections.get('productName')?.value ?? '').replace(/^(['"])(.*)\1$/, '$2')
  if (productName === '' || /[\\/]/.test(productName)) {
    throw new Error('electron-builder.yml has no usable productName.')
  }
  if (artifactNameIn('dmg') !== DMG_TEMPLATE) {
    throw new Error(
      `electron-builder.yml names the dmg ${JSON.stringify(artifactNameIn('dmg'))}, not ${DMG_TEMPLATE}; update the name patterns in scripts/release-check.mjs with it.`
    )
  }
  if (artifactNameIn('mac') !== null) {
    throw new Error(
      'electron-builder.yml sets an artifactName for the mac target; update the name patterns in scripts/release-check.mjs with it.'
    )
  }
  return { name, productName }
}

/**
 * The names of the two app files of a release, as the build writes them: the
 * dmg by the configured pattern, the zip by electron-builder's own pattern for
 * an Apple Silicon mac zip.
 *
 * @param {{ name: string, productName: string, version: string }} release
 * @returns {{ dmg: string, zip: string }}
 */
export function appFileNames({ name, productName, version }) {
  return { dmg: `${name}-${version}.dmg`, zip: `${productName}-${version}-arm64-mac.zip` }
}

/**
 * The name a file has once it is on a GitHub release: GitHub replaces every
 * character of an uploaded file's name other than letters, digits, `.`, `_`
 * and `-` with a period (a space, for one).
 *
 * @param {string} fileName
 * @returns {string}
 */
export function assetNameOf(fileName) {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '.')
}

/**
 * The files a release carries, looked for among `names` by their exact names:
 * the app's dmg and zip as `wanted` gives them, and the mod's zip. Nothing is
 * recognised by its extension. The skill's zip is attached later by the
 * maintainer, so it is reported and not required here.
 *
 * @param {string[]} names
 * @param {{ dmg: string, zip: string }} wanted
 * @returns {{ ok: true, hasSkill: boolean, others: string[] } | { ok: false, error: string }}
 */
export function expectedAssets(names, wanted) {
  const required = [wanted.dmg, wanted.zip, MOD_ASSET]
  const missing = required.filter((name) => !names.includes(name))
  if (missing.length > 0) return { ok: false, error: `Missing: ${missing.join(', ')}.` }
  const known = new Set([...required, SKILL_ASSET])
  return {
    ok: true,
    hasSkill: names.includes(SKILL_ASSET),
    others: names.filter((name) => !known.has(name))
  }
}

/**
 * Whether the draft may be created, given every release that exists for the
 * tag. Only "no release at all" passes, and only with exactly the files this
 * release carries (`expected`: the app's dmg and zip by name).
 *
 * @param {{ tag: string, releases: Array<{ isDraft: boolean }>, files: string[], expected: { dmg: string, zip: string } }} state
 * @returns {{ ok: true, action: 'create' } | { ok: false, error: string }}
 */
export function uploadPlan({ tag, releases, files, expected }) {
  const names = files.map((file) => path.basename(file))
  if (names.length === 0) return { ok: false, error: 'There are no files to upload.' }
  if (new Set(names).size !== names.length) {
    return { ok: false, error: `Two of the files share a name: ${names.join(', ')}.` }
  }
  const found = expectedAssets(names, expected)
  if (!found.ok) return { ok: false, error: `The files are not release ${tag}. ${found.error}` }
  if (found.hasSkill || found.others.length > 0) {
    return {
      ok: false,
      error: `The files are not release ${tag}: ${[...(found.hasSkill ? [SKILL_ASSET] : []), ...found.others].join(', ')} is not one of the workflow's files.`
    }
  }
  if (releases.some((release) => release.isDraft !== true)) {
    return {
      ok: false,
      error: `Release ${tag} is already published. Its files are never replaced or added to; release a new version instead.`
    }
  }
  if (releases.length > 0) {
    return {
      ok: false,
      error: `A draft release ${tag} already exists. Files are never added to an existing release: delete the draft release, then run the release again.`
    }
  }
  return { ok: true, action: 'create' }
}

/**
 * A checksum list keyed by the names its files have on a GitHub release
 * (`assetNameOf`). Throws when two files would get the same name there.
 *
 * @param {Map<string, string>} manifest
 * @returns {Map<string, string>}
 */
export function manifestByAssetName(manifest) {
  const sums = new Map()
  for (const [name, sum] of manifest) {
    const asset = assetNameOf(name)
    if (sums.has(asset))
      throw new Error(`Two files in the checksum list would both be ${asset} on the release.`)
    sums.set(asset, sum)
  }
  return sums
}

/**
 * A checksum list as `shasum -a 256` writes it: name → SHA-256. Any line that
 * is not `<64 hex digits><two spaces, or a space and *><name>`, an empty list,
 * or a name listed twice throws.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseManifest(text) {
  const sums = new Map()
  for (const line of String(text).split('\n')) {
    if (line === '') continue
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line)
    if (!match) throw new Error(`The checksum list has a line that is not a checksum: ${line}`)
    if (sums.has(match[2])) throw new Error(`The checksum list names ${match[2]} more than once.`)
    sums.set(match[2], match[1])
  }
  if (sums.size === 0) throw new Error('The checksum list is empty.')
  return sums
}

/**
 * The state of the draft, in one of two checks. In both, the app's files are
 * known by the exact names `expected` gives them (worked out from the version
 * and the packaging configuration, as they are on a GitHub release), never by
 * their extension, and `manifest` is keyed by the names on the release too.
 *
 * The workflow's check (`afterManual` false) needs the checksum list and
 * passes only when the draft's files are exactly the files it lists.
 *
 * The maintainer's check (`afterManual` true) passes only when the draft's
 * files are exactly the app's dmg and zip, the mod's zip and the skill's zip.
 *
 * Both need exactly one release for the tag, a draft (the one at `url`, when
 * given), every file finished uploading, and, when `manifest` is given, the
 * checksum list naming exactly the app's dmg and zip and the mod's zip, each
 * on the draft with the SHA-256 listed (`hashes`: file name → the SHA-256 of
 * what the release holds). A file outside the exact set fails the check.
 *
 * @param {{ tag: string, releases: Array<{ isDraft: boolean, url: string, assets: Array<{ name: string, state: string }> }>, expected: { dmg: string, zip: string }, manifest?: Map<string, string> | null, hashes?: Map<string, string>, url?: string | null, afterManual?: boolean }} state
 * @returns {{ ok: boolean, errors: string[], assets: Array<{ name: string, sha256: string | null }> }}
 */
export function draftReport({
  tag,
  releases,
  expected: wanted,
  manifest = null,
  hashes = new Map(),
  url = null,
  afterManual = false
}) {
  const errors = []
  const fail = (assets = []) => ({ ok: false, errors, assets })
  if (!afterManual && manifest === null) {
    errors.push('The check after the upload needs the verified checksum list.')
    return fail()
  }
  if (releases.length === 0) {
    errors.push(`There is no release for ${tag}.`)
    return fail()
  }
  if (releases.length > 1) {
    errors.push(
      `There are ${releases.length} releases for ${tag}; the workflow creates exactly one.`
    )
    return fail()
  }
  const [release] = releases
  if (release.isDraft !== true) {
    errors.push(
      `Release ${tag} is no longer a draft: it was published before this check. Its files cannot be vouched for.`
    )
  }
  if (url !== null && release.url !== url) {
    errors.push(
      `The draft for ${tag} is at ${release.url}, not at ${url}, where this run created it.`
    )
  }
  const names = release.assets.map((asset) => asset.name)
  if (new Set(names).size !== names.length) {
    errors.push(`The draft for ${tag} lists a file name twice.`)
  }
  for (const asset of release.assets) {
    if (asset.state !== 'uploaded') {
      errors.push(`${asset.name} did not finish uploading (state ${asset.state}).`)
    }
  }
  const expected = expectedAssets(names, wanted)
  if (!expected.ok) errors.push(`The draft for ${tag} is incomplete. ${expected.error}`)
  const workflowFiles = [wanted.dmg, wanted.zip, MOD_ASSET]
  if (manifest !== null) {
    const listed = [...manifest.keys()]
    if (
      listed.length !== workflowFiles.length ||
      workflowFiles.some((name) => !manifest.has(name))
    ) {
      errors.push(
        `The checksum list is not release ${tag}'s: it names ${listed.join(', ')}, not ${workflowFiles.join(', ')}.`
      )
    }
    for (const [name, sum] of manifest) {
      if (!names.includes(name)) {
        errors.push(`${name} is in the verified checksum list but not on the draft.`)
      } else if (!SHA256.test(hashes.get(name) ?? '')) {
        errors.push(`The SHA-256 of ${name} on the draft could not be read.`)
      } else if (hashes.get(name) !== sum) {
        errors.push(
          `${name} on the draft has SHA-256 ${hashes.get(name)}, but the verified file has ${sum}.`
        )
      }
    }
  }
  // Exact membership: the workflow's files, plus the skill's zip once the maintainer attached it.
  const allowed = new Set(workflowFiles)
  if (afterManual) {
    allowed.add(SKILL_ASSET)
    if (!names.includes(SKILL_ASSET)) {
      errors.push(`${SKILL_ASSET} is not attached. Attach it to the draft before publishing.`)
    }
  }
  const extra = names.filter((name) => !allowed.has(name))
  if (extra.length > 0) {
    errors.push(
      afterManual
        ? `The draft holds files that are neither the workflow's nor ${SKILL_ASSET}: ${extra.join(', ')}.`
        : `The draft holds files that are not the workflow's verified files: ${extra.join(', ')}.`
    )
  }
  return {
    ok: errors.length === 0,
    errors,
    assets: names.map((name) => ({ name, sha256: hashes.get(name) ?? null }))
  }
}

/** Runs a command; a command that cannot be started is reported like one that failed. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...options
  })
  if (result.error) {
    return {
      status: null,
      stdout: '',
      stderr: `${command} could not be run: ${result.error.message}`
    }
  }
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? '')
  }
}

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

/** The command's output; any failure of the command ends the check. */
function must(what, command, args) {
  const result = run(command, args)
  if (result.status !== 0) {
    fail(`${what} (${command} exit ${result.status}): ${result.stderr.trim() || 'no message'}`)
  }
  return result.stdout.trim()
}

function releaseTag(tag) {
  if (typeof tag !== 'string' || !/^v/.test(tag) || !VERSION.test(tag.slice(1))) {
    fail(`${JSON.stringify(tag)} is not a release tag.`)
  }
  return tag
}

function releasesFor(tag) {
  try {
    const listed = parseReleaseList(
      run('gh', [
        'api',
        '--paginate',
        '--slurp',
        '-H',
        'Accept: application/vnd.github+json',
        `repos/${EXPECTED_REPOSITORY}/releases?per_page=100`
      ])
    )
    return listed.filter((release) => release.tag === tag)
  } catch (error) {
    return fail(error.message)
  }
}

function runTrigger() {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const authorised = authorisedTag({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    inputTag: process.env.INPUT_TAG,
    version
  })
  if (!authorised.ok) fail(authorised.error)
  const { tag } = authorised

  const expected = repositoryIsExpected({
    // The address a fetch from origin really uses, with any rewrite rule applied.
    remoteUrl: must('The remote origin could not be read', 'git', ['remote', 'get-url', 'origin']),
    githubRepository: process.env.GITHUB_REPOSITORY,
    isActions: process.env.GITHUB_ACTIONS === 'true'
  })
  if (!expected.ok) fail(expected.error)

  // The tag as the remote holds it now, fetched to a ref of its own that is
  // removed first: a tag a local clone remembers is never what is checked.
  // `tag` has passed the version pattern, so it is safe to name in a refspec.
  const fetched = `${FETCHED_REF}${tag}`
  must('An earlier fetched tag could not be removed', 'git', ['update-ref', '-d', fetched])
  must(`The tag ${tag} could not be fetched from ${EXPECTED_REPOSITORY}`, 'git', [
    'fetch',
    '--no-tags',
    '--force',
    'origin',
    `+${TAG_REF}${tag}:${fetched}`
  ])
  const checkedOut = tagIsCheckedOut({
    tag,
    tagCommit: must(`The fetched tag ${tag} names no commit`, 'git', [
      'rev-parse',
      '--verify',
      `${fetched}^{commit}`
    ]),
    headCommit: must('The checked-out commit could not be read', 'git', [
      'rev-parse',
      '--verify',
      'HEAD^{commit}'
    ])
  })
  must('The fetched tag could not be removed', 'git', ['update-ref', '-d', fetched])
  if (!checkedOut.ok) fail(checkedOut.error)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`)
  console.log(tag)
}

/** The app's file names for the tag's version, from the packaging configuration in the current folder. */
function appFilesFor(tag) {
  try {
    const packaging = packagingOf({
      packageJson: readFileSync('package.json', 'utf8'),
      builderYml: readFileSync('electron-builder.yml', 'utf8')
    })
    return appFileNames({ ...packaging, version: tag.slice(1) })
  } catch (error) {
    return fail(`The release's file names could not be worked out: ${error.message}`)
  }
}

function runRelease(tag, files) {
  releaseTag(tag)
  const expected = appFilesFor(tag)
  const plan = uploadPlan({ tag, releases: releasesFor(tag), files, expected })
  if (!plan.ok) fail(plan.error)
  console.log(plan.action)
}

function sha256OfFile(file) {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read === 0) break
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

/**
 * The SHA-256 of a file as the release holds it: the digest GitHub recorded
 * for the upload when it gives one, otherwise the file is downloaded and
 * hashed here.
 */
function sha256OfAsset(asset, scratch) {
  const recorded = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')
  if (recorded) return recorded[1]
  const file = path.join(scratch, String(asset.id))
  const fd = openSync(file, 'w')
  let result
  try {
    result = run(
      'gh',
      [
        'api',
        '-H',
        'Accept: application/octet-stream',
        `repos/${EXPECTED_REPOSITORY}/releases/assets/${asset.id}`
      ],
      { stdio: ['ignore', fd, 'pipe'] }
    )
  } finally {
    closeSync(fd)
  }
  if (result.status !== 0) {
    fail(
      `${asset.name} could not be downloaded from the draft (gh exit ${result.status}): ${result.stderr.trim() || 'no message'}`
    )
  }
  return sha256OfFile(file)
}

const ASSETS_USAGE =
  'Usage: release-check.mjs assets <tag> --manifest <SHA256SUMS> [--url <release url>] | assets --after-manual <tag> [--manifest <SHA256SUMS>]'

function runAssets(args) {
  const afterManual = args[0] === '--after-manual'
  const [tag, ...rest] = afterManual ? args.slice(1) : args
  releaseTag(tag)
  const options = { manifest: null, url: null }
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1]
    if (rest[i] === '--manifest' && value) options.manifest = value
    else if (rest[i] === '--url' && value && !afterManual) options.url = value
    else fail(ASSETS_USAGE)
  }
  // The workflow's check is against the verified checksum list, always.
  if (!afterManual && options.manifest === null) fail(ASSETS_USAGE)
  let manifest = null
  if (options.manifest !== null) {
    try {
      manifest = manifestByAssetName(parseManifest(readFileSync(options.manifest, 'utf8')))
    } catch (error) {
      fail(`The checksum list ${options.manifest} could not be read: ${error.message}`)
    }
  }
  const files = appFilesFor(tag)
  const expected = { dmg: assetNameOf(files.dmg), zip: assetNameOf(files.zip) }
  const releases = releasesFor(tag)
  const hashes = new Map()
  if (manifest !== null && releases.length === 1) {
    const scratch = mkdtempSync(path.join(tmpdir(), 'release-check-'))
    try {
      for (const asset of releases[0].assets) {
        if (manifest.has(asset.name) && asset.state === 'uploaded') {
          hashes.set(asset.name, sha256OfAsset(asset, scratch))
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
  const report = draftReport({
    tag,
    releases,
    expected,
    manifest,
    hashes,
    url: options.url,
    afterManual
  })
  for (const asset of report.assets) {
    console.log(`${asset.sha256 ?? 'not in the checksum list'.padEnd(64)}  ${asset.name}`)
  }
  if (!report.ok) {
    for (const error of report.errors.slice(0, -1)) console.error(`::error::${error}`)
    fail(report.errors.at(-1))
  }
  console.log(
    afterManual
      ? `Draft ${tag} holds exactly the workflow's files and ${SKILL_ASSET}.`
      : `Draft ${tag} holds exactly the verified files.`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'trigger') runTrigger()
  else if (command === 'release') runRelease(rest[0], rest.slice(1))
  else if (command === 'assets') runAssets(rest)
  else {
    fail(
      `Usage: release-check.mjs trigger | release <tag> <file>... | ${ASSETS_USAGE.slice('Usage: release-check.mjs '.length)}`
    )
  }
}
