import * as vscode from "vscode"
import { join } from "node:path"
import { OptionalPromise } from "../core/types"
import { handleError } from "./errors"
import { scopedCommand } from "../core/launch"

export function parseUri(path: string, ...pathSegments: string[]) {
  return vscode.Uri.parse(join(path, ...pathSegments))
}

export function showStopMessage(output?: vscode.OutputChannel) {
  return () => output?.appendLine("Stopped")
}

export function getUserInput({ title, placeholder, initialValue = "" }: {
  title: string
  placeholder: string
  initialValue?: string
}): Promise<string> {
  const input = vscode.window.createInputBox()
  input.title = title
  input.placeholder = placeholder
  input.value = initialValue
  input.show()

  return new Promise((resolve, reject) => {
    input.onDidAccept(() => {
      if (!input.value.trim()) {
        return
      }

      resolve(input.value.trim())
      input.hide()
    })

    input.onDidHide(reject)
  })
}

export function pickOptions<T extends vscode.QuickPickItem, K = T>({ title, options, placeholder, selectedOptions = [], canSelectMany = false, mapFn = (v => <any> v)}: {
  title: string
  options: T[]
  selectedOptions?: T[]
  placeholder?: string
  canSelectMany?: boolean
  mapFn?: (v: T) => K
}): Promise<K[]> {
  const picker = vscode.window.createQuickPick()
  picker.title = title
  picker.placeholder = placeholder
  picker.canSelectMany = canSelectMany
  picker.items = options
  picker.selectedItems = selectedOptions
  picker.ignoreFocusOut = true
  picker.show()

  return new Promise<K[]>((resolve, reject) => {
    picker.onDidAccept(() => {
      resolve((<T[]> picker.selectedItems).map(mapFn))
      picker.hide()
    })

    picker.onDidHide(() => reject("cancel selection"))
  }).finally(() => picker.dispose())
}

export function uriFromCurrentWorkspace (...pathSegments: string[]) {
  const currentWorkspaceUri = getCurrentWorkspaceUri()
  return vscode.Uri.joinPath(currentWorkspaceUri, ...pathSegments)
}

export function getCurrentWorkspaceUri() {
  const firstWorkspace = vscode.workspace.workspaceFolders?.[0]!
  const currentFolderUri = firstWorkspace.uri

  return currentFolderUri
}

export function createScopedHandler<Fn extends (...args: any[]) => OptionalPromise<any>>(fn: Fn): (...args: Parameters<Fn>) => Promise<void>
export function createScopedHandler<Fn extends (...args: any[]) => OptionalPromise<any>>(fn: Fn, ...args: Parameters<Fn>): () => Promise<void>
export function createScopedHandler<Fn extends (...args: any[]) => OptionalPromise<any>>(fn: Fn, ...args: Parameters<Fn>): ((...args: Parameters<Fn>) => Promise<void>) | (() => Promise<void>) {
  return async (...a: Parameters<Fn>) => {
    try {
      await scopedCommand({
        cwd: getCurrentWorkspaceUri().fsPath,
        execute: () => fn(...(args.length > 0 ? args : a))
      })
    } catch (e) {
      handleError(e)
    }
  }
}
