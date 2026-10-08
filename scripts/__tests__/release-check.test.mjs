import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import {
  EXPECTED_REPOSITORY,
  MOD_ASSET,
  SKILL_ASSET,
  appFileNames,
  assetNameOf,
  authorisedTag,
  draftReport,
  expectedAssets,
  manifestByAssetName,
  packagingOf,
  parseManifest,
  parseReleaseList,
  repositoryIsExpected,
  repositoryOfUrl,
  tagIsCheckedOut,
  uploadPlan
} from '../release-check.mjs'

const script = fileURLToPath(new URL('../release-check.mjs', import.meta.url))

describe('authorisedTag', () => {
  test('a pushed tag is authorised only when it is v<version>', () => {
    expect(authorisedTag({ eventName: 'push', ref: 'refs/tags/v1.4.0', version: '1.4.0' })).toEqual(
      {
        ok: true,
        tag: 'v1.4.0'
      }
    )
    const older = authorisedTag({ eventName: 'push', ref: 'refs/tags/v1.3.0', version: '1.4.0' })
    expect(older.ok).toBe(false)
    expect(older.error).toContain('may only release v1.4.0')
  })

  test('a branch push, an unknown event and a malformed version are refused', () => {
    expect(authorisedTag({ eventName: 'push', ref: 'refs/heads/main', version: '1.4.0' }).ok).toBe(
      false
    )
    expect(
      authorisedTag({ eventName: 'push', ref: 'refs/heads/v1.4.0', version: '1.4.0' }).ok
    ).toBe(false)
    expect(
      authorisedTag({ eventName: 'schedule', ref: 'refs/tags/v1.4.0', version: '1.4.0' }).ok
    ).toBe(false)
    expect(authorisedTag({ eventName: 'push', ref: 'refs/tags/v1.4', version: '1.4' }).ok).toBe(
      false
    )
    expect(
      authorisedTag({ eventName: 'push', ref: 'refs/tags/v1.4.0;x', version: '1.4.0;x' }).ok
    ).toBe(false)
  })

  test('a manual run needs a tag input equal to v<version>', () => {
    const run = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', version: '1.4.0-beta.2' }
    expect(authorisedTag({ ...run, inputTag: 'v1.4.0-beta.2' })).toEqual({
      ok: true,
      tag: 'v1.4.0-beta.2'
    })
    expect(authorisedTag({ ...run, inputTag: '' }).ok).toBe(false)
    expect(authorisedTag(run).ok).toBe(false)
    expect(authorisedTag({ ...run, inputTag: 'v1.3.0' }).ok).toBe(false)
    expect(authorisedTag({ ...run, inputTag: '1.4.0-beta.2' }).ok).toBe(false)
  })
})

describe('tagIsCheckedOut', () => {
  test('passes only when the tag exists and is the checked-out commit', () => {
    expect(tagIsCheckedOut({ tag: 'v1.4.0', tagCommit: 'aaa', headCommit: 'aaa' })).toEqual({
      ok: true
    })
    expect(tagIsCheckedOut({ tag: 'v1.4.0', tagCommit: 'aaa', headCommit: 'bbb' }).ok).toBe(false)
    expect(tagIsCheckedOut({ tag: 'v1.4.0', tagCommit: null, headCommit: 'bbb' }).error).toContain(
      'does not exist'
    )
    expect(tagIsCheckedOut({ tag: 'v1.4.0', tagCommit: 'aaa', headCommit: null }).ok).toBe(false)
  })
})

describe('repositoryIsExpected', () => {
  test('reads owner/repo from a GitHub address and from nothing else', () => {
    expect(repositoryOfUrl('https://github.com/example-org/example-app.git')).toBe(
      'example-org/example-app'
    )
    expect(repositoryOfUrl('https://github.com/example-org/example-app')).toBe(
      'example-org/example-app'
    )
    expect(repositoryOfUrl('git@github.com:example-org/example-app.git')).toBe(
      'example-org/example-app'
    )
    expect(repositoryOfUrl('ssh://git@github.com/example-org/example-app')).toBe(
      'example-org/example-app'
    )
    expect(repositoryOfUrl('/tmp/example-app')).toBeNull()
    expect(repositoryOfUrl('https://example.com/example-org/example-app.git')).toBeNull()
    expect(repositoryOfUrl('https://github.com/example-org/example-app/extra')).toBeNull()
    expect(repositoryOfUrl('https://github.com.example.com/example-org/example-app')).toBeNull()
    expect(repositoryOfUrl(undefined)).toBeNull()
  })

  test('passes only for the expected repository, on the remote and on the runner', () => {
    const expected = 'example-org/example-app'
    const remoteUrl = 'https://github.com/example-org/example-app.git'
    expect(repositoryIsExpected({ remoteUrl, expected })).toEqual({ ok: true })
    expect(
      repositoryIsExpected({ remoteUrl, githubRepository: 'Example-Org/Example-App', expected })
    ).toEqual({ ok: true })

    const fork = repositoryIsExpected({
      remoteUrl: 'https://github.com/someone-else/example-app.git',
      expected
    })
    expect(fork.ok).toBe(false)
    expect(fork.error).toContain('not the repository example-org/example-app')
    expect(repositoryIsExpected({ remoteUrl: '/tmp/example-app', expected }).ok).toBe(false)

    const otherRun = repositoryIsExpected({
      remoteUrl,
      githubRepository: 'someone-else/example-app',
      expected
    })
    expect(otherRun.ok).toBe(false)
    expect(otherRun.error).toContain('belongs to someone-else/example-app')
    expect(repositoryIsExpected({ remoteUrl, isActions: true, expected }).ok).toBe(false)
  })
})

