/**
 * Stand-in typings for the Claude Code host, so the mod type-checks from a clean checkout. They
 * cover only what this mod names, loosely: they check the mod against itself, not against the
 * host. The host's own typings, where a host provides them, are the authority on its calls.
 */

declare module 'claude-code' {
  /** Session-local state, declared per plugin (see `types/index.d.ts`). */
  interface PluginState {}

  type Hook = (...args: any[]) => any
  type On = (event: string, filterOrHook: Record<string, unknown> | Hook, hook?: Hook) => void
  type Register = (on: On, options: unknown) => void

  /** What a surface module is handed to draw with and to hear keys through. */
  type ClientSurface<State> = {
    state?: State
    elements: Record<string, any>
    columns: number
    rows: number
    onKey: (listener: (event: { key: string }) => void) => void
    setState: (state: State) => void
    post: (data: unknown) => void
  }

  /** A surface module: drawn in the client from props, with its own state. */
  type ClientModule<Props = any, State = any> = (props: Props, surface: ClientSurface<State>) => any
}

declare module 'claude-code/testing' {
  type TestFn = (...args: any[]) => unknown
  export function describe(name: string, body: () => void): void
  export function test(name: string, fn: TestFn): void
  export function test(name: string, options: Record<string, unknown>, fn: TestFn): void
  export const expect: (received: unknown, message?: string) => any
  export const mock: { clock: (...args: any[]) => any; store: (...args: any[]) => any; env: (...args: any[]) => any; session: (...args: any[]) => any }
  export function tier(tier: string): void
}

// What the host's hook sandbox provides beyond the language itself, as far as this mod uses it.
declare const h: any
declare const Fragment: any
declare namespace JSX {
  type Element = any
  interface IntrinsicElements {
    [name: string]: any
  }
  interface ElementChildrenAttribute {
    children: unknown
  }
}
declare function atob(data: string): string
declare function btoa(data: string): string
declare class TextEncoder {
  encode(input?: string): Uint8Array
}
declare class TextDecoder {
  constructor(label?: string)
  decode(input?: Uint8Array): string
}
declare const console: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
