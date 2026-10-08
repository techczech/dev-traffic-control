/**
 * Give every renderer test the jsdom window's `localStorage` and
 * `sessionStorage`.
 *
 * Node can define its own `localStorage` global (the Web Storage flag, on by
 * default in newer releases). Where it does, the jsdom environment leaves that
 * global in place, and without a storage file Node's getter throws or returns
 * nothing. The tests then depend on which Node runs them and how it was
 * started. Defining both names from the jsdom window removes that dependence:
 * the storage a test sees is always the page's, empty at the start of each
 * test file.
 */
interface JsdomHandle {
  window: Record<'localStorage' | 'sessionStorage', Storage>
}

const dom = (globalThis as { jsdom?: JsdomHandle }).jsdom
if (!dom) {
  throw new Error('webStorageSetup runs only in the jsdom test environment')
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const storage = dom.window[name]
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    get: () => storage
  })
}