// The invented app's packaging: what package.json and electron-builder.yml say, and the names
// that follow for version 1.4.0. The zip's name has a space, which a GitHub release turns into a
// period.
const PACKAGE_JSON = JSON.stringify({ name: 'example-app', version: '1.4.0' })
const BUILDER_YML = [
  'appId: com.example.example-app',
  'productName: Example App',
  'mac:',
  '  notarize: true',
  'dmg:',
  '  artifactName: ${name}-${version}.${ext}',
  'publish:',
  '  provider: github',
  ''
].join('\n')
const DMG = 'example-app-1.4.0.dmg'
const ZIP = 'Example App-1.4.0-arm64-mac.zip'
const ZIP_ASSET = 'Example.App-1.4.0-arm64-mac.zip'
/** The app's files as the build writes them, and as a GitHub release names them. */
const BUILT = { dmg: DMG, zip: ZIP }
const RELEASED = { dmg: DMG, zip: ZIP_ASSET }
const sum = (digit) => digit.repeat(64)

describe('the names of the app files come from the version and the packaging configuration', () => {
  test('package name and product name are read, and give the two names', () => {
    const packaging = packagingOf({ packageJson: PACKAGE_JSON, builderYml: BUILDER_YML })
    expect(packaging).toEqual({ name: 'example-app', productName: 'Example App' })
    expect(appFileNames({ ...packaging, version: '1.4.0' })).toEqual(BUILT)
    expect(appFileNames({ ...packaging, version: '2.0.0-beta.1' })).toEqual({
      dmg: 'example-app-2.0.0-beta.1.dmg',
      zip: 'Example App-2.0.0-beta.1-arm64-mac.zip'
    })
  })

  test('a configuration that no longer matches the two patterns is refused, not guessed at', () => {
    const builder = (text) => () => packagingOf({ packageJson: PACKAGE_JSON, builderYml: text })
    expect(
      builder(BUILDER_YML.replace('${name}-${version}.${ext}', '${productName}.${ext}'))
    ).toThrow('names the dmg')
    expect(
      builder(BUILDER_YML.replace('dmg:\n  artifactName: ${name}-${version}.${ext}\n', ''))
    ).toThrow('names the dmg')
    expect(
      builder(BUILDER_YML.replace('mac:\n', 'mac:\n  artifactName: ${name}.${ext}\n'))
    ).toThrow('mac target')
    expect(builder(BUILDER_YML.replace('productName: Example App\n', ''))).toThrow('productName')
    expect(() => packagingOf({ packageJson: '{"name":"../x"}', builderYml: BUILDER_YML })).toThrow(
      'not a package name'
    )
  })

  test('a GitHub release renames a file: every character but letters, digits, . _ - becomes a period', () => {
    expect(assetNameOf(ZIP)).toBe(ZIP_ASSET)
    expect(assetNameOf(DMG)).toBe(DMG)
    expect(assetNameOf(MOD_ASSET)).toBe(MOD_ASSET)
    expect([...manifestByAssetName(new Map([[ZIP, sum('b')]]))]).toEqual([[ZIP_ASSET, sum('b')]])
    expect(() =>
      manifestByAssetName(
        new Map([
          ['a b.zip', sum('a')],
          ['a.b.zip', sum('b')]
        ])
      )
    ).toThrow('would both be a.b.zip')
  })
})

