/**
 * The implementation must work as vscode.OutputChannel
 */
export interface OutputChannel {
  append (value: string): void
  appendLine (value: string): void
  clear (): void
  replace (value: string): void
}

export type OptionalPromiseLike<T> = PromiseLike<T> | T

export type OptionalPromise<T> = Promise<T> | T

export type FunctionsOf<T extends object, FnLike = Fn> = RemoveNever<{
  [K in keyof T]: T[K] extends FnLike | null | undefined ? T[K] : never
}>

export type RemoveNever<T extends object> = Omit<T, keyof {
  [K in keyof T as T[K] extends never ? K : never]: unknown
}>

export type Fn = (...args: any[]) => any

declare global {
  interface AbortSignal extends EventTarget {
    reason: unknown
  }

  interface EventTarget {
    addEventListener(type: string, listener: Fn): void
    removeEventListener(type: string, listener: Fn): void
  }

  interface AbortController {
    abort (reason: any): void
  }
}
