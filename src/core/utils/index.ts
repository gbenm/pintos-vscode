export function conditionalExecute<T>({ condition, execute }: { condition: boolean, execute: () => T }) {
  if (condition) {
    return execute()
  }
}

export function promise<T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void) {
  return new Promise<T>(executor)
}