describe('expectedAssets', () => {
  test('needs the dmg, the app zip and the mod zip by their exact names; the skill zip is reported, not required', () => {
    expect(expectedAssets([DMG, ZIP, MOD_ASSET], BUILT)).toEqual({
      ok: true,
      hasSkill: false,
      others: []
    })
    expect(expectedAssets([DMG, ZIP, MOD_ASSET, SKILL_ASSET, 'notes.txt'], BUILT)).toEqual({
      ok: true,
      hasSkill: true,
      others: ['notes.txt']
    })
  })

  test('names each missing file', () => {
    expect(expectedAssets([DMG, ZIP], BUILT).error).toContain(MOD_ASSET)
    expect(expectedAssets([ZIP, MOD_ASSET], BUILT).error).toContain(DMG)
    expect(expectedAssets([DMG, MOD_ASSET, SKILL_ASSET], BUILT).error).toContain(ZIP)
  })

  test('nothing is taken for an app file because of its extension', () => {
    const others = ['other-product-9.9.9.dmg', 'other-product-9.9.9.zip', MOD_ASSET, SKILL_ASSET]
    const found = expectedAssets(others, BUILT)
    expect(found.ok).toBe(false)
    expect(found.error).toBe(`Missing: ${DMG}, ${ZIP}.`)
    // Another version of the same app is not this release either.
    expect(expectedAssets(['example-app-1.3.0.dmg', ZIP, MOD_ASSET], BUILT).ok).toBe(false)
    // Beside the real files, such a file is an extra one.
    expect(expectedAssets([DMG, ZIP, MOD_ASSET, 'other-product-9.9.9.dmg'], BUILT).others).toEqual([
      'other-product-9.9.9.dmg'
    ])
  })
})

describe('uploadPlan', () => {
  const files = [`dist/${DMG}`, `dist/${ZIP}`, `dist/${MOD_ASSET}`]
  const plan = (over) =>
    uploadPlan({ tag: 'v1.4.0', releases: [], files, expected: BUILT, ...over })

  test('no release yet: create the draft with the files', () => {
    expect(plan()).toEqual({ ok: true, action: 'create' })
  })

  test('a published release is never touched', () => {
    const published = plan({ releases: [{ isDraft: false }] })
    expect(published.ok).toBe(false)
    expect(published.error).toContain('already published')
  })

  test('an existing draft is refused, empty or not, with the way out', () => {
    const draft = plan({ releases: [{ isDraft: true }] })
    expect(draft.ok).toBe(false)
    expect(draft.error).toContain('draft release v1.4.0 already exists')
    expect(draft.error).toContain('delete the draft release')
  })

  test('no files, twin names, an incomplete set, another product or an extra file are refused', () => {
    expect(plan({ files: [] }).ok).toBe(false)
    expect(plan({ files: ['a/x.zip', 'b/x.zip'] }).ok).toBe(false)
    const withoutMod = plan({ files: files.slice(0, 2) })
    expect(withoutMod.ok).toBe(false)
    expect(withoutMod.error).toContain(MOD_ASSET)
    const other = plan({
      files: ['dist/other-product-9.9.9.dmg', 'dist/other-product-9.9.9.zip', `dist/${MOD_ASSET}`]
    })
    expect(other.ok).toBe(false)
    expect(other.error).toContain(`Missing: ${DMG}, ${ZIP}`)
    for (const extra of ['dist/notes.txt', `dist/${SKILL_ASSET}`]) {
      const more = plan({ files: [...files, extra] })
      expect(more.ok).toBe(false)
      expect(more.error).toContain("not one of the workflow's files")
    }
  })
})

const listed = (...releases) => JSON.stringify([releases])
const release = (over = {}) => ({
  id: 7,
  tag_name: 'v1.4.0',
  draft: true,
  html_url: 'https://github.com/example-org/example-app/releases/tag/untagged-1',
  assets: [],
  ...over
})

describe('parseReleaseList', () => {
  test('reads every page, drafts included', () => {
    const stdout = JSON.stringify([
      [
        release({ assets: [{ id: 1, name: DMG, state: 'uploaded', digest: `sha256:${sum('a')}` }] })
      ],
      [release({ id: 8, tag_name: 'v1.3.0', draft: false })]
    ])
    expect(parseReleaseList({ status: 0, stdout, stderr: '' })).toEqual([
      {
        id: 7,
        tag: 'v1.4.0',
        isDraft: true,
        url: 'https://github.com/example-org/example-app/releases/tag/untagged-1',
        assets: [{ id: 1, name: DMG, state: 'uploaded', digest: `sha256:${sum('a')}` }]
      },
      {
        id: 8,
        tag: 'v1.3.0',
        isDraft: false,
        url: 'https://github.com/example-org/example-app/releases/tag/untagged-1',
        assets: []
      }
    ])
    expect(parseReleaseList({ status: 0, stdout: '[[]]', stderr: '' })).toEqual([])
  })

  test('a failed command is an error whatever its message says', () => {
    for (const stderr of ['release not found\n', 'HTTP 404: Not Found\n', 'HTTP 502\n', '']) {
      expect(() => parseReleaseList({ status: 1, stdout: '', stderr })).toThrow(
        'could not be listed'
      )
    }
    // Nothing is read from the output of a command that failed.
    expect(() => parseReleaseList({ status: 1, stdout: '[[]]', stderr: '' })).toThrow()
    expect(() => parseReleaseList({ status: null, stdout: '[[]]', stderr: '' })).toThrow()
  })

  test('output that is not a full, well-formed list is an error', () => {
    const bad = (stdout) => () => parseReleaseList({ status: 0, stdout, stderr: '' })
    expect(bad('')).toThrow('not JSON')
    expect(bad('{"message":"Not Found","status":"404"}')).toThrow('not a list of pages')
    expect(bad('[]{}')).toThrow('not JSON')
    expect(bad('[{"tag_name":"v1.4.0"}]')).toThrow('not a list of pages')
    expect(bad('[[{"tag_name":"v1.4.0"}]]')).toThrow('not a release')
    expect(bad(listed(release({ draft: 'no' })))).toThrow('not a release')
    expect(bad(listed(release({ assets: [{ name: DMG }] })))).toThrow('cannot be read')
  })
})

