import type { SerializableRun, QaSnapshot } from '../../../shared/ipc';
import type { NoteRef } from '../../../main/qa/scan';

export type SwitcherEntry =
  | { kind: 'all' }
  | { kind: 'project'; slug: string }
  | { kind: 'run'; run: SerializableRun }
  | { kind: 'note'; note: NoteRef };

const NOTE_CAP = 10;
const DONE_RUN_CAP = 10;

function filenameDate(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const match = base.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function runDate(run: SerializableRun): string {
  return run.request.date ?? filenameDate(run.request.path);
}

/** Newest first: date desc, filename desc as a stable tie-break. */
function byDateDesc(aDate: string, aPath: string, bDate: string, bPath: string): number {
  if (aDate !== bDate) return aDate < bDate ? 1 : -1;
  return aPath < bPath ? 1 : -1;
}

/**
 * The switcher's flat entry list: *All projects* and every project slug — one
 * list, because All projects is a scope like any other — then non-done runs
 * followed by the ten most recent done runs, then the ten most recent notes.
 */
export function switcherEntries(s: QaSnapshot): SwitcherEntry[] {
  const entries: SwitcherEntry[] = [
    { kind: 'all' },
    ...s.projects.map((slug): SwitcherEntry => ({ kind: 'project', slug }))
  ];

  const nonDone = s.runs
    .filter((r) => r.status !== 'done')
    .sort((a, b) => byDateDesc(runDate(a), a.request.path, runDate(b), b.request.path));
  const done = s.runs
    .filter((r) => r.status === 'done')
    .sort((a, b) => byDateDesc(runDate(a), a.request.path, runDate(b), b.request.path))
    .slice(0, DONE_RUN_CAP);
  for (const run of [...nonDone, ...done]) entries.push({ kind: 'run', run });

  const notes = [...s.notes]
    .sort((a, b) => byDateDesc(filenameDate(a.path), a.path, filenameDate(b.path), b.path))
    .slice(0, NOTE_CAP);
  for (const note of notes) entries.push({ kind: 'note', note });

  return entries;
}

function searchText(entry: SwitcherEntry): string {
  if (entry.kind === 'all') return 'all projects';
  if (entry.kind === 'project') return entry.slug;
  if (entry.kind === 'run') {
    const base = entry.run.request.path.split(/[\\/]/).pop() ?? '';
    return `${entry.run.request.title} ${base} ${entry.run.project}`;
  }
  const base = entry.note.path.split(/[\\/]/).pop() ?? '';
  return `${entry.note.title} ${base} ${entry.note.project}`;
}

/** Case-insensitive substring filter on slug / title / filename; stable order. */
export function filterEntries(entries: SwitcherEntry[], query: string): SwitcherEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) => searchText(entry).toLowerCase().includes(q));
}
