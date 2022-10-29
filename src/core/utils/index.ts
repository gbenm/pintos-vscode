import { readdirSync } from "fs"
import { join as joinPath, parse as parsePath } from "path/posix"

export function conditionalExecute<T>({ condition, execute }: { condition: boolean, execute: () => T }) {
  if (condition) {
    return execute()
  }
}

export function promise<T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void) {
  return new Promise<T>(executor)
}

export function searchFileByName (target: string): string | undefined {
  const { dir, name } = parsePath(target)

  const files = readdirSync(dir)

  const result = files.find(file => {
    const info = parsePath(file)

    return info.name === name
  })

  if (result) {
    return joinPath(dir, result)
  }
}