describe('parseManifest', () => {
  test('reads shasum lines, names with spaces included, and refuses anything else', () => {
    const text = `${sum('a')}  ${DMG}\n${sum('b')} *${ZIP}\n`
    expect([...parseManifest(text)]).toEqual([
      [DMG, sum('a')],
      [ZIP, sum('b')]
    ])
    expect(() => parseManifest('')).toThrow('empty')
    expect(() => parseManifest(`${sum('a')}  ${DMG}\nnot a checksum\n`)).toThrow('not a checksum')
    expect(() => parseManifest(`${sum('a')}  ${DMG}\n${sum('b')}  ${DMG}\n`)).toThrow(
      'more than once'
    )
  })
})

describe('draftReport', () => {
  const url = 'https://github.com/example-org/example-app/releases/tag/untagged-1'
  // Keyed by the names on the release, as `manifestByAssetName` gives them.
  const manifest = new Map([
    [DMG, sum('a')],
    [ZIP_ASSET, sum('b')],
    [MOD_ASSET, sum('c')]
  ])
  const hashes = new Map(manifest)
  const asset = (name, state = 'uploaded') => ({ name, state })
  const draft = (names, over = {}) => ({
    isDraft: true,
    url,
    assets: names.map((n) => asset(n)),
    ...over
  })
  const all = [DMG, ZIP_ASSET, MOD_ASSET]
  /** The workflow's check. */
  const check = (names, over = {}) =>
    draftReport({
      tag: 'v1.4.0',
      releases: [draft(names)],
      expected: RELEASED,
      manifest,
      hashes,
      url,
      ...over
    })
  /** The maintainer's check, with and without the checksum list. */
  const after = (names, over = {}) => check(names, { url: null, afterManual: true, ...over })

  test('the workflow check passes only for exactly the verified files', () => {
    expect(check(all)).toEqual({
      ok: true,
      errors: [],
      assets: all.map((name) => ({ name, sha256: manifest.get(name) }))
    })
    // It is a check against the checksum list: without one it fails.
    expect(check(all, { manifest: null }).ok).toBe(false)
  })

  test('the workflow check fails on any extra file, the skill zip included', () => {
    for (const extra of ['payload.txt', SKILL_ASSET, 'Other-1.4.0.pkg']) {
      const report = check([...all, extra])
      expect(report.ok).toBe(false)
      expect(report.errors).toEqual([
        `The draft holds files that are not the workflow's verified files: ${extra}.`
      ])
    }
  })

  test('the check after the skill is attached accepts exactly the release files plus the skill zip', () => {
    expect(after([...all, SKILL_ASSET])).toMatchObject({ ok: true, errors: [] })
    expect(after([...all, SKILL_ASSET], { manifest: null })).toMatchObject({ ok: true })

    const noSkill = after(all)
    expect(noSkill.ok).toBe(false)
    expect(noSkill.errors[0]).toContain(`${SKILL_ASSET} is not attached`)

    for (const over of [{}, { manifest: null }]) {
      const extra = after([...all, SKILL_ASSET, 'payload.txt'], over)
      expect(extra.ok).toBe(false)
      expect(extra.errors).toEqual([expect.stringContaining('payload.txt')])
    }
    const lost = after([DMG, ZIP_ASSET, SKILL_ASSET])
    expect(lost.ok).toBe(false)
    expect(lost.errors.join('\n')).toContain(MOD_ASSET)
  })

  test('another product with the right extensions is not this release, in either check', () => {
    const others = ['other-product-9.9.9.dmg', 'other-product-9.9.9.zip', MOD_ASSET, SKILL_ASSET]
    for (const over of [{ manifest: null }, {}]) {
      const report = after(others, over)
      expect(report.ok).toBe(false)
      expect(report.errors.join('\n')).toContain(`Missing: ${DMG}, ${ZIP_ASSET}`)
      expect(report.errors.join('\n')).toContain('other-product-9.9.9.dmg, other-product-9.9.9.zip')
    }
    // Not even with a checksum list that names those very files.
    const theirs = new Map([
      ['other-product-9.9.9.dmg', sum('a')],
      ['other-product-9.9.9.zip', sum('b')],
      [MOD_ASSET, sum('c')]
    ])
    for (const report of [
      after(others, { manifest: theirs, hashes: new Map(theirs) }),
      check(others.slice(0, 3), { manifest: theirs, hashes: new Map(theirs) })
    ]) {
      expect(report.ok).toBe(false)
      expect(report.errors.join('\n')).toContain("The checksum list is not release v1.4.0's")
    }
    // The name the build wrote, with its space, is not the name on a release.
    expect(after([DMG, ZIP, MOD_ASSET, SKILL_ASSET], { manifest: null }).ok).toBe(false)
  })

  test('fails when an expected file is missing from the draft', () => {
    for (const gone of all) {
      const report = check(all.filter((name) => name !== gone))
      expect(report.ok).toBe(false)
      expect(report.errors.join('\n')).toContain('incomplete')
      expect(report.errors.join('\n')).toContain(`${gone} is in the verified checksum list`)
    }
  })

  test('fails when the release was published, is not the one this run created, or is not alone', () => {
    const published = check(all, { releases: [draft(all, { isDraft: false })] })
    expect(published.ok).toBe(false)
    expect(published.errors[0]).toContain('no longer a draft')

    const elsewhere = check(all, { releases: [draft(all, { url: `${url}-other` })] })
    expect(elsewhere.ok).toBe(false)
    expect(elsewhere.errors[0]).toContain('where this run created it')

    expect(check(all, { releases: [] }).errors[0]).toContain('no release')
    expect(check(all, { releases: [draft(all), draft(all)] }).errors[0]).toContain('2 releases')
  })

  test('fails on a file that differs from the verified one, is unread, or did not finish', () => {
    const swapped = check(all, { hashes: new Map([...hashes, [ZIP_ASSET, sum('d')]]) })
    expect(swapped.ok).toBe(false)
    expect(swapped.errors[0]).toContain(`${ZIP_ASSET} on the draft has SHA-256 ${sum('d')}`)

    expect(check(all, { hashes: new Map() }).errors).toHaveLength(3)

    const partial = check(all, {
      releases: [
        { isDraft: true, url, assets: [asset(DMG, 'starter'), asset(ZIP_ASSET), asset(MOD_ASSET)] }
      ]
    })
    expect(partial.ok).toBe(false)
    expect(partial.errors[0]).toContain('did not finish uploading')
  })
})

