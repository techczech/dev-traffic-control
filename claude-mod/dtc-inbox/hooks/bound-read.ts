/**
 * The descriptor-bound read the host is asked for. The mods API reads files by pathname only, with
 * no no-follow open and no descriptor, so the open, the `fstat`, the read and the checks around
 * them run in one short helper process: the system's own Perl (core modules only), started with a
 * fixed program and the paths as plain arguments. The helper decides nothing: it reports what it
 * observed, in order, and `confinedTo` in `guard.ts` judges the facts. Where the helper cannot
 * run, there are no facts and every file read fails closed.
 */

import type { BoundFacts, BoundRequest } from './guard'

/** The one interpreter this is run with: an absolute path, never looked up on `PATH`. */
export const BOUND_READ_PROGRAM = '/usr/bin/perl'

/** First line of the helper's answer; anything else is not an answer. */
export const BOUND_READ_MARK = 'dtc-inbox-bound-read 2'

/** The most time one read may take before it counts as failed. */
export const BOUND_READ_TIMEOUT_MS = 5000

/**
 * The helper. Arguments: root, folder, leaf name, byte cap, `1` to read content or `0` to
 * identify only. It resolves the root and the folder, opens the leaf with `O_NOFOLLOW` (and
 * `O_NONBLOCK`, so a pipe or device never holds it), `fstat`s the descriptor, reads from the
 * descriptor only when that is a regular file with exactly one name (link count 1) within the cap
 * in a folder whose real path is under the root's, then resolves the root and the folder again and
 * `lstat`s the path. It prints nine lines; paths and content are base64. The fourth line carries
 * the opened file's kind, device, inode, size and link count. Content is printed only when the
 * read stayed within the cap.
 */
export const BOUND_READ_SCRIPT = `use strict; use warnings;
use Fcntl qw(O_RDONLY O_NOFOLLOW O_NONBLOCK S_ISREG S_ISDIR S_ISLNK);
use Cwd (); use MIME::Base64 ();
my ($root, $parent, $name, $max, $want) = @ARGV;
exit 2 unless @ARGV == 5 && $name ne '' && $name ne '.' && $name ne '..' && index($name, '/') < 0 && $max =~ /^[0-9]{1,10}$/ && $want =~ /^[01]$/;
sub b { return MIME::Base64::encode_base64(defined $_[0] ? $_[0] : '', '') }
sub kind { my $m = shift; return S_ISREG($m) ? 'file' : S_ISDIR($m) ? 'dir' : S_ISLNK($m) ? 'link' : 'other' }
my $r1 = Cwd::realpath($root); my $p1 = Cwd::realpath($parent);
exit 3 unless defined $r1 && defined $p1;
my $path = "$parent/$name";
sysopen(my $fh, $path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK) or exit 4;
binmode($fh);
my @s = stat($fh); exit 5 unless @s;
my $k = kind($s[2]);
my ($data, $n) = ('', 0);
my $in = $p1 eq $r1 || index($p1, $r1 eq '/' ? '/' : "$r1/") == 0;
my $may = $want eq '1' && $in && $k eq 'file' && $s[3] == 1 && $s[7] <= $max;
if ($may) {
  while ($n <= $max) {
    my $got = sysread($fh, my $buf, 65536);
    exit 6 unless defined $got;
    last if $got == 0;
    $data .= $buf; $n += $got;
  }
}
my $r2 = Cwd::realpath($root); my $p2 = Cwd::realpath($parent);
my @l = lstat($path);
close($fh);
my $ok = $may && $n <= $max;
binmode(STDOUT);
print join("\\n", '${BOUND_READ_MARK}', b($r1), b($p1), "$k $s[0] $s[1] $s[7] $s[3]", "$n " . ($ok ? 1 : 0),
  (defined $r2 ? 'p ' . b($r2) : 'gone'), (defined $p2 ? 'p ' . b($p2) : 'gone'),
  (@l ? kind($l[2]) . " $l[0] $l[1]" : 'gone'), ($ok ? b($data) : '')), "\\n";
`

