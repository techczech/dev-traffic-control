/**
 * The main-process boundary for choosing the record root. Two IPC calls can
 * re-point the app at a folder: `bootstrapRepo` (which also materialises the
 * contract there: creating the folder, writing AGENTS.md, CLAUDE.md and
 * .gitignore) and `setSetting('qaRepoPath', …)` from the Settings path row.
 * Both go through the one rule held here: the folder must be one the user
 * chose or main already holds —
 *
 * - the current record root;
 * - the folder the most recent folder dialog returned to *that window*
 *   (tracked here per webContents id, never taken from the renderer);
 * - a record root main's own settings log shows the app has used before, which
 *   is what the Settings changelog's Reset re-points to.
 *
 * Anything else returns `null` and writes nothing.
 */
export interface RootChoiceDeps<TEvent, TSettings> {
  currentRoot: () => string
  /** Every earlier record root in main's settings log (from/to of each change). */
  previousRoots: () => readonly string[]
  senderId: (event: TEvent) => number
  showFolderDialog: (event: TEvent) => Promise<string | null>
  bootstrap: (root: string) => Promise<TSettings>
  setRoot: (event: TEvent, root: string) => Promise<TSettings>
}

export interface RootChoiceHandlers<TEvent, TSettings> {
  pickFolder: (event: TEvent) => Promise<string | null>
  bootstrapRepo: (event: TEvent, root: unknown) => Promise<TSettings | null>
  setRoot: (event: TEvent, root: unknown) => Promise<TSettings | null>
}

export function createRootChoiceHandlers<TEvent, TSettings>(
  deps: RootChoiceDeps<TEvent, TSettings>
): RootChoiceHandlers<TEvent, TSettings> {
  // webContents ids are never reused within a run, so a closed window's entry
  // can never be matched by another window; it is left to the process's end.
  const lastPicked = new Map<number, string>()

  const allowed = (event: TEvent, root: unknown): root is string =>
    typeof root === 'string' &&
    root !== '' &&
    (root === deps.currentRoot() ||
      root === lastPicked.get(deps.senderId(event)) ||
      deps.previousRoots().includes(root))

  return {
    async pickFolder(event) {
      const picked = await deps.showFolderDialog(event)
      const id = deps.senderId(event)
      // A cancelled dialog withdraws this window's previous choice too.
      if (picked) lastPicked.set(id, picked)
      else lastPicked.delete(id)
      return picked
    },
    async bootstrapRepo(event, root) {
      return allowed(event, root) ? deps.bootstrap(root) : null
    },
    async setRoot(event, root) {
      return allowed(event, root) ? deps.setRoot(event, root) : null
    }
  }
}