/** A folder of stand-in commands, put first on PATH. */
function shims(dir) {
  const bin = path.join(dir, 'shim-bin')
  mkdirSync(bin, { recursive: true })
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  // git: the remote's address and a failing fetch can be staged; everything else is real git.
  writeFileSync(
    path.join(bin, 'git'),
    [
      '#!/bin/sh',
      'if [ "$1" = remote ] && [ "$2" = get-url ] && [ -n "$FAKE_ORIGIN_URL" ]; then',
      '  echo "$FAKE_ORIGIN_URL"; exit 0',
      'fi',
      'if [ "$1" = fetch ] && [ -n "$FAKE_FETCH_EXIT" ]; then',
      '  echo "fatal: unable to access the remote" >&2; exit "$FAKE_FETCH_EXIT"',
      'fi',
      `exec "${realGit}" "$@"`,
      ''
    ].join('\n')
  )
  // gh: answers with a staged output, message and exit status.
  writeFileSync(
    path.join(bin, 'gh'),
    [
      '#!/bin/sh',
      'if [ -n "$FAKE_GH_STDERR" ]; then printf \'%s\\n\' "$FAKE_GH_STDERR" >&2; fi',
      'if [ -n "$FAKE_GH_STDOUT" ]; then printf \'%s\' "$FAKE_GH_STDOUT"; fi',
      'exit "${FAKE_GH_EXIT:-0}"',
      ''
    ].join('\n')
  )
  chmodSync(path.join(bin, 'git'), 0o755)
  chmodSync(path.join(bin, 'gh'), 0o755)
  return bin
}

const ORIGIN = `https://github.com/${EXPECTED_REPOSITORY}.git`

