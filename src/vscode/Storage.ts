import * as vscode from "vscode"
import { FunctionsOf } from "../core/types"

export default class Storage implements vscode.Memento {
  private readonly prefix: string

  constructor (
    private readonly memento: vscode.Memento,
    public readonly name: string
  ) {
    this.prefix = `@${name}:`
  }

  keys(): readonly string[] {
    return this.memento.keys().filter(
      name => name.startsWith(this.prefix)
    )
  }

  get<T>(key: string): T | undefined
  get<T>(key: string, defaultValue: T): T
  get<T>(key: string, defaultValue?: T | undefined): T | undefined {
    const fullKey = this.prefix.concat(key)
    if (typeof defaultValue === "undefined") {
      return this.memento.get<T>(fullKey)
    }

    return this.memento.get<T>(fullKey, defaultValue)
  }

  update(key: string, value: any): Thenable<void> {
    const fullKey = this.prefix.concat(key)
    return this.memento.update(fullKey, value)
  }

  of (baseKey: string): SubStorage {
    return new Proxy(this, {
      get (target: SubStorage, method: keyof SubStorage) {
        return (key: string, ...args: [any]) => target[method](`${baseKey}.${key}`, ...args)
      }
    })
  }
}

export type SubStorage = Pick<FunctionsOf<Storage>, "get" | "update" | "of">