/** The argument list for one bound read: the program, the fixed script, then the request as plain arguments (no shell). */
export function boundReadArgv(req: BoundRequest): string[] {
  const cap = Number.isFinite(req.maxBytes) && req.maxBytes > 0 ? Math.floor(req.maxBytes) : 0
  return [BOUND_READ_PROGRAM, '-e', BOUND_READ_SCRIPT, '--', req.root, req.parent, req.name, String(cap), req.wantText ? '1' : '0']
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Base64 to the text of its UTF-8 bytes; null when it is not base64. */
function fromBase64(text: string): string | null {
  if (!B64.test(text) || text.length % 4 !== 0) return null
  try {
    const raw = atob(text)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

const KIND = ['file', 'dir', 'link', 'other'] as const
const isKind = (v: string | undefined): v is (typeof KIND)[number] => (KIND as readonly string[]).includes(v ?? '')
const isDigits = (v: string | undefined): v is string => v !== undefined && /^[0-9]{1,20}$/.test(v)

/** A resolved path as the helper prints it: `p <base64>`, or `gone`. `undefined` when the line is neither. */
function pathLine(line: string | undefined): string | null | undefined {
  if (line === 'gone') return null
  if (line === undefined || !line.startsWith('p ')) return undefined
  return fromBase64(line.slice(2)) ?? undefined
}

/** The helper's answer read as facts. Null for anything that is not exactly the nine lines it prints. */
export function parseBoundFacts(stdout: unknown): BoundFacts | null {
  if (typeof stdout !== 'string') return null
  const lines = stdout.split('\n')
  if (lines.length !== 10 || lines[9] !== '' || lines[0] !== BOUND_READ_MARK) return null
  const rootBefore = fromBase64(lines[1] as string)
  const parentBefore = fromBase64(lines[2] as string)
  if (rootBefore === null || parentBefore === null || rootBefore === '' || parentBefore === '') return null
  const [kind, dev, ino, size, nlink, ...restOpened] = (lines[3] as string).split(' ')
  if (restOpened.length > 0 || !isKind(kind) || kind === 'link' || !isDigits(dev) || !isDigits(ino) || !isDigits(size) || !isDigits(nlink)) return null
  const [count, hasText, ...restRead] = (lines[4] as string).split(' ')
  if (restRead.length > 0 || !isDigits(count) || (hasText !== '0' && hasText !== '1')) return null
  const rootAfter = pathLine(lines[5])
  const parentAfter = pathLine(lines[6])
  if (rootAfter === undefined || parentAfter === undefined) return null
  let leaf: BoundFacts['leaf'] = null
  if (lines[7] !== 'gone') {
    const [leafKind, leafDev, leafIno, ...restLeaf] = (lines[7] as string).split(' ')
    if (restLeaf.length > 0 || !isKind(leafKind) || !isDigits(leafDev) || !isDigits(leafIno)) return null
    leaf = { kind: leafKind, dev: leafDev, ino: leafIno }
  }
  let text: string | null = null
  if (hasText === '1') {
    text = fromBase64(lines[8] as string)
    if (text === null) return null
  } else if (lines[8] !== '') return null
  return { rootBefore, parentBefore, opened: { kind, dev, ino, size: Number(size), nlink: Number(nlink) }, bytes: Number(count), text, rootAfter, parentAfter, leaf }
}

/** What `$.process.run` answers with, as far as this reads it. */
export type RunResult = { exitCode?: unknown; stdout?: unknown; isStdoutTruncated?: unknown }

/**
 * A bound read through a process runner. Any failure is "no facts": the program is missing, it
 * exits non-zero (the open failed, a path did not resolve), its output was cut short or is not
 * the helper's.
 */
export function boundReadVia(run: (argv: string[], timeoutMs: number) => Promise<RunResult>): (req: BoundRequest) => Promise<BoundFacts | null> {
  return async req => {
    try {
      const out = await run(boundReadArgv(req), BOUND_READ_TIMEOUT_MS)
      if (out === null || typeof out !== 'object' || out.exitCode !== 0 || out.isStdoutTruncated === true) return null
      return parseBoundFacts(out.stdout)
    } catch {
      return null
    }
  }
}