describe('the trigger command against a real repository', () => {
  const made = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A clone whose origin is a second repository on disk; `push` sends a ref there. */
  function repository(version) {
    const base = mkdtempSync(path.join(tmpdir(), 'release-check-'))
    made.push(base)
    const dir = path.join(base, 'clone')
    const remote = path.join(base, 'remote.git')
    const gitIn =
      (cwd) =>
      (...args) =>
        execFileSync(
          'git',
          ['-c', 'user.name=Example', '-c', 'user.email=dev@example.com', ...args],
          { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        ).trim()
    mkdirSync(dir)
    gitIn(base)('init', '--quiet', '--bare', remote)
    const git = gitIn(dir)
    git('init', '--quiet')
    git('remote', 'add', 'origin', remote)
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'example-app', version }))
    git('add', 'package.json')
    git('commit', '--quiet', '--no-gpg-sign', '-m', 'first')
    const tag = (name) => {
      git('tag', '--force', name)
      git('push', '--quiet', '--force', 'origin', `refs/tags/${name}`)
    }
    return { dir, git, tag, bin: shims(base) }
  }

  function trigger({ dir, bin }, env) {
    const output = path.join(dir, 'github-output')
    writeFileSync(output, '')
    const result = spawnSync(process.execPath, [script, 'trigger'], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        GIT_CONFIG_NOSYSTEM: '1',
        FAKE_ORIGIN_URL: ORIGIN,
        GITHUB_OUTPUT: output,
        ...env
      }
    })
    return { ...result, output: readFileSync(output, 'utf8') }
  }

  const pushed = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.4.0' }
  const manual = {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    INPUT_TAG: 'v1.4.0'
  }

  test('passes for the remote tag on the checked-out commit and writes the tag output', () => {
    const repo = repository('1.4.0')
    repo.tag('v1.4.0')

    const run = trigger(repo, { ...pushed, GITHUB_REPOSITORY: EXPECTED_REPOSITORY })

    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout.trim()).toBe('v1.4.0')
    expect(run.output).toBe('tag=v1.4.0\n')
    // The ref the tag was fetched to does not outlive the check.
    expect(repo.git('for-each-ref', 'refs/release-check')).toBe('')
  })

  test('fails when an older tag started the run, and writes no output', () => {
    const repo = repository('1.4.0')
    repo.tag('v1.3.0')
    repo.tag('v1.4.0')

    const run = trigger(repo, { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.3.0' })

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('may only release v1.4.0')
    expect(run.output).toBe('')
  })

  test('fails when the fetch fails, even though the local tag and HEAD agree', () => {
    const repo = repository('1.4.0')
    repo.tag('v1.4.0')
    expect(trigger(repo, pushed).status).toBe(0)

    const run = trigger(repo, { ...pushed, FAKE_FETCH_EXIT: '128' })

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('could not be fetched')
    expect(run.stderr).toContain('git exit 128')
    expect(run.stdout).toBe('')
    expect(run.output).toBe('')
  })

  test('fails when the tag exists only in the local clone', () => {
    const repo = repository('1.4.0')
    repo.git('tag', 'v1.4.0')

    const run = trigger(repo, manual)

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('could not be fetched')
    expect(run.output).toBe('')
  })

  test('fails when the remote tag is on another commit than the local tag and HEAD', () => {
    const repo = repository('1.4.0')
    repo.tag('v1.4.0')
    repo.git('commit', '--quiet', '--no-gpg-sign', '--allow-empty', '-m', 'second')
    // The local tag moves with HEAD; the remote still holds the first commit.
    repo.git('tag', '--force', 'v1.4.0')

    const moved = trigger(repo, manual)

    expect(moved.status).toBe(1)
    expect(moved.stderr).toContain('would not be the tagged source')
    expect(moved.output).toBe('')

    repo.tag('v1.4.0')
    expect(trigger(repo, manual).status).toBe(0)
  })

  test('fails when origin or the run is another repository', () => {
    const repo = repository('1.4.0')
    repo.tag('v1.4.0')

    // The real address of origin here is a folder on disk.
    const local = trigger(repo, { ...pushed, FAKE_ORIGIN_URL: '' })
    expect(local.status).toBe(1)
    expect(local.stderr).toContain(`not the repository ${EXPECTED_REPOSITORY}`)

    const fork = trigger(repo, {
      ...pushed,
      FAKE_ORIGIN_URL: 'https://github.com/someone-else/example-app.git'
    })
    expect(fork.status).toBe(1)
    expect(fork.stderr).toContain(`not the repository ${EXPECTED_REPOSITORY}`)

    const otherRun = trigger(repo, { ...pushed, GITHUB_REPOSITORY: 'someone-else/example-app' })
    expect(otherRun.status).toBe(1)
    expect(otherRun.stderr).toContain('belongs to someone-else/example-app')

    const noName = trigger(repo, { ...pushed, GITHUB_ACTIONS: 'true' })
    expect(noName.status).toBe(1)
    expect(noName.stderr).toContain('GITHUB_REPOSITORY is not set')
    expect(local.output + fork.output + otherRun.output + noName.output).toBe('')
  })
})

