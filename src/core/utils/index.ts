import { exec } from "node:child_process"

export function conditionalExecute<T>({ condition, execute }: { condition: boolean, execute: () => T }) {
  if (condition) {
    return execute()
  }
}