describe('the release and assets commands against a stand-in gh', () => {
  const made = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A folder holding the invented app's packaging configuration, as a checkout does. */
  function checkout(builderYml = BUILDER_YML) {
    const dir = mkdtempSync(path.join(tmpdir(), 'release-check-'))
    made.push(dir)
    writeFileSync(path.join(dir, 'package.json'), PACKAGE_JSON)
    writeFileSync(path.join(dir, 'electron-builder.yml'), builderYml)
    return dir
  }
  function command(args, env = {}, dir = checkout()) {
    return spawnSync(process.execPath, [script, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: `${shims(dir)}:${process.env.PATH}`, HOME: dir, ...env }
    })
  }
  function manifestFile(text) {
    const file = path.join(checkout(), 'SHA256SUMS')
    writeFileSync(file, text)
    return file
  }
  const files = [`dist/${DMG}`, `dist/${ZIP}`, `dist/${MOD_ASSET}`]
  const uploaded = (id, name, digit) => ({
    id,
    name,
    state: 'uploaded',
    ...(digit === undefined ? {} : { digest: `sha256:${sum(digit)}` })
  })
  // The checksum list names the zip as the build wrote it; the release holds it renamed.
  const sums = `${sum('a')}  ${DMG}\n${sum('b')}  ${ZIP}\n${sum('c')}  ${MOD_ASSET}\n`
  const assets = [uploaded(1, DMG, 'a'), uploaded(2, ZIP_ASSET, 'b'), uploaded(3, MOD_ASSET, 'c')]
  const skill = uploaded(4, SKILL_ASSET)

  test('release: prints create only when the list is complete and has no release for the tag', () => {
    const none = command(['release', 'v1.4.0', ...files], {
      FAKE_GH_STDOUT: listed(release({ tag_name: 'v1.3.0', draft: false }))
    })
    expect(none.stderr).toBe('')
    expect(none.status).toBe(0)
    expect(none.stdout.trim()).toBe('create')

    const draft = command(['release', 'v1.4.0', ...files], { FAKE_GH_STDOUT: listed(release()) })
    expect(draft.status).toBe(1)
    expect(draft.stderr).toContain('draft release v1.4.0 already exists')
  })

  test('release: files of another product or another version are refused before anything is uploaded', () => {
    const other = command(
      [
        'release',
        'v1.4.0',
        'dist/other-product-9.9.9.dmg',
        'dist/other-product-9.9.9.zip',
        files[2]
      ],
      { FAKE_GH_STDOUT: '[[]]' }
    )
    expect(other.status).toBe(1)
    expect(other.stderr).toContain(`Missing: ${DMG}, ${ZIP}`)
    // The same files are not release 1.5.0.
    const later = command(['release', 'v1.5.0', ...files], { FAKE_GH_STDOUT: '[[]]' })
    expect(later.status).toBe(1)
    expect(later.stderr).toContain('example-app-1.5.0.dmg')
  })

  test('release: an unrelated failure that says "release not found" is a failure', () => {
    const run = command(['release', 'v1.4.0', ...files], {
      FAKE_GH_EXIT: '1',
      FAKE_GH_STDERR: 'could not resolve host; release not found'
    })
    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    expect(run.stderr).toContain('could not be listed')

    const notFound = command(['release', 'v1.4.0', ...files], {
      FAKE_GH_EXIT: '1',
      FAKE_GH_STDOUT: '{"message":"Not Found","status":"404"}',
      FAKE_GH_STDERR: 'gh: Not Found (HTTP 404)'
    })
    expect(notFound.status).toBe(1)
    expect(notFound.stdout).toBe('')

    const empty = command(['release', 'v1.4.0', ...files])
    expect(empty.status).toBe(1)
    expect(empty.stderr).toContain('not JSON')
  })

  test('release: fails when gh cannot be run at all', () => {
    const dir = checkout()
    const run = spawnSync(process.execPath, [script, 'release', 'v1.4.0', ...files], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: dir, HOME: dir }
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('gh could not be run')
  })

  test('a packaging configuration the name patterns no longer fit fails every command', () => {
    const moved = BUILDER_YML.replace('${name}-${version}.${ext}', '${productName}.${ext}')
    for (const args of [
      ['release', 'v1.4.0', ...files],
      ['assets', '--after-manual', 'v1.4.0']
    ]) {
      const run = command(args, { FAKE_GH_STDOUT: '[[]]' }, checkout(moved))
      expect(run.status).toBe(1)
      expect(run.stderr).toContain('file names could not be worked out')
    }
  })

  test('assets: passes only for a draft holding exactly the verified files with matching checksums', () => {
    const manifest = manifestFile(sums)
    const url = release().html_url
    const workflow = (list) =>
      command(['assets', 'v1.4.0', '--manifest', manifest, '--url', url], { FAKE_GH_STDOUT: list })

    const good = workflow(listed(release({ assets })))
    expect(good.stderr).toBe('')
    expect(good.status).toBe(0)
    expect(good.stdout).toContain(`${sum('b')}  ${ZIP_ASSET}`)
    expect(good.stdout).toContain(`${sum('c')}  ${MOD_ASSET}`)

    for (const extra of ['payload.txt', SKILL_ASSET]) {
      const more = workflow(listed(release({ assets: [...assets, uploaded(9, extra)] })))
      expect(more.status).toBe(1)
      expect(more.stderr).toContain(`not the workflow's verified files: ${extra}`)
    }

    const swapped = workflow(
      listed(release({ assets: [assets[0], uploaded(2, ZIP_ASSET, 'd'), assets[2]] }))
    )
    expect(swapped.status).toBe(1)
    expect(swapped.stderr).toContain(`${ZIP_ASSET} on the draft has SHA-256 ${sum('d')}`)

    const published = workflow(listed(release({ assets, draft: false })))
    expect(published.status).toBe(1)
    expect(published.stderr).toContain('no longer a draft')

    // The workflow's check always needs the checksum list.
    const bare = command(['assets', 'v1.4.0'], { FAKE_GH_STDOUT: listed(release({ assets })) })
    expect(bare.status).toBe(1)
    expect(bare.stderr).toContain('Usage')
  })

  test('assets --after-manual: the skill zip is required, and nothing beyond it is accepted', () => {
    const manifest = manifestFile(sums)
    const notYet = command(['assets', '--after-manual', 'v1.4.0'], {
      FAKE_GH_STDOUT: listed(release({ assets }))
    })
    expect(notYet.status).toBe(1)
    expect(notYet.stderr).toContain(`${SKILL_ASSET} is not attached`)
    for (const args of [[], ['--manifest', manifest]]) {
      const ready = command(['assets', '--after-manual', 'v1.4.0', ...args], {
        FAKE_GH_STDOUT: listed(release({ assets: [...assets, skill] }))
      })
      expect(ready.stderr).toBe('')
      expect(ready.status).toBe(0)
      const stray = command(['assets', '--after-manual', 'v1.4.0', ...args], {
        FAKE_GH_STDOUT: listed(release({ assets: [...assets, skill, uploaded(9, 'payload.txt')] }))
      })
      expect(stray.status).toBe(1)
      expect(stray.stderr).toContain('payload.txt')
    }
    // With the checksum list, the workflow's files are checked against it.
    const swapped = command(['assets', '--after-manual', 'v1.4.0', '--manifest', manifest], {
      FAKE_GH_STDOUT: listed(
        release({ assets: [uploaded(1, DMG, 'e'), assets[1], assets[2], skill] })
      )
    })
    expect(swapped.status).toBe(1)
    expect(swapped.stderr).toContain(`${DMG} on the draft has SHA-256 ${sum('e')}`)
  })

  test("assets --after-manual: another product's dmg and zip with the two zips fail for v0.22.0", () => {
    // The real packaging configuration of this repository, and the release it is about to make.
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const dir = mkdtempSync(path.join(tmpdir(), 'release-check-'))
    made.push(dir)
    for (const name of ['package.json', 'electron-builder.yml']) {
      writeFileSync(path.join(dir, name), readFileSync(path.join(root, name), 'utf8'))
    }
    const others = [
      uploaded(1, 'other-product-9.9.9.dmg'),
      uploaded(2, 'other-product-9.9.9.zip'),
      uploaded(3, MOD_ASSET),
      skill
    ]
    const run = command(
      ['assets', '--after-manual', 'v0.22.0'],
      { FAKE_GH_STDOUT: listed(release({ tag_name: 'v0.22.0', assets: others })) },
      dir
    )
    expect(run.status).toBe(1)
    expect(run.stdout).not.toContain('holds exactly')
    expect(run.stderr).toContain(
      'Missing: dev-traffic-control-0.22.0.dmg, Dev.Traffic.Control-0.22.0-arm64-mac.zip'
    )
    expect(run.stderr).toContain('other-product-9.9.9.dmg, other-product-9.9.9.zip')

    // The files that release does carry pass.
    const real = [
      uploaded(1, 'dev-traffic-control-0.22.0.dmg'),
      uploaded(2, 'Dev.Traffic.Control-0.22.0-arm64-mac.zip'),
      uploaded(3, MOD_ASSET),
      skill
    ]
    const ok = command(
      ['assets', '--after-manual', 'v0.22.0'],
      { FAKE_GH_STDOUT: listed(release({ tag_name: 'v0.22.0', assets: real })) },
      dir
    )
    expect(ok.stderr).toBe('')
    expect(ok.status).toBe(0)
  })

  test('assets: fails when the draft lacks an expected file, and hashes a download when GitHub gives no digest', () => {
    const noMod = command(
      [
        'assets',
        'v1.4.0',
        '--manifest',
        manifestFile(`${sum('a')}  ${DMG}\n${sum('b')}  ${ZIP}\n`)
      ],
      { FAKE_GH_STDOUT: listed(release({ assets: assets.slice(0, 2) })) }
    )
    expect(noMod.status).toBe(1)
    expect(noMod.stderr).toContain(`Missing: ${MOD_ASSET}`)

    // Without a digest the file is fetched and hashed: the stand-in gh answers every call with
    // the list itself, so the hash of that text is what the draft "holds", and it is not the
    // listed checksum.
    const body = listed(release({ assets: [uploaded(1, DMG), assets[1], assets[2]] }))
    const hashed = command(['assets', 'v1.4.0', '--manifest', manifestFile(sums)], {
      FAKE_GH_STDOUT: body
    })
    expect(hashed.status).toBe(1)
    expect(hashed.stderr).toMatch(new RegExp(`${DMG} on the draft has SHA-256 [0-9a-f]{64}, but`))
  })
})
